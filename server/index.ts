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

  const prompt = `Perform a google search for the URL: "${url}". Analyze the website, Play Store, or App Store link. Summarize the brand, its services or product offerings, target audience, core value proposition, tone of voice, and recommended visual style. Then, create exactly 3 distinct target ad groups or campaign concepts for vertical video ads on Meta.
Keep all descriptions, strategies, and summaries extremely concise, direct, and under 2 sentences to prevent token limits and truncation.
Return the response in strict JSON format matching the schema below. Do not wrap the JSON in comments or any text other than valid JSON.

JSON Schema:
{
  "brandName": "Name of the brand/app",
  "summary": "Brief summary of what they do",
  "targetAudience": "Description of target audience",
  "coreValueProp": "Core value proposition",
  "tone": "e.g. Professional, energetic, humorous, emotional",
  "visualStyle": "Visual style details for video ads (e.g. vibrant colors, clean minimal, dark mode neon)",
  "adGroups": [
    {
      "id": "ad-group-1",
      "title": "Ad Group Title (e.g., Feature Highlight, Customer Story)",
      "strategy": "Marketing angle/strategy description",
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

  const prompt = `You are a professional Meta Ads scriptwriter specializing in high-converting, scroll-stopping vertical videos (9:16, 10 seconds duration).
Write a vertical video ad script for the following brand and ad group concept.
Keep all scene audio, visual descriptions, image prompts, and animation prompts descriptive but concise (under 2-3 sentences per field) to prevent token limits and truncation.

DEMOGRAPHIC & VOICE ANALYSIS:
1. Analyze the brand profile and target audience to determine key target demographics (e.g. millennial parents, gen-Z athletes, corporate professionals, college students).
2. Recommend a highly relevant Voice Profile for the Kling voiceover (gender, age group, vocal characteristics, accent, and tone) that best connects with this target demographic (e.g., "enthusiastic, fast-paced Gen-Z female voice with a modern American accent", "confident, warm 35-year-old male voice with a calm British accent").

CRITICAL SAFETY DIRECTIVE:
If the brand or product is an undergarment, sleepwear, personal hygiene, or body-related product (e.g., underwear, bras, period panties, pads), do not generate scripts with sexually suggestive, intimate, or anatomically descriptive wording. Focus on lifestyle, flat-lay compositions, abstract fabrics, clean design, or activewear. Avoid words like "panties", "underwear", "bra", "lingerie", "period", "sexy", "intimate", "nude", "naked", or "body shape" in the visual descriptions, image prompts, or animation prompts.

Brand Profile:
- Brand Name: ${brandProfile.brandName}
- Summary: ${brandProfile.summary}
- Value Prop: ${brandProfile.coreValueProp}
- Tone: ${brandProfile.tone}
- Visual Style: ${brandProfile.visualStyle}

Ad Group Strategy:
- Title: ${selectedAdGroup.title}
- Marketing Angle: ${selectedAdGroup.strategy}
- Audience Segment: ${selectedAdGroup.audience}
- Core Message: ${selectedAdGroup.message}

