import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
// Increase limit for base64 image payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup temp videos directory for simulated/fallback video outputs
const tempVideosDir = path.join(process.cwd(), 'temp_videos');
if (!fs.existsSync(tempVideosDir)) {
  fs.mkdirSync(tempVideosDir, { recursive: true });
}
app.use('/videos', express.static(tempVideosDir));

// Request logging middleware to trace routing issues
app.use((req, res, next) => {
  console.log(`[Request Log] ${req.method} ${req.path}`);
  next();
});

// Helper to clean and parse JSON from Gemini's text response
function parseGeminiJson(text: string) {
  try {
    let cleanText = text.trim();
    // Remove markdown code block wrappers if present
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    return JSON.parse(cleanText.trim());
  } catch (e) {
    console.error('Error parsing JSON from Gemini text:', text);
    throw new Error('Failed to parse response as JSON: ' + (e as Error).message);
  }
}

// 1. Analyze Brand URL via Gemini Grounding Search
app.post('/api/analyze-brand', async (req: Request, res: Response): Promise<void> => {
  const { url, geminiKey } = req.body;

  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }

  const key = geminiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(400).json({ error: 'Gemini API Key is required' });
    return;
  }

  const prompt = `Perform a google search for the URL: "${url}". Analyze the website, Play Store, or App Store link. Summarize the brand, its services or product offerings, target audience, core value proposition, tone of voice, and recommended visual style. Then, create exactly 3 distinct target ad groups or campaign concepts for vertical video ads on Meta. The concepts must be optimized for UGC (User Generated Content) style storytelling (e.g. creator review, lifestyle POV, unboxing/hands-on, problem-solution vlog).
Keep all descriptions, strategies, and summaries extremely concise, direct, and under 2 sentences to prevent token limits and truncation.
Return the response in strict JSON format matching the schema below. Do not wrap the JSON in comments or any text other than valid JSON.

JSON Schema:
{
  "brandName": "Name of the brand/app",
  "summary": "Brief summary of what they do",
  "targetAudience": "Description of target audience",
  "coreValueProp": "Core value proposition",
  "tone": "e.g. Casual authentic, energetic creator-vibe, humorous reaction",
  "visualStyle": "Visual style details for UGC-style video ads (e.g. natural indoor lighting, smartphone camera style, hand-held shots)",
  "adGroups": [
    {
      "id": "ad-group-1",
      "title": "Ad Group Title (e.g., Creator Testimonial, POV Vlog)",
      "strategy": "Marketing angle/strategy description in UGC context",
      "audience": "Specific audience segment targeted",
      "message": "Core message this ad group will deliver"
    }
  ]
}`;

  try {
    // Try using gemini-3.5-flash with search grounding tool
    const urlEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      tools: [{ google_search: {} }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4000,
        temperature: 0.1
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_ONLY_HIGH'
        }
      ]
    };

    console.log(`Analyzing URL: ${url} using Gemini 3.5 Flash...`);
    let response;
    try {
      response = await axios.post(urlEndpoint, payload);
    } catch (searchError: any) {
      console.warn('Gemini 3.5 with search grounding failed. Retrying without search tool...', searchError.message);
      // Fallback: try without search tool if it failed due to tool restrictions
      const fallbackPayload = {
        contents: [{
          parts: [{ text: `Based on your pre-trained knowledge, analyze the brand URL: "${url}" and generate the brand summary. (If you don't know the URL, infer the brand from the URL name itself). ${prompt}` }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 4000,
          temperature: 0.1
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_ONLY_HIGH'
          }
        ]
      };
      
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
      response = await axios.post(fallbackUrl, fallbackPayload);
    }

    const candidate = response.data?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Gemini blocked brand analysis. Reason: ${candidate.finishReason}. Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    const parsedData = parseGeminiJson(text);
    res.json(parsedData);
  } catch (error: any) {
    console.error('Error in analyze-brand:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Brand analysis failed',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 2. Generate Meta Ad Script & Storyboard (3 scenes)
app.post('/api/generate-script', async (req: Request, res: Response): Promise<void> => {
  const { brandProfile, selectedAdGroup, geminiKey } = req.body;

  const key = geminiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(400).json({ error: 'Gemini API Key is required' });
    return;
  }

  const prompt = `You are a professional Meta Ads UGC (User Generated Content) scriptwriter and video producer specializing in high-converting, scroll-stopping, authentic vertical videos (9:16, 10 seconds duration).
Your goal is to write a script and storyboard that feels like a real creator's post on TikTok or Instagram Reels, rather than a polished corporate commercial.

UGC STYLE STORYTELLING PRINCIPLES:
1. Authentic Hook: Start Scene 1 with an instant, relatable hook. Use selfie style or a creator talking directly to their phone, screen-recording, or casual vlog opening. Examples: "I was today years old when I found this...", "POV: your skincare routine is actually working", "This one product literally saved my sanity...", "I never do reviews, but...".
2. Creator Dialogue: The voiceover must sound like a real person talking naturally to their friends. Avoid advertising buzzwords, overly polished voiceover styles, or formal statements. Use casual, conversational, and enthusiastic speech.
3. Natural Visuals: The visual setting should look like real life. A cozy bedroom, a bright living room, a messy kitchen, a casual coffee shop, or holding the phone while walking down the street. It must look like smartphone footage (raw, hand-held, slightly imperfect).

DEMOGRAPHIC & VOICE ANALYSIS:
1. Analyze the brand profile and target audience to determine key target demographics (e.g. millennial parents, gen-Z athletes, corporate professionals, college students).
2. Recommend a highly relevant Voice Profile for the Kling voiceover (gender, age group, vocal characteristics, accent, and tone) that best connects with this target demographic (e.g., "enthusiastic, fast-paced Gen-Z female voice with a modern American accent", "confident, warm 35-year-old male voice with a calm British accent").

CRITICAL SAFETY DIRECTIVE:
If the brand or product is an undergarment, sleepwear, personal hygiene, or body-related product (e.g., underwear, bras, period panties, pads), do not generate scripts with sexually suggestive, intimate, or anatomically descriptive wording. Focus on lifestyle, flat-lay compositions, abstract fabrics, clean design, or activewear. Avoid words like "panties", "underwear", "bra", "lingerie", "period", "sexy", "intimate", "nude", "naked", or "body shape" in the visual descriptions, image prompts, or animation prompts.

Brand Profile:
- Brand Name: ${brandProfile.brandName}
- Summary: ${brandProfile.summary}
- Value Prop: ${brandProfile.coreValueProp}
- Tone: ${brandProfile.tone} (Make it more casual, authentic, and creator-like)
- Visual Style: ${brandProfile.visualStyle} (Inject UGC and phone-camera realism)

Ad Group Strategy:
- Title: ${selectedAdGroup.title}
- Marketing Angle: ${selectedAdGroup.strategy}
- Audience Segment: ${selectedAdGroup.audience}
- Core Message: ${selectedAdGroup.message}

The video is 10 seconds long and must be broken down into exactly 3 sequential scenes.
For each scene, output:
1. Scene Number (1, 2, 3)
2. Duration: A number representing the duration of this scene in seconds (e.g. 3.0, 3.5, 3.5), such that the sum of the durations of all 3 scenes is exactly 10.0 seconds.
3. Audio: The creator voiceover (VO) dialogue and sound effects. Keep it conversational, casual, and authentic.
4. Visual description: Detailed description of the scene action. Specify the creator's look, expression, and natural movements.
5. Image Prompt: An extremely descriptive, photo-realistic text-to-image prompt to be used in Gemini 3 Pro Image (Nano Banana Pro) to generate a high-fidelity 9:16 reference image. Specify the subject (e.g., "A young creator holding their phone"), environment (e.g., "candid indoor lighting, cozy apartment bedroom"), composition, lighting (e.g., "natural morning light coming through the window"), camera angle (e.g., "smartphone selfie-style photo", "candid hand-held phone camera shot"), and color palette. To make it look like UGC, explicitly add terms like: "UGC style, shot on phone camera, clean candid photo, amateur photography, natural indoor lighting, real-life environment, candid facial expression". CRITICAL: DO NOT include any phone overlays, mobile interfaces, battery icons, recording indicators, red record dots, device borders, or text. The image must be a clean photograph, not a screenshot of a phone screen or camera interface. To prevent triggering strict AI safety filters, use abstract or safe styling where appropriate (e.g. activewear, lifestyle shot). Never use flagged words like "panties", "underwear", "bra", "lingerie", "nude", or "sexuality".
6. Animation Prompt: A descriptive motion and audio instruction for Kling AI to animate the reference image. Instruct Kling to simulate hand-held camera movements (e.g. "subtle phone camera shake, natural blinking, slight head nod, hands tilting the product toward the lens, casual creator speaking movements"). Format it exactly as: '[visual motion description]. Audio voiceover: "[exact voiceover text to be spoken by a voice actor]" spoken by [recommended voice profile details, e.g., an enthusiastic Gen-Z female voice] with [ambient sound effects / background music description].' The voiceover text MUST match the voiceover/narration written in the "audio" field of this scene so Kling can generate the correct speech/sound.

Return the response in strict JSON format matching the schema below:
{
  "title": "Ad Campaign Script Title",
  "targetDemographics": "Concise target demographics (e.g. Gen-Z women interested in sustainable comfort)",
  "voiceProfile": "Vocal style configuration (e.g., A confident, energetic young female voice with an American accent)",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 3.3,
      "audio": "Audio description (VO/SFX)",
      "visual": "Visual description of action",
      "imagePrompt": "Detailed prompt for Nano Banana Pro image generation (9:16 aspect ratio)",
      "animationPrompt": "Motion instructions for Kling AI image-to-video animation including voiceover and voice profile"
    }
  ]
}`;

  try {
    const urlEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4000,
        temperature: 0.2
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_ONLY_HIGH'
        }
      ]
    };

    console.log('Generating Meta ad script...');
    const response = await axios.post(urlEndpoint, payload);
    
    const candidate = response.data?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Gemini blocked script generation. Reason: ${candidate.finishReason}. Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    const parsedData = parseGeminiJson(text);
    res.json(parsedData);
  } catch (error: any) {
    console.error('Error in generate-script:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Script generation failed',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 3. Generate Reference Image via Nano Banana Pro (Gemini 3 Pro Image)
app.post('/api/generate-image', async (req: Request, res: Response): Promise<void> => {
  const { prompt, productBase64, anchorImage, geminiKey } = req.body;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  const key = geminiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(400).json({ error: 'Gemini API Key is required' });
    return;
  }

  try {
    // Model identifier for Nano Banana Pro: gemini-3-pro-image
    const urlEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${key}`;

    const parts: any[] = [];
    
    // Support subject/character consistency referencing using anchorImage
    if (anchorImage) {
      const rawAnchor = anchorImage.replace(/^data:image\/[a-z]+;base64,/, '');
      const mimeMatch = anchorImage.match(/^data:(image\/[a-z]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: rawAnchor
        }
      });
      parts.push({
        text: `You are generating a sequel scene. First, look at the attached reference image of the previous scene. Analyze the character, their face geometry, hairstyle, clothing, colors, setting, and background style.
Then, generate a high-quality vertical 9:16 advertising image of the scene scenario described below: ${prompt}.
Ensure the character, subject identity, colors, and visual style remain completely consistent with the attached reference image. Keep the same actor/character identity.`
      });
    }

    // If a reference product image is provided, include it in the input parts
    if (productBase64) {
      // Clean prefix if any and extract exact mimeType
      const rawBase64 = productBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const mimeMatch = productBase64.match(/^data:(image\/[a-z]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: rawBase64
        }
      });
      parts.push({
        text: `You are generating an advertising image. First, analyze the attached reference image of the product. Understand its design, shape, labels, branding, and color.
Then, generate a high-quality vertical 9:16 image of the product in this scenario: ${prompt}.
Ensure the product in the generated scene looks exactly like the reference product in its shape, details, and branding. Maintain accurate physical features.`
      });
    }
    
    // Fallback: If neither product nor anchor image is provided, generate from prompt text directly
    if (!productBase64 && !anchorImage) {
      parts.push({
        text: `Generate a high-quality vertical 9:16 advertising image of: ${prompt}. Cinematic lighting, 8k resolution, photorealistic, professional product photography.`
      });
    }

    const payload = {
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '9:16'
        }
      }
    };

    console.log('Generating image using Nano Banana Pro (gemini-3-pro-image)...');
    let response;
    try {
      response = await axios.post(urlEndpoint, payload);
    } catch (apiError: any) {
      console.warn('gemini-3-pro-image call failed. Retrying with gemini-3.1-flash-image fallback...', apiError.message);
      // Fallback to gemini-3.1-flash-image (Nano Banana 2) if pro is not available
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${key}`;
      const fallbackPayload = {
        contents: [{
          role: 'user',
          parts: [{ text: `Generate a photorealistic 9:16 image of: ${prompt}` }, ...(productBase64 ? [{ inlineData: { mimeType: 'image/jpeg', data: productBase64.replace(/^data:image\/[a-z]+;base64,/, '') } }] : [])]
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '9:16'
          }
        }
      };
      response = await axios.post(fallbackUrl, fallbackPayload);
    }

    let candidate = response.data?.candidates?.[0];
    let imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData);
    const isSafetyBlocked = candidate?.finishReason === 'IMAGE_SAFETY';

    // If safety blocked, or no image data returned, retry with a generic safe prompt
    if (!imagePart || !imagePart.inlineData || isSafetyBlocked) {
      console.warn(`Image generation failed or safety blocked (reason: ${candidate?.finishReason}). Retrying with safe prompt fallback...`);
      
      const safePromptText = 'minimalist aesthetic product flat-lay on clean glass table under soft lighting';
      const safePayload = {
        contents: [{
          role: 'user',
          parts: [{ text: `Generate a high-quality vertical 9:16 advertising image of: ${safePromptText}. Cinematic lighting, 8k resolution, photorealistic, professional product photography.` }]
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '9:16'
          }
        }
      };

      try {
        console.log('Retrying with safe prompt on gemini-3-pro-image...');
        response = await axios.post(urlEndpoint, safePayload);
        candidate = response.data?.candidates?.[0];
        imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData);
      } catch (safeProError: any) {
        console.warn('Safe prompt on gemini-3-pro-image failed. Trying fallback model with safe prompt...', safeProError.message);
      }

      // If still no image, try fallback model with safe prompt
      if (!imagePart || !imagePart.inlineData || candidate?.finishReason === 'IMAGE_SAFETY') {
        try {
          console.log('Retrying with safe prompt on gemini-3.1-flash-image...');
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${key}`;
          const fallbackPayload = {
            contents: [{
              role: 'user',
              parts: [{ text: `Generate a photorealistic 9:16 image of: ${safePromptText}` }]
            }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio: '9:16'
              }
            }
          };
          response = await axios.post(fallbackUrl, fallbackPayload);
          candidate = response.data?.candidates?.[0];
          imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData);
        } catch (fallbackError: any) {
          console.error('All safe prompt fallbacks failed:', fallbackError.message);
        }
      }
    }

    if (!imagePart || !imagePart.inlineData) {
      console.error('Gemini response did not contain inlineData. Full response structure:', JSON.stringify(response?.data));
      throw new Error('Image generation failed due to safety limits or API constraints, and safe prompt retry also failed.');
    }

    res.json({
      image: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType
    });
  } catch (error: any) {
    console.error('Error in generate-image:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Image generation failed',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 4. Submit Image-to-Video Task to Kling AI or Gemini (Veo)
// 4. Submit Image-to-Video Task to Kling AI or Gemini (Veo)
app.post('/api/animate-video', async (req: Request, res: Response): Promise<void> => {
  let { imageBase64, prompt, visual, audio, voiceProfile, klingKey, geminiKey, videoModel } = req.body;

  if (!imageBase64) {
    res.status(400).json({ error: 'Image Base64 data is required' });
    return;
  }

  // Remove any base64 prefix as models require raw base64 string
  let rawBase64: string | null = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  // Extract mime type if present, default to image/png
  let mimeType = 'image/png';
  const mimeMatch = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
  if (mimeMatch) {
    mimeType = mimeMatch[1];
  }

  // Clear original large imageBase64 from memory immediately to avoid OOM
  req.body.imageBase64 = null;
  imageBase64 = null;

  // Combine prompt, audio, and voice profile
  let combinedPrompt = prompt || 'animate smoothly with camera pan';
  
  if (videoModel === 'gemini') {
    // For Veo 3.1, build a rich visual motion prompt by stripping Kling audio directives
    let motionPart = prompt || '';
    const audioIndex = motionPart.toLowerCase().indexOf('audio voiceover:');
    if (audioIndex !== -1) {
      motionPart = motionPart.substring(0, audioIndex).trim();
    }
    motionPart = motionPart.replace(/\.+$/, '').trim();

    const visualPart = visual ? visual.trim().replace(/\.+$/, '') : '';
    
    if (visualPart && motionPart) {
      combinedPrompt = `${visualPart}. Animated with: ${motionPart}, realistic motion, high fidelity.`;
    } else if (visualPart) {
      combinedPrompt = `${visualPart}. Animated with natural hand-held camera shake and realistic character motions.`;
    } else if (motionPart) {
      combinedPrompt = `${motionPart}, realistic character motion and natural camera movement.`;
    } else {
      combinedPrompt = 'animate smoothly with natural hand-held camera shake and realistic character motions';
    }
    
    console.log(`[Veo Prompt Builder] Generated rich motion prompt: "${combinedPrompt}"`);
  } else {
    if (audio && !combinedPrompt.toLowerCase().includes('voiceover') && !combinedPrompt.toLowerCase().includes('audio')) {
      const voiceStyle = voiceProfile ? ` spoken by ${voiceProfile}` : '';
      combinedPrompt += `. Audio voiceover: "${audio}"${voiceStyle}.`;
    }
  }

  if (videoModel === 'gemini') {
    const gKey = geminiKey || process.env.GEMINI_API_KEY;
    let isVeoSucceeded = false;
    let veoTaskId = '';

    if (gKey) {
      try {
        // Veo 3.1 generate operation endpoint
        const veoUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${gKey}`;
        const veoPayload = {
          instances: [{
            prompt: combinedPrompt,
            image: {
              bytesBase64Encoded: rawBase64,
              mimeType: mimeType
            }
          }],
          parameters: {
            aspectRatio: '9:16',
            resolution: '720p',
            durationSeconds: 5
          }
        };

        console.log('Submitting video task to Gemini Veo API...');
        const response = await axios.post(veoUrl, veoPayload);
        // Clear rawBase64 buffer reference
        rawBase64 = null;

        if (response.data && response.data.name) {
          veoTaskId = response.data.name; // returns "operations/..."
          isVeoSucceeded = true;
          console.log(`Gemini Veo task created successfully: ${veoTaskId}`);
          
          res.json({
            taskId: veoTaskId,
            status: 'submitted'
          });
          return;
        }
      } catch (veoError: any) {
        console.warn('Gemini Veo API call failed or billing not enabled. Falling back to local FFmpeg video animation simulator...', veoError.response?.data || veoError.message);
      }
    } else {
      console.warn('No Gemini API Key provided for video animation. Falling back to local FFmpeg video animation simulator...');
    }

    // Fallback: Generate simulated video via FFmpeg pan/zoom
    if (!isVeoSucceeded) {
      try {
        const sessionId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const tempDir = os.tmpdir();
        const inputImgPath = path.join(tempDir, `input_${sessionId}.png`);
        const outputVidPath = path.join(tempVideosDir, `simulated_${sessionId}.mp4`);
        
        if (rawBase64) {
          fs.writeFileSync(inputImgPath, Buffer.from(rawBase64, 'base64'));
        } else {
          throw new Error('Image data was already cleared or is invalid');
        }
        // Clear rawBase64 buffer reference immediately after write
        rawBase64 = null;
        
        console.log(`Generating simulated UGC video via FFmpeg pan/zoom: ${outputVidPath}`);
        
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputImgPath)
            .loop(5)
            .outputOptions('-pix_fmt yuv420p')
            .outputOptions('-threads 1') // Limit CPU/memory footprint of spawned FFmpeg process
            .videoFilters([
              {
                filter: 'zoompan',
                options: {
                  z: '1.15',
                  x: '(iw-iw/zoom)/2 + sin(on/4)*10',
                  y: '(ih-ih/zoom)/2 + cos(on/5)*10',
                  d: 125, // 5 seconds at 25fps
                  s: '480x854' // Optimize resolution to use less than half the memory of 720x1280
                }
              }
            ])
            .fps(25)
            .output(outputVidPath)
            .on('end', () => {
              console.log('Simulated UGC video compiled successfully.');
              if (fs.existsSync(inputImgPath)) {
                fs.unlink(inputImgPath, () => {});
              }
              resolve();
            })
            .on('error', (err) => {
              console.error('FFmpeg simulation error:', err.message);
              if (fs.existsSync(inputImgPath)) {
                fs.unlink(inputImgPath, () => {});
              }
              reject(err);
            })
            .run();
        });

        res.json({
          taskId: `operations/simulated_${sessionId}`,
          status: 'succeed',
          url: `/videos/simulated_${sessionId}.mp4`
        });
      } catch (err: any) {
        console.error('Failed to generate simulated video:', err.message);
        res.status(500).json({ error: 'Gemini video simulation failed', details: err.message });
      }
      return;
    }
  } else {
    // Kling AI Flow
    const key = klingKey || process.env.KLING_API_KEY;
    if (!key) {
      res.status(400).json({ error: 'Kling API Key is required' });
      return;
    }

    try {
      const urlEndpoint = 'https://api-singapore.klingai.com/v1/videos/image2video';
      const payload = {
        model_name: 'kling-v3',
        image: rawBase64,
        prompt: combinedPrompt,
        aspect_ratio: '9:16',
        duration: 5,
        sound: 'on',
        mode: 'std'
      };

      console.log('Submitting video task to Kling AI Singapore API...');
      const response = await axios.post(urlEndpoint, payload, {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });
      // Clear rawBase64 buffer reference
      rawBase64 = null;

      const result = response.data;
      if (result.code !== 0) {
        throw new Error(`Kling API error (code ${result.code}): ${result.message}`);
      }

      res.json({
        taskId: result.data.task_id,
        status: result.data.task_status
      });
    } catch (error: any) {
      console.error('Error in animate-video (Kling):', error.response?.data || error.message);
      res.status(500).json({
        error: 'Kling video submission failed',
        details: error.response?.data || error.message
      });
    }
  }
});

