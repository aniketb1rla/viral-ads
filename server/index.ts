import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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
        responseMimeType: 'application/json'
      }
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
          responseMimeType: 'application/json'
        }
      };
      
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
      response = await axios.post(fallbackUrl, fallbackPayload);
    }

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
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

The video is 10 seconds long and must be broken down into exactly 3 sequential scenes (representing approx 3.3 seconds each).
For each scene, output:
1. Scene Number (1, 2, 3)
2. Audio: The hook, voiceover (VO), sound effects (SFX), or music. Make the Hook in Scene 1 extremely scroll-stopping (can be a bold statement, visual-audio sync, etc.).
3. Visual description: Detailed action taking place.
4. Image Prompt: An extremely descriptive, cinematic text-to-image prompt to be used in Gemini 3 Pro Image (Nano Banana Pro) to generate a high-fidelity 9:16 reference image. Specify the subject, composition, environment, lighting (e.g. volumetric lighting, neon glow), color palette, and camera angle. Focus on visual styling. DO NOT include any text inside the image.
5. Animation Prompt: A descriptive motion instruction for Kling AI to animate the generated reference image. Describe the camera movement (e.g., slow zoom-in, cinematic pan) and the action/movement in the frame (e.g. steam rising, neon lights flickering, water droplets rolling).

Return the response in strict JSON format matching the schema below:
{
  "title": "Ad Campaign Script Title",
  "scenes": [
    {
      "sceneNumber": 1,
      "audio": "Audio description (VO/SFX)",
      "visual": "Visual description of action",
      "imagePrompt": "Detailed prompt for Nano Banana Pro image generation (9:16 aspect ratio)",
      "animationPrompt": "Motion instructions for Kling AI image-to-video animation"
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
        responseMimeType: 'application/json'
      }
    };

    console.log('Generating Meta ad script...');
    const response = await axios.post(urlEndpoint, payload);
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
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
      // Clean prefix if any
      const rawBase64 = productBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
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

    const candidate = response.data?.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData);

    if (!imagePart || !imagePart.inlineData) {
      console.error('Gemini response did not contain inlineData. Full response structure:', JSON.stringify(response.data));
      throw new Error('Image generation succeeded but no image data was returned. Check key permissions for image modality.');
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
  const { imageBase64, prompt, klingKey } = req.body;

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

  try {
    const urlEndpoint = 'https://api-singapore.klingai.com/v1/videos/image2video';
    const payload = {
      model_name: 'kling-v3',
      image: rawBase64,
      prompt: prompt || 'animate smoothly with camera pan',
      aspect_ratio: '9:16',
      duration: 10,
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