The video is 10 seconds long and must be broken down into exactly 3 sequential scenes.
For each scene, output:
1. Scene Number (1, 2, 3)
2. Duration: A number representing the duration of this scene in seconds (e.g. 3.0, 3.5, 3.5), such that the sum of the durations of all 3 scenes is exactly 10.0 seconds.
3. Audio: The hook, voiceover (VO), sound effects (SFX), or music. Make the Hook in Scene 1 extremely scroll-stopping (can be a bold statement, visual-audio sync, etc.).
4. Visual description: Detailed action taking place.
5. Image Prompt: An extremely descriptive, cinematic text-to-image prompt to be used in Gemini 3 Pro Image (Nano Banana Pro) to generate a high-fidelity 9:16 reference image. Specify the subject, composition, environment, lighting (e.g. volumetric lighting, neon glow), color palette, and camera angle. Focus on visual styling. DO NOT include any text inside the image. To prevent triggering strict AI safety filters, use abstract or safe styling (e.g., "premium cotton apparel flat-lay", "aesthetic comfort activewear", "minimalist textile display on a wooden shelf", "clean product packaging on glass"). Never use flagged words like "panties", "underwear", "bra", "lingerie", "nude", or "sexuality".
6. Animation Prompt: A descriptive motion and audio instruction for Kling AI to animate the reference image and generate matching audio. Combine visual motion and voiceover/audio instructions. Format it exactly as: '[visual motion description]. Audio voiceover: "[exact voiceover text to be spoken by a voice actor]" spoken by [recommended voice profile details, e.g., an enthusiastic Gen-Z female voice] with [ambient sound effects / background music description].' The voiceover text MUST match the voiceover/narration written in the "audio" field of this scene so Kling can generate the correct speech/sound.

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
  const { prompt, productBase64, geminiKey } = req.body;

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
    } else {
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

// 4. Submit Image-to-Video Task to Kling AI (api-singapore.klingai.com)
app.post('/api/animate-video', async (req: Request, res: Response): Promise<void> => {
  const { imageBase64, prompt, audio, voiceProfile, klingKey } = req.body;

  if (!imageBase64) {
    res.status(400).json({ error: 'Image Base64 data is required' });
    return;
  }

  const key = klingKey || process.env.KLING_API_KEY;
  if (!key) {
    res.status(400).json({ error: 'Kling API Key is required' });
    return;
  }

  // Remove any base64 prefix (e.g. data:image/png;base64,) as Kling requires raw base64 string
  const rawBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  // Combine prompt, audio, and voice profile to ensure Kling generates the correct voiceover speech
  let combinedPrompt = prompt || 'animate smoothly with camera pan';
  if (audio && !combinedPrompt.toLowerCase().includes('voiceover') && !combinedPrompt.toLowerCase().includes('audio')) {
    const voiceStyle = voiceProfile ? ` spoken by ${voiceProfile}` : '';
    combinedPrompt += `. Audio voiceover: "${audio}"${voiceStyle}.`;
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
      mode: 'std' // std is 720p as requested
    };

    console.log('Submitting video task to Kling AI Singapore API...');
    const response = await axios.post(urlEndpoint, payload, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });

    const result = response.data;
    if (result.code !== 0) {
      throw new Error(`Kling API error (code ${result.code}): ${result.message}`);
    }

    res.json({
      taskId: result.data.task_id,
      status: result.data.task_status
    });
  } catch (error: any) {
    console.error('Error in animate-video:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Kling video submission failed',
      details: error.response?.data || error.message
    });
  }
});

// 5. Poll Kling AI Video Task Status
app.post('/api/video-status', async (req: Request, res: Response): Promise<void> => {
  const { taskId, klingKey } = req.body;

  if (!taskId) {
    res.status(400).json({ error: 'Task ID is required' });
    return;
  }

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
    console.error('Error in video-status:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch video status',
      details: error.response?.data || error.message
    });
  }
});

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
  const inputPaths: string[] = [];
  const outputFilename = `merged_ad_${sessionId}.mp4`;
  const outputPath = path.join(tempDir, outputFilename);

  try {
    console.log(`Starting merge process for session ${sessionId}...`);
    
    // Download all clips
    for (let i = 0; i < urls.length; i++) {
      const clipUrl = urls[i];
      const localPath = path.join(tempDir, `clip_${sessionId}_${i}.mp4`);
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
      inputPaths.push(localPath);
    }

    // Build FFmpeg command with concatenation (no trimming to preserve full voiceover)
    const command = ffmpeg();
    
    inputPaths.forEach(p => {
      command.input(p);
    });

    let filterComplex = '';
    let concatInputs = '';
    
    for (let i = 0; i < inputPaths.length; i++) {
      concatInputs += `[${i}:v][${i}:a]`;
    }
    
    filterComplex = `${concatInputs}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;

    console.log(`Running FFmpeg filter complex: ${filterComplex}`);

    command
      .complexFilter(filterComplex)
      .map('[outv]')
      .map('[outa]')
      .outputOptions('-c:v libx264')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-preset superfast')
      .output(outputPath)
      .on('start', (cmdline) => {
        console.log(`Spawned FFmpeg with command: ${cmdline}`);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
        res.status(500).json({ error: 'FFmpeg merging failed', details: err.message });
        cleanupFiles(inputPaths, outputPath);
      })
      .on('end', () => {
        console.log('Merging successfully finished!');
        
        res.download(outputPath, 'viral-ad-campaign.mp4', (downloadErr) => {
          if (downloadErr) {
            console.error('Error sending file to client:', downloadErr);
          }
          cleanupFiles(inputPaths, outputPath);
        });
      })
      .run();

  } catch (err: any) {
    console.error('Error in merge-videos route:', err);
    res.status(500).json({ error: 'Failed to process videos', details: err.message });
    cleanupFiles(inputPaths, outputPath);
  }
});

function cleanupFiles(inputs: string[], output: string) {
  console.log('Starting cleanup of temporary files...');
  inputs.forEach(p => {
    if (fs.existsSync(p)) {
      fs.unlink(p, () => {});
    }
  });
  if (fs.existsSync(output)) {
    fs.unlink(output, () => {});
  }
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