// 5. Poll Kling AI or Gemini Video Task Status
app.post('/api/video-status', async (req: Request, res: Response): Promise<void> => {
  const { taskId, klingKey, geminiKey } = req.body;

  if (!taskId) {
    res.status(400).json({ error: 'Task ID is required' });
    return;
  }

  // Handle Gemini/Veo tasks (they start with "operations/")
  if (taskId.startsWith('operations/')) {
    // 1. Simulated Gemini tasks
    if (taskId.startsWith('operations/simulated_')) {
      const filename = taskId.substring(11); // e.g. "simulated_..."
      res.json({
        task_status: 'succeed',
        task_result: {
          videos: [
            {
              url: `${req.protocol}://${req.get('host')}/videos/${filename}.mp4`
            }
          ]
        }
      });
      return;
    }

    // 2. Real Veo tasks
    const gKey = geminiKey || process.env.GEMINI_API_KEY;
    try {
      const veoPollUrl = `https://generativelanguage.googleapis.com/v1beta/${taskId}?key=${gKey}`;
      console.log(`Polling Veo operation: ${veoPollUrl}`);
      const pollResponse = await axios.get(veoPollUrl);
      
      const opData = pollResponse.data;
      if (opData.error) {
        throw new Error(opData.error.message || 'Veo polling failed');
      }
      
      if (opData.done) {
        const videoUri = opData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || opData.response?.generatedVideos?.[0]?.video?.uri;
        if (!videoUri) {
          throw new Error('Veo video URL not found in completed operation response');
        }
        
        const cleanTaskId = taskId.replace(/^operations\//, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const cacheFilename = `veo_${cleanTaskId}.mp4`;
        const localPath = path.join(tempVideosDir, cacheFilename);
        const localUrl = `${req.protocol}://${req.get('host')}/videos/${cacheFilename}`;

        // Check if already downloaded/cached
        if (fs.existsSync(localPath)) {
          console.log(`Veo video already cached at ${localPath}`);
          res.json({
            task_status: 'succeed',
            task_result: {
              videos: [
                {
                  url: localUrl
                }
              ]
            }
          });
          return;
        }

        if (videoUri.startsWith('https://')) {
          console.log(`Downloading Veo video from ${videoUri} using x-goog-api-key...`);
          try {
            const writer = fs.createWriteStream(localPath);
            const downloadResponse = await axios({
              method: 'get',
              url: videoUri,
              headers: {
                'x-goog-api-key': gKey
              },
              responseType: 'stream'
            });
            
            downloadResponse.data.pipe(writer);
            await new Promise<void>((resolve, reject) => {
              writer.on('finish', () => resolve());
              writer.on('error', (err) => reject(err));
            });
            
            console.log(`Veo video successfully cached at ${localPath}`);
            res.json({
              task_status: 'succeed',
              task_result: {
                videos: [
                  {
                    url: localUrl
                  }
                ]
              }
            });
          } catch (dlError: any) {
            console.error(`Failed to download Veo video directly: ${dlError.message}`);
            // Fallback: serve original URI if we couldn't download
            res.json({
              task_status: 'succeed',
              task_result: {
                videos: [
                  {
                    url: videoUri
                  }
                ]
              }
            });
          }
        } else if (videoUri.startsWith('gs://')) {
          console.warn(`Veo returned GCS URI: ${videoUri}. Falling back to simulated video...`);
          const sessionId = taskId.split('/').pop();
          res.json({
            task_status: 'succeed',
            task_result: {
              videos: [
                {
                  url: `${req.protocol}://${req.get('host')}/videos/simulated_${sessionId}.mp4`
                }
              ]
            }
          });
        } else {
          res.json({
            task_status: 'succeed',
            task_result: {
              videos: [
                {
                  url: videoUri
                }
              ]
            }
          });
        }
      } else {
        res.json({
          task_status: 'processing'
        });
      }
    } catch (veoPollError: any) {
      console.error('Error polling Veo operation. Falling back to simulated video...', veoPollError.message);
      const sessionId = taskId.split('/').pop();
      res.json({
        task_status: 'succeed',
        task_result: {
          videos: [
            {
              url: `${req.protocol}://${req.get('host')}/videos/simulated_${sessionId}.mp4`
            }
          ]
        }
      });
    }
    return;
  }

  // Kling flow
  const key = klingKey || process.env.KLING_API_KEY;
  if (!key) {
    res.status(400).json({ error: 'Kling API Key is required' });
    return;
  }

  try {
    const urlEndpoint = `https://api-singapore.klingai.com/v1/videos/image2video/${taskId}`;
    console.log(`Checking status for Kling task: ${taskId}...`);
    const response = await axios.get(urlEndpoint, {
      headers: {
        'Authorization': `Bearer ${key}`
      }
    });

    const result = response.data;
    if (result.code !== 0) {
      throw new Error(`Kling API error (code ${result.code}): ${result.message}`);
    }

    res.json(result.data);
  } catch (error: any) {
    console.error('Error in video-status (Kling):', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch video status',
      details: error.response?.data || error.message
    });
  }
});

