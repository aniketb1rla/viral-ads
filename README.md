# ViralAd.AI - Professional AI Video Ad Generator

ViralAd.AI is a best-in-class AI-powered video ad generator that acts as a professional campaign builder. It analyzes brand URLs using Gemini's search grounding, builds target ad groups, drafts Meta vertical video scripts (complete with scroll-stopping hooks), generates frame reference images via **Nano Banana Pro** (Gemini 3 Pro Image), and animates them into 10s 720p vertical video ads using the Singapore **Kling AI v3-Turbo** API.

## 🚀 One-Click Deploy to Render

This repository is pre-configured with a **Render Blueprint** (`render.yaml`) to run the full-stack app on a **single free Web Service instance**, saving cost and setup time.

### Step-by-Step Deployment:
1. Log in to your [Render Dashboard](https://dashboard.render.com).
2. Go to **Blueprints** and click **New Blueprint Instance** (or click **New +** > **Blueprint**).
3. Connect your GitHub account and select this repository: `aniketb1rla/viral-ads`.
4. Render will read the `render.yaml` file automatically and prompt you for the following environment variables:
   - `GEMINI_API_KEY`: Your Google AI Studio API Key.
   - `KLING_API_KEY`: Your Kling AI API Key.
5. Click **Apply**.
6. Render will automatically install packages, compile the Vite frontend, build the Express server, and start the deployment.

Once deployed, your Web Service URL will be live!

---

## 🛠️ Local Development

To run the application locally:

### 1. Install dependencies
From the root directory, run:
```bash
npm run install-all
```

### 2. Configure Environment variables
Create a `.env` file inside the `server/` directory:
```env
GEMINI_API_KEY=your_gemini_key_here
KLING_API_KEY=your_kling_key_here
PORT=3001
```

### 3. Start Development Servers
- **Backend Server**: Navigate to `/server` and run `npm run dev` (starts Express on port `3001`).
- **Frontend Client**: Navigate to `/client` and run `npm run dev` (starts Vite on port `5173`).

Open [http://localhost:5173](http://localhost:5173) in your browser to experience the app.
