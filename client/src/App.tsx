import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Globe,
  Upload,
  Trash2,
  Settings,
  Play,
  Download,
  Film,
  ArrowRight,
  ArrowLeft,
  Video,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  FileText
} from 'lucide-react';

let API_BASE = localStorage.getItem('api_base_url') || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);

interface AdGroup {
  id: string;
  title: string;
  strategy: string;
  audience: string;
  message: string;
}

interface BrandProfile {
  brandName: string;
  summary: string;
  targetAudience: string;
  coreValueProp: string;
  tone: string;
  visualStyle: string;
  adGroups: AdGroup[];
}

interface Scene {
  sceneNumber: number;
  duration: number;
  audio: string;
  visual: string;
  imagePrompt: string;
  animationPrompt: string;
}

interface Script {
  title: string;
  scenes: Scene[];
  targetDemographics?: string;
  voiceProfile?: string;
}

interface FrameState {
  sceneNumber: number;
  image: string | null; // base64 string
  status: 'idle' | 'generating' | 'completed' | 'failed';
  error?: string;
}

interface VideoState {
  sceneNumber: number;
  taskId: string | null;
  status: 'idle' | 'submitted' | 'processing' | 'succeed' | 'failed';
  url: string | null;
  error?: string;
}

export default function App() {
  // Navigation / Wizard
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>('');

  // Setup Inputs
  const [url, setUrl] = useState<string>('');
  const [productType, setProductType] = useState<'digital' | 'physical'>('digital');
  const [productImage, setProductImage] = useState<string | null>(null);
  
  // API Keys (Prefilled, but customizable)
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [klingKey, setKlingKey] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Brand Analysis & Strategy
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [selectedAdGroup, setSelectedAdGroup] = useState<AdGroup | null>(null);

  // Script & Storyboard
  const [script, setScript] = useState<Script | null>(null);

  // Production State
  const [frames, setFrames] = useState<FrameState[]>([
    { sceneNumber: 1, image: null, status: 'idle' },
    { sceneNumber: 2, image: null, status: 'idle' },
    { sceneNumber: 3, image: null, status: 'idle' }
  ]);
  const [videos, setVideos] = useState<VideoState[]>([
    { sceneNumber: 1, taskId: null, status: 'idle', url: null },
    { sceneNumber: 2, taskId: null, status: 'idle', url: null },
    { sceneNumber: 3, taskId: null, status: 'idle', url: null }
  ]);

  // Sequential Player state
  const [playingVideoIndex, setPlayingVideoIndex] = useState<number>(0);
  const [autoPlayAll, setAutoPlayAll] = useState<boolean>(true);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const [hasAutoMerged, setHasAutoMerged] = useState<boolean>(false);

  // Check if all videos are ready for sequential player
  const activeSucceedVideos = videos.filter(v => v.status === 'succeed' && v.url);
  const allVideosCompleted = activeSucceedVideos.length === videos.length && videos.length > 0;

  // Polling intervals reference
  const pollingIntervals = useRef<{ [key: number]: any }>({});
  
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(API_BASE);
  const handleApiBaseChange = (val: string) => {
    setApiBaseUrlState(val);
    API_BASE = val;
    localStorage.setItem('api_base_url', val);
  };

  // Clean up polling on step change or unmount
  useEffect(() => {
    return () => {
      Object.values(pollingIntervals.current).forEach(clearInterval);
      pollingIntervals.current = {};
    };
  }, [step]);

  // Auto-animate frames on image completion
  useEffect(() => {
    if (step !== 4) return;
    frames.forEach(frame => {
      if (frame.status === 'completed' && frame.image) {
        const video = videos.find(v => v.sceneNumber === frame.sceneNumber);
        if (video && video.status === 'idle') {
          animateFrame(frame.sceneNumber);
        }
      }
    });
  }, [frames, videos, step]);

  // Auto-merge videos when all completed
  useEffect(() => {
    if (!script) return;
    if (allVideosCompleted && !hasAutoMerged) {
      setHasAutoMerged(true);
      const urls = videos.map(v => v.url).join(',');
      const durations = script.scenes.map(s => s.duration).join(',');
      const downloadUrl = `${API_BASE}/api/merge-videos?urls=${encodeURIComponent(urls)}&durations=${encodeURIComponent(durations)}`;
      window.open(downloadUrl, '_blank');
    }
  }, [allVideosCompleted, hasAutoMerged, videos, script]);

  // Handle Drag & Drop / File Select for Product Image
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Step 1: Analyze URL
  const handleAnalyzeBrand = async () => {
    if (!url) return;
    setLoading(true);
    setLoadingMsg('Crawling & analyzing your brand URL with Gemini Groundsearch...');
    
    try {
      const response = await fetch(`${API_BASE}/api/analyze-brand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, geminiKey })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Brand analysis failed');
      }
      setBrandProfile(data);
      // Auto select the first ad group as default
      if (data.adGroups && data.adGroups.length > 0) {
        setSelectedAdGroup(data.adGroups[0]);
      }
      setStep(2);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Generate Script for selected Ad Group
  const handleGenerateScript = async () => {
    if (!brandProfile || !selectedAdGroup) return;
    setLoading(true);
    setLoadingMsg('Crafting scrolling-stopping hook & writing professional vertical ad script...');

    try {
      const response = await fetch(`${API_BASE}/api/generate-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandProfile, selectedAdGroup, geminiKey })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Script generation failed');
      }
      setScript(data);
      // Initialize frame and video states for the scenes
      setFrames(data.scenes.map((s: Scene) => ({ sceneNumber: s.sceneNumber, image: null, status: 'idle' })));
      setVideos(data.scenes.map((s: Scene) => ({ sceneNumber: s.sceneNumber, taskId: null, status: 'idle', url: null })));
      setHasAutoMerged(false);
      setStep(3);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 3 -> Go to Production
  const handleProceedToProduction = () => {
    setStep(4);
    // Auto-start generating all frame images as soon as approved
    setTimeout(() => {
      generateAllFrames();
    }, 200);
  };

  // Phase A: Generate Frame Reference Image via Nano Banana Pro
  const generateFrameImage = async (sceneNumber: number, currentFramesList?: FrameState[]): Promise<string | null> => {
    const scene = script?.scenes.find(s => s.sceneNumber === sceneNumber);
    if (!scene) return null;

    setFrames(prev => prev.map(f => f.sceneNumber === sceneNumber ? { ...f, status: 'generating', error: undefined } : f));

    try {
      // Find Scene 1's image to serve as a character/subject consistency anchor for Scenes 2 and 3
      let anchorImage: string | null = null;
      if (sceneNumber > 1) {
        const listToSearch = currentFramesList || frames;
        const scene1Frame = listToSearch.find(f => f.sceneNumber === 1);
        if (scene1Frame && scene1Frame.image && (scene1Frame.status === 'completed' || scene1Frame.image)) {
          anchorImage = scene1Frame.image;
        }
      }

      const response = await fetch(`${API_BASE}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: scene.imagePrompt,
          productBase64: productType === 'physical' ? productImage : null,
          anchorImage,
          geminiKey
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Image generation failed');
      }
      setFrames(prev => prev.map(f => f.sceneNumber === sceneNumber ? { ...f, image: data.image, status: 'completed' } : f));
      return data.image;
    } catch (err: any) {
      setFrames(prev => prev.map(f => f.sceneNumber === sceneNumber ? { ...f, status: 'failed', error: err.message } : f));
      return null;
    }
  };

  const generateAllFrames = async () => {
    // Generate sequentially to allow Scene 1 to complete and anchor Scenes 2 and 3
    const scene1Image = await generateFrameImage(1);
    
    // Create a temporary updated list so Scene 2 and 3 have immediate access to Scene 1's completed image
    const updatedList: FrameState[] = [
      { sceneNumber: 1, image: scene1Image, status: scene1Image ? 'completed' : 'failed' },
      { sceneNumber: 2, image: null, status: 'idle' },
      { sceneNumber: 3, image: null, status: 'idle' }
    ];

    await generateFrameImage(2, updatedList);
    await generateFrameImage(3, updatedList);
  };

  // Phase B: Animate Frame using Kling AI (Singapore v3 API)
  const animateFrame = async (sceneNumber: number) => {
    const frame = frames.find(f => f.sceneNumber === sceneNumber);
    const scene = script?.scenes.find(s => s.sceneNumber === sceneNumber);
    if (!frame || !frame.image || !scene) return;

    setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? { ...v, status: 'submitted', error: undefined } : v));

    try {
      const response = await fetch(`${API_BASE}/api/animate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: frame.image,
          prompt: scene.animationPrompt,
          audio: scene.audio,
          voiceProfile: script?.voiceProfile,
          klingKey
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Video animation submission failed');
      }

      setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? { ...v, taskId: data.taskId, status: 'submitted' } : v));

      // Start Polling
      startVideoStatusPolling(sceneNumber, data.taskId);
    } catch (err: any) {
      setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? { ...v, status: 'failed', error: err.message } : v));
    }
  };

  const animateAllFrames = async () => {
    const activeFrames = frames.filter(f => f.status === 'completed' && f.image);
    for (const f of activeFrames) {
      await animateFrame(f.sceneNumber);
    }
  };

  // Polling Logic for Kling status
  const startVideoStatusPolling = (sceneNumber: number, taskId: string) => {
    // Clear existing interval if any
    if (pollingIntervals.current[sceneNumber]) {
      clearInterval(pollingIntervals.current[sceneNumber]);
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/video-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, klingKey })
        });
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Polling failed');
        }

        const taskStatus = data.task_status;
        console.log(`Polling scene ${sceneNumber}: ${taskStatus}`);

        if (taskStatus === 'succeed') {
          clearInterval(interval);
          delete pollingIntervals.current[sceneNumber];
          
          const videoUrl = data.task_result?.videos?.[0]?.url || null;
          setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? {
            ...v,
            status: 'succeed',
            url: videoUrl
          } : v));
        } else if (taskStatus === 'failed') {
          clearInterval(interval);
          delete pollingIntervals.current[sceneNumber];
          setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? {
            ...v,
            status: 'failed',
            error: 'Kling video generation failed'
          } : v));
        } else if (taskStatus === 'processing') {
          setVideos(prev => prev.map(v => v.sceneNumber === sceneNumber ? {
            ...v,
            status: 'processing'
          } : v));
        }
      } catch (err: any) {
        console.error('Polling error for scene', sceneNumber, err);
      }
    }, 4000); // Poll every 4 seconds

    pollingIntervals.current[sceneNumber] = interval;
  };

  // Video Sequence Playback Handling
  const handleVideoEnded = () => {
    if (!autoPlayAll) return;
    const completedVideosCount = videos.filter(v => v.status === 'succeed' && v.url).length;
    if (completedVideosCount === 0) return;

    setPlayingVideoIndex(prev => {
      const nextIndex = prev + 1;
      const validVideos = videos.filter(v => v.status === 'succeed' && v.url);
      if (nextIndex < validVideos.length) {
        return nextIndex;
      }
      return 0; // loop back to first
    });
  };

  // Effect to load and play next video when index changes
  useEffect(() => {
    if (videoPlayerRef.current) {
      videoPlayerRef.current.load();
      videoPlayerRef.current.play().catch(e => console.warn('Autoplay blocked:', e));
    }
  }, [playingVideoIndex]);



  return (
    <div className="app-container">
      {/* Top Brand Header & Settings */}
      <div className="settings-bar">
        <div className="brand-header">
          <Film className="spinning text-purple-400" style={{ color: '#a78bfa' }} size={28} />
          <h2 style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: '1.4rem' }}>
            Viral<span style={{ color: '#8b5cf6' }}>Ad</span>.AI
          </h2>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          <Settings size={16} /> API Settings
        </button>
      </div>

      {/* Setup API Keys Modal */}
      {showSettings && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.25rem' }}>API Configuration</h3>
              <button className="modal-close" onClick={() => setShowSettings(false)}>&times;</button>
            </div>
            
            <div className="form-group">
              <label className="form-label">Gemini API Key</label>
              <div className="input-container">
                <input
                  type="password"
                  className="form-input"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Enter Gemini Key"
                />
                <Sparkles className="form-input-icon" size={16} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Kling AI API Key</label>
              <div className="input-container">
                <input
                  type="password"
                  className="form-input"
                  value={klingKey}
                  onChange={(e) => setKlingKey(e.target.value)}
                  placeholder="Enter Kling Key"
                />
                <Film className="form-input-icon" size={16} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">API Base URL</label>
              <div className="input-container">
                <input
                  type="text"
                  className="form-input"
                  value={apiBaseUrl}
                  onChange={(e) => handleApiBaseChange(e.target.value)}
                  placeholder="e.g. https://viral-ai-ad-generator.onrender.com"
                />
                <Settings className="form-input-icon" size={16} />
              </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowSettings(false)}>
              Save Keys
            </button>
          </div>
        </div>
      )}

      {/* Global Spinner overlay during large actions */}
      {loading && (
        <div className="modal-backdrop" style={{ background: 'rgba(6, 5, 11, 0.9)', zIndex: 200 }}>
          <div style={{ textAlign: 'center', maxWidth: '400px' }}>
            <Loader2 className="spinning" size={48} style={{ color: '#8b5cf6', margin: '0 auto 24px' }} />
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Generating Assets</h3>
            <p style={{ color: 'var(--text-muted)' }}>{loadingMsg}</p>
          </div>
        </div>
      )}

      {/* Steps nodes */}
      <div className="steps-container">
        <div className={`step-node ${step === 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 1 ? '✓' : '1'}</div>
          <span className="step-label">Brand URL</span>
        </div>
        <div className="step-line" />
        <div className={`step-node ${step === 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 2 ? '✓' : '2'}</div>
          <span className="step-label">Ad Groups</span>
        </div>
        <div className="step-line" />
        <div className={`step-node ${step === 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 3 ? '✓' : '3'}</div>
          <span className="step-label">Meta Script</span>
        </div>
        <div className="step-line" />
        <div className={`step-node ${step === 4 ? 'active' : ''}`}>
          <div className="step-circle">4</div>
          <span className="step-label">Production</span>
        </div>
      </div>

      {/* Wizard Screens */}

      {/* Step 1: Input Form */}
      {step === 1 && (
        <div className="panel" style={{ maxWidth: '640px', margin: '0 auto' }}>
          <h1 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
            Create Viral Ads from any Link
          </h1>
          <p className="sub-title" style={{ marginBottom: '32px' }}>
            Analyze your website or app store link, construct professional ad groups, and generate cinematic Kling AI video ads.
          </p>

          <div className="form-group">
            <label className="form-label">Brand URL</label>
            <div className="input-container">
              <input
                type="text"
                className="form-input"
                placeholder="https://mywebsite.com, Play Store, or App Store link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Globe className="form-input-icon" size={18} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Product Type</label>
            <div className="segment-control">
              <button
                className={`segment-btn ${productType === 'digital' ? 'active' : ''}`}
                onClick={() => setProductType('digital')}
              >
                Digital (App/SaaS/Website)
              </button>
              <button
                className={`segment-btn ${productType === 'physical' ? 'active' : ''}`}
                onClick={() => setProductType('physical')}
              >
                Physical (Tangible Product)
              </button>
            </div>
          </div>

          {productType === 'physical' && (
            <div className="form-group">
              <label className="form-label">Upload Product Image (Accurate reference for Nano Banana Pro)</label>
              <div
                className="upload-zone"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => document.getElementById('product-file')?.click()}
              >
                <input
                  type="file"
                  id="product-file"
                  hidden
                  accept="image/*"
                  onChange={handleFileChange}
                />
                {productImage ? (
                  <div className="preview-container" onClick={(e) => e.stopPropagation()}>
                    <img src={productImage} alt="Product Preview" className="preview-image" />
                    <button
                      className="remove-preview-btn"
                      onClick={() => setProductImage(null)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="upload-icon" size={32} />
                    <span className="upload-text">Drag & drop product photo or click to browse</span>
                    <span className="upload-subtext">JPG, PNG up to 10MB</span>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px' }}
            onClick={handleAnalyzeBrand}
            disabled={!url}
          >
            Generate Campaign Ad Groups <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* Step 2: Ad Groups and Strategy Summary */}
      {step === 2 && brandProfile && (
        <div style={{ textAlign: 'left' }}>
          <div className="panel">
            <h1 className="title-gradient" style={{ fontSize: '2.2rem', marginBottom: '8px' }}>
              Brand Profile: {brandProfile.brandName}
            </h1>
            <p className="sub-title" style={{ marginBottom: '24px' }}>
              Gemini analyzed your URL and built these customized Meta marketing strategies.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: '24px 0' }}>
              <div>
                <h4 style={{ color: 'var(--accent-primary)', marginBottom: '8px' }}>Value Proposition</h4>
                <p style={{ color: 'var(--text-main)' }}>{brandProfile.coreValueProp}</p>
                
                <h4 style={{ color: 'var(--accent-primary)', marginTop: '20px', marginBottom: '8px' }}>Summary</h4>
                <p style={{ color: 'var(--text-muted)' }}>{brandProfile.summary}</p>
              </div>

              <div>
                <h4 style={{ color: 'var(--accent-secondary)', marginBottom: '8px' }}>Target Audience</h4>
                <p style={{ color: 'var(--text-main)' }}>{brandProfile.targetAudience}</p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '20px' }}>
                  <div>
                    <h4 style={{ color: 'var(--accent-secondary)', marginBottom: '4px' }}>Brand Tone</h4>
                    <p style={{ color: 'var(--text-muted)' }}>{brandProfile.tone}</p>
                  </div>
                  <div>
                    <h4 style={{ color: 'var(--accent-secondary)', marginBottom: '4px' }}>Visual Style</h4>
                    <p style={{ color: 'var(--text-muted)' }}>{brandProfile.visualStyle}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: '1.6rem', marginBottom: '16px' }}>Select an Ad Concept to Write Script</h2>
          <div className="grid-3">
            {brandProfile.adGroups.map((adGroup) => (
              <div
                key={adGroup.id}
                className={`card ${selectedAdGroup?.id === adGroup.id ? 'active' : ''}`}
                style={{
                  cursor: 'pointer',
                  border: selectedAdGroup?.id === adGroup.id ? '2px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.05)',
                  background: selectedAdGroup?.id === adGroup.id ? 'rgba(139, 92, 246, 0.05)' : 'rgba(255,255,255,0.02)'
                }}
                onClick={() => setSelectedAdGroup(adGroup)}
              >
                <div className="card-title">
                  <Sparkles size={18} style={{ color: '#8b5cf6' }} />
                  {adGroup.title}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-secondary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
                  Angle: {adGroup.strategy}
                </div>
                <div className="card-desc">
                  {adGroup.message}
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <strong>Target:</strong> {adGroup.audience}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={handleGenerateScript} disabled={!selectedAdGroup}>
              Write Scroll-Stopping Script <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Script & Visual Storyboard */}
      {step === 3 && script && (
        <div style={{ textAlign: 'left' }}>
          <div className="panel">
            <h1 className="title-gradient" style={{ fontSize: '2.2rem', marginBottom: '8px' }}>
              Meta Ad Campaign: {script.title}
            </h1>
            <p className="sub-title" style={{ marginBottom: '24px' }}>
              Your script has been optimized with a high-impact hook and broken down into 10s vertical frames.
            </p>

            {/* Demographic & Voice Profile Callout */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '24px',
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🎯 Target Demographics
                </span>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '6px' }}>
                  {script.targetDemographics || 'Not analyzed'}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🎙️ Recommended Voice Profile
                </span>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '6px' }}>
                  {script.voiceProfile || 'Not analyzed'}
                </p>
              </div>
            </div>

            <div className="storyboard-timeline">
              {script.scenes.map((scene) => (
                <div key={scene.sceneNumber} className="storyboard-scene">
                  <div className="scene-num-badge">
                    SCENE {scene.sceneNumber}
                  </div>
                  <div>
                    <h4 style={{ color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Video size={16} /> Visual Storyboard
                    </h4>
                    <p style={{ color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      {scene.visual}
                    </p>
                    <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)', textTransform: 'uppercase' }}>Reference Image Prompt:</span>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>"{scene.imagePrompt}"</p>
                    </div>
                  </div>
                  <div>
                    <h4 style={{ color: '#22d3ee', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <FileText size={16} /> Audio (VO / Audio Hook)
                    </h4>
                    <p style={{ color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      {scene.audio}
                    </p>
                    <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Kling Animation Prompt:</span>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>"{scene.animationPrompt}"</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={handleProceedToProduction}>
              Proceed to Production Studio <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Production Studio (Generating Frames & Videos) */}
      {step === 4 && script && (
        <div style={{ textAlign: 'left' }}>
          <div className="panel">
            <h1 className="title-gradient" style={{ fontSize: '2.2rem', marginBottom: '8px' }}>
              Ad Production Studio
            </h1>
            <p className="sub-title" style={{ marginBottom: '24px' }}>
              Generate frame reference images via Nano Banana Pro and animate them using Kling AI v3-Turbo (720p, 9:16, 10s).
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
              <button className="btn btn-glow-cyan" onClick={generateAllFrames}>
                <ImageIcon size={18} /> Generate All Reference Frames
              </button>
              <button
                className="btn btn-primary"
                onClick={animateAllFrames}
                disabled={frames.some(f => f.status !== 'completed')}
              >
                <Video size={18} /> Animate All with Kling AI
              </button>
            </div>

            <div className="production-grid">
              {script.scenes.map((scene) => {
                const frame = frames.find(f => f.sceneNumber === scene.sceneNumber);
                const video = videos.find(v => v.sceneNumber === scene.sceneNumber);

                return (
                  <div key={scene.sceneNumber} className="frame-production-card">
                    {/* Header */}
                    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h4 style={{ fontSize: '1rem', margin: 0 }}>Scene {scene.sceneNumber} Frame ({scene.duration}s)</h4>
                        {video?.status === 'succeed' && <span className="status-badge status-badge-completed" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>Completed</span>}
                        {video?.status === 'failed' && <span className="status-badge status-badge-failed" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>Failed</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="settings-btn"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => generateFrameImage(scene.sceneNumber)}
                          disabled={frame?.status === 'generating'}
                        >
                          <RefreshCw size={12} className={frame?.status === 'generating' ? 'spinning' : ''} /> Regen Image
                        </button>
                      </div>
                    </div>

                    {/* Aspect Box (9:16) */}
                    <div className="frame-aspect-ratio-box">
                      <div className="frame-content-inside">
                        {video?.url ? (
                          <video className="frame-video-vid" src={video.url} controls muted playsInline />
                        ) : frame?.image ? (
                          <img
                            className="frame-image-img"
                            src={`data:image/png;base64,${frame.image}`}
                            alt={`Scene ${scene.sceneNumber}`}
                          />
                        ) : (
                          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                            {frame?.status === 'generating' ? (
                              <>
                                <Loader2 className="spinning" size={32} style={{ color: '#8b5cf6', margin: '0 auto 12px' }} />
                                <span>Generating reference image...</span>
                              </>
                            ) : (
                              <>
                                <ImageIcon size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                <span style={{ fontSize: '0.85rem' }}>Image not generated yet</span>
                              </>
                            )}
                          </div>
                        )}

                        {/* Top progress overlay */}
                        {video?.status && video.status !== 'idle' && video.status !== 'succeed' && (
                          <div className="frame-overlay-status">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Kling Animation</span>
                              {video.status === 'submitted' && <span className="status-badge status-badge-pending">Submitted</span>}
                              {video.status === 'processing' && <span className="status-badge status-badge-running">Processing</span>}
                              {video.status === 'failed' && <span className="status-badge status-badge-failed">Failed</span>}
                            </div>
                            {video.status !== 'failed' && (
                              <div className="progress-bar-container">
                                <div className="progress-bar-fill progress-bar-animated" style={{ width: '100%' }}></div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.01)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ width: '100%', padding: '10px', fontSize: '0.85rem' }}
                        disabled={!frame?.image || video?.status === 'submitted' || video?.status === 'processing'}
                        onClick={() => animateFrame(scene.sceneNumber)}
                      >
                        <Video size={14} /> Animate Scene with Kling
                      </button>
                      {video?.url && (
                        <a
                          href={video.url}
                          download={`viral-ad-scene-${scene.sceneNumber}.mp4`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-primary"
                          style={{ width: '100%', padding: '10px', fontSize: '0.85rem', textDecoration: 'none' }}
                        >
                          <Download size={14} /> Download MP4
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sequential Player Center */}
          <div className="panel" style={{ marginTop: '32px' }}>
            <h2 style={{ fontSize: '1.6rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Film style={{ color: '#8b5cf6' }} /> Ad Sequence Player
            </h2>
            <p className="sub-title" style={{ marginBottom: '24px' }}>
              {allVideosCompleted
                ? 'All video clips generated! Preview your complete 30-second campaign sequence below.'
                : 'Videos are still generating. Once complete, you can preview the entire ad sequence smoothly here.'}
            </p>

            {activeSucceedVideos.length > 0 ? (
              <div className="sequence-player-container">
                {/* 9:16 Video Player */}
                <div className="video-player-aspect">
                  <video
                    ref={videoPlayerRef}
                    className="frame-video-vid"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    src={activeSucceedVideos[playingVideoIndex]?.url || ''}
                    controls
                    onEnded={handleVideoEnded}
                  />
                </div>

                {/* Sidebar Sequence List */}
                <div className="sequence-list">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Scene Sequence</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={autoPlayAll}
                        onChange={(e) => setAutoPlayAll(e.target.checked)}
                      />
                      Auto-play Sequence
                    </label>
                  </div>

                  {activeSucceedVideos.map((video, idx) => (
                    <div
                      key={video.sceneNumber}
                      className={`sequence-item ${playingVideoIndex === idx ? 'active' : ''}`}
                      onClick={() => setPlayingVideoIndex(idx)}
                    >
                      <div className="sequence-thumb">
                        <video className="sequence-thumb-video" src={video.url || ''} muted />
                      </div>
                      <div className="sequence-info">
                        <div className="sequence-title">Scene {video.sceneNumber} Video</div>
                        <div className="sequence-duration">
                          Duration: {script.scenes.find(s => s.sceneNumber === video.sceneNumber)?.duration || 3.3}s • 720p
                        </div>
                      </div>
                      {playingVideoIndex === idx && <Play size={16} style={{ color: 'var(--accent-primary)' }} />}
                    </div>
                  ))}

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <strong>Campaign Summary:</strong> Play the scenes back-to-back for a continuous 10-second Meta vertical ad preview.
                    </span>
                    {allVideosCompleted && (
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          const urls = videos.map(v => v.url).join(',');
                          const durations = script.scenes.map(s => s.duration).join(',');
                          const downloadUrl = `${API_BASE}/api/merge-videos?urls=${encodeURIComponent(urls)}&durations=${encodeURIComponent(durations)}`;
                          window.open(downloadUrl, '_blank');
                        }}
                      >
                        <Download size={16} /> Download Full 10s Ad (Merged with Sound)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px', padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Film size={40} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
                <p>Waiting for videos to finish generating. Click "Animate Scene" above to get started.</p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
            <button className="btn btn-secondary" onClick={() => setStep(3)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={() => setStep(1)}>
              Create New Ad Campaign <Sparkles size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