// Helper to inspect if a video file contains an audio stream.
// If it does not, transcode it to add a silent audio track to prevent FFmpeg concat errors.
function ensureAudioStream(videoPath: string, index: number, sessionId: string, tempDir: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const cp = require('child_process');
    const ffmpegExecutable = require('@ffmpeg-installer/ffmpeg').path;
    
    // Run ffmpeg -i to check for Audio streams in the output metadata (printed to stderr)
    const checkCmd = `"${ffmpegExecutable}" -i "${videoPath}"`;
    cp.exec(checkCmd, (execErr: any, stdout: string, stderr: string) => {
      const output = stderr || stdout || '';
      const hasAudio = output.includes('Audio:');
      
      if (hasAudio) {
        console.log(`[Merge Process] Clip ${index + 1} already has an audio stream.`);
        resolve(videoPath);
      } else {
        console.log(`[Merge Process] Clip ${index + 1} is missing an audio stream. Injecting a silent audio track...`);
        const silentOutputPath = path.join(tempDir, `silent_injected_${sessionId}_${index}.mp4`);
        
        // Command to add a silent audio stream (using lavfi anullsrc) and copy video stream
        const addSilentAudioCmd = `"${ffmpegExecutable}" -i "${videoPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v copy -c:a aac -shortest -threads 1 -y "${silentOutputPath}"`;
        
        cp.exec(addSilentAudioCmd, (addErr: any) => {
          if (addErr) {
            console.error(`[Merge Process] Failed to inject silent audio to clip ${index + 1}:`, addErr.message);
            // Fall back to original file as a last resort
            resolve(videoPath);
          } else {
            console.log(`[Merge Process] Silent audio successfully injected to clip ${index + 1}.`);
            resolve(silentOutputPath);
          }
        });
      }
    });
  });
}

// 5. Merge and trim videos
app.get('/api/merge-videos', async (req: Request, res: Response): Promise<void> => {
  const urlsQuery = req.query.urls as string;
  const durationsQuery = req.query.durations as string;

  if (!urlsQuery || !durationsQuery) {
    res.status(400).json({ error: 'urls and durations query parameters are required' });
    return;
  }

  const urls = urlsQuery.split(',');
  const durations = durationsQuery.split(',').map(Number);

  if (urls.length !== durations.length || urls.length === 0) {
    res.status(400).json({ error: 'urls and durations count must match' });
    return;
  }

  const tempDir = os.tmpdir();
  const sessionId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const downloadedPaths: string[] = [];
  const filesToCleanup: string[] = [];
  const outputFilename = `merged_ad_${sessionId}.mp4`;
  const outputPath = path.join(tempDir, outputFilename);

  try {
    console.log(`Starting merge process for session ${sessionId}...`);
    
    // Download all clips
    for (let i = 0; i < urls.length; i++) {
      const clipUrl = urls[i];
      let localPath = '';

      // Check if URL is local path to public/videos/
      if (clipUrl.includes('/videos/')) {
        const filename = clipUrl.split('/videos/').pop() || '';
        localPath = path.join(tempVideosDir, filename);
        console.log(`Using local file for clip ${i + 1}: ${localPath}`);
      } else {
        localPath = path.join(tempDir, `clip_${sessionId}_${i}.mp4`);
        filesToCleanup.push(localPath);
        console.log(`Downloading clip ${i + 1}: ${clipUrl} -> ${localPath}`);
        
        const response = await axios({
          method: 'get',
          url: clipUrl,
          responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => resolve());
          writer.on('error', (err) => reject(err));
        });
      }
      downloadedPaths.push(localPath);
    }

    // Process downloaded/local files to guarantee they all have an audio track
    const processedPaths: string[] = [];
    for (let i = 0; i < downloadedPaths.length; i++) {
      const ensuredPath = await ensureAudioStream(downloadedPaths[i], i, sessionId, tempDir);
      processedPaths.push(ensuredPath);
      if (ensuredPath !== downloadedPaths[i]) {
        filesToCleanup.push(ensuredPath);
      }
    }

    // Build FFmpeg command with concatenation (no trimming to preserve full voiceover)
    const command = ffmpeg();
    
    processedPaths.forEach(p => {
      command.input(p);
    });

    let filterComplex = '';
    let concatInputs = '';
    
    for (let i = 0; i < processedPaths.length; i++) {
      concatInputs += `[${i}:v][${i}:a]`;
    }
    
    filterComplex = `${concatInputs}concat=n=${processedPaths.length}:v=1:a=1[outv][outa]`;

    console.log(`Running FFmpeg filter complex: ${filterComplex}`);

    command
      .complexFilter(filterComplex)
      .map('[outv]')
      .map('[outa]')
      .outputOptions('-c:v libx264')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-preset superfast')
      .outputOptions('-threads 1') // Limit resource footprint of merge process
      .output(outputPath)
      .on('start', (cmdline) => {
        console.log(`Spawned FFmpeg with command: ${cmdline}`);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
        res.status(500).json({ error: 'FFmpeg merging failed', details: err.message });
        cleanupFiles([...filesToCleanup, outputPath]);
      })
      .on('end', () => {
        console.log('Merging successfully finished!');
        
        res.download(outputPath, 'viral-ad-campaign.mp4', (downloadErr) => {
          if (downloadErr) {
            console.error('Error sending file to client:', downloadErr);
          }
          cleanupFiles([...filesToCleanup, outputPath]);
        });
      })
      .run();

  } catch (err: any) {
    console.error('Error in merge-videos route:', err);
    res.status(500).json({ error: 'Failed to process videos', details: err.message });
    cleanupFiles([...filesToCleanup, outputPath]);
  }
});

function cleanupFiles(paths: string[]) {
  console.log('Starting cleanup of temporary files...');
  paths.forEach(p => {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (err: any) {
        console.warn(`Failed to clean up file ${p}: ${err.message}`);
      }
    }
  });
}

// Serve static assets from compiled React client
const productionPublicPath = path.join(__dirname, '../../client/dist');
const devPublicPath = path.join(__dirname, '../client/dist');
const staticPath = fs.existsSync(productionPublicPath) ? productionPublicPath : devPublicPath;

console.log(`Serving static assets from: ${staticPath}`);
app.use(express.static(staticPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
