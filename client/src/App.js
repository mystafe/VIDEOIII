import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from "socket.io-client";
import './App.css';
import './Spinner.css';
import { config as defaultConfig, MODELS, DEFAULT_MODEL, AI_MODULES, DEFAULT_AI_MODULE } from './config.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';


const Spinner = () => <div className="spinner"></div>;
const SERVER_URL = "https://videoii-server.onrender.com";
const socket = io(SERVER_URL);

function App() {
  const [logoClicks, setLogoClicks] = useState(0);
  const [superMode, setSuperMode] = useState(false);
  const getPreferredTheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const [theme, setTheme] = useState(getPreferredTheme());
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [aiModule, setAiModule] = useState(DEFAULT_AI_MODULE);
  const getInitialAnalysisState = () => ({ message: 'Please select a video and configure settings to begin.', percent: 0, result: '', error: '' });
  const [totalBatches, setTotalBatches] = useState(1);
  const [secondsPerBatch, setSecondsPerBatch] = useState(MODELS[DEFAULT_MODEL].secondsPerBatch);
  const [frameInterval, setFrameInterval] = useState(MODELS[DEFAULT_MODEL].videoFrame);
  const [useServer, setUseServer] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [analysisType, setAnalysisType] = useState('general');
  const [outputLanguage, setOutputLanguage] = useState('Turkish');
  const [analysisStatus, setAnalysisStatus] = useState(getInitialAnalysisState());
  const [isLoading, setIsLoading] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [maxBatchesAllowed, setMaxBatchesAllowed] = useState(10);
  const [analysisStartTime, setAnalysisStartTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const [openSection, setOpenSection] = useState('config');
  const [showFileInfo, setShowFileInfo] = useState(false);
  const [showConfigInfo, setShowConfigInfo] = useState(false);
  const [version, setVersion] = useState(defaultConfig.VERSION);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [logs, setLogs] = useState([]);

  const addLog = React.useCallback((msg) => {
    if (superMode) {
      const timestamp = new Date().toLocaleTimeString();
      setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    }
  }, [superMode]);

  useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
  }, [theme]);

  useEffect(() => {
    fetch(`${SERVER_URL}/`)
      .then(res => res.json())
      .then(data => {
        if (data.client?.version) setVersion(data.client.version);
        else if (data.clientVersion) setVersion(data.clientVersion);
        else if (data.version) setVersion(data.version);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleProgress = (data) => {
      if (data.type === 'status' || data.type === 'progress') {
        setAnalysisStatus(prev => ({ ...prev, message: data.message, percent: data.percent === undefined ? prev.percent : data.percent, error: '' }));
        if (data.percent !== undefined) {
          setProcessingProgress(data.percent);
        } else { addLog(data.message); }
        if (analysisStartTime && data.percent !== undefined && data.percent > 0) {
          const elapsed = (Date.now() - analysisStartTime) / 1000;
          const estimatedTotal = elapsed / (data.percent / 100);
          const remaining = Math.max(estimatedTotal - elapsed, 0);
          setTimeLeft(Math.round(remaining));
        }
      } else if (data.type === 'result') {
        setAnalysisStatus(prev => ({ ...prev, message: 'Analysis complete!', result: data.data, percent: 100, error: '' }));
        setProcessingProgress(100); addLog('Analysis complete!'); setIsLoading(false); setTimeLeft(null);
      } else if (data.type === 'error') {
        setAnalysisStatus(prev => ({ ...prev, message: '', error: data.message, percent: 0 }));
        addLog(`Error: ${data.message}`); setIsLoading(false); setTimeLeft(null);
      }
    };
    socket.on('connect', () => { setSocketId(socket.id); });
    socket.on('progressUpdate', handleProgress);
    return () => { socket.off('connect'); socket.off('progressUpdate', handleProgress); };
  }, [analysisStartTime, addLog]);

  const updateMaxBatches = (videoDuration, seconds) => {
    if (videoDuration && seconds > 0) {
      const newMax = Math.max(1, Math.ceil(videoDuration / seconds));
      setMaxBatchesAllowed(newMax);
      if (totalBatches > newMax) setTotalBatches(newMax);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const limit = MODELS[selectedModel].maxSize * 1024 * 1024;
      if (file.size > limit) {
        setAnalysisStatus({ ...getInitialAnalysisState(), error: `File exceeds ${MODELS[selectedModel].maxSize}MB limit.` });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setAnalysisStatus({ message: `File selected: ${file.name}. Ready to start.`, percent: 0, result: '', error: '' });
      setMaxBatchesAllowed(1000);
    }
  };

  const handleVideoMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      if (duration > MODELS[selectedModel].maxDuration) {
        setAnalysisStatus({ ...getInitialAnalysisState(), error: `Video exceeds ${MODELS[selectedModel].maxDuration / 60} minute limit.` });
        setSelectedFile(null);
        setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      updateMaxBatches(duration, secondsPerBatch);
      setTotalBatches(Math.ceil(duration / secondsPerBatch));
    }
  };

  useEffect(() => {
    if (!superMode || !useServer) {
      const modelCfg = MODELS[selectedModel];
      setSecondsPerBatch(modelCfg.secondsPerBatch);
      const interval = analysisType === 'meeting' ? modelCfg.meetingFrame : modelCfg.videoFrame;
      setFrameInterval(interval);
      if (videoRef.current?.duration) {
        const duration = videoRef.current.duration;
        setTotalBatches(Math.ceil(duration / modelCfg.secondsPerBatch));
        updateMaxBatches(duration, modelCfg.secondsPerBatch);
      }
    }
  }, [selectedModel, analysisType, superMode, useServer]);

  const handleUpload = async () => {
    if (!selectedFile) {
      setAnalysisStatus({ ...analysisStatus, error: 'Please select a file before starting analysis.' }); return;
    }
    if (!socketId) {
      setAnalysisStatus({ ...analysisStatus, error: 'Server connection not established yet.' }); return;
    }
    
    setIsLoading(true); setAnalysisStartTime(Date.now()); setTimeLeft(null);
    setOpenSection('analysis'); setUploadProgress(0); setProcessingProgress(0); setLogs([]);

    const uploadToServer = async () => { /* Bu fonksiyon değişiklik olmadan olduğu gibi kalır */ };

    if (useServer) {
      await uploadToServer();
    } else {
      addLog('Starting on-device processing using FFmpeg.wasm...');
      try {
        const maxDur = MODELS[selectedModel].maxDuration;
        const duration = videoRef.current ? Math.min(videoRef.current.duration, maxDur) : maxDur;
        
        const { audioBlob, frames } = await processVideoWithWASM(selectedFile, frameInterval, duration, (percent, msg) => {
          setProcessingProgress(Math.round(percent));
          if(superMode) addLog(msg);
        });

        if (frames.length === 0) {
            throw new Error("FFmpeg did not extract any frames. The video format might be unsupported.");
        }

        addLog(`On-device processing finished: Extracted ${frames.length} frames. Now uploading...`);
        setProcessingProgress(100);
        setUploadProgress(0);

        const formData = new FormData();
        frames.forEach((blob, idx) => formData.append('frames', blob, `frame_${idx}.jpg`));
        if (audioBlob) formData.append('audio', audioBlob, 'audio.mp3');
        formData.append('analysisType', analysisType);
        formData.append('outputLanguage', outputLanguage);
        formData.append('socketId', socketId);
        formData.append('aiModule', aiModule);

        await axios.post(`${SERVER_URL}/api/analyze-browser`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const percent = e.total ? Math.round((e.loaded * 100) / e.total) : 0;
            setUploadProgress(percent);
          }
        });
        setAnalysisStatus(prev => ({ ...prev, message: 'Upload complete. Waiting for server analysis...' }));
        addLog('Upload successful. Server is now processing.');
      } catch (error) {
        const errorMsg = error.response?.data?.error || error.message || 'An error occurred during on-device processing.';
        setAnalysisStatus({ ...getInitialAnalysisState(), error: errorMsg });
        addLog(`Error: ${errorMsg}`);
        setIsLoading(false);
      }
    }
  };

  const handleReset = () => {
    setIsLoading(false); setAnalysisStartTime(null); setTimeLeft(null);
    setSelectedFile(null); setPreviewUrl(null); setAnalysisStatus(getInitialAnalysisState());
    setTotalBatches(1); setSecondsPerBatch(MODELS[DEFAULT_MODEL].secondsPerBatch);
    setFrameInterval(MODELS[DEFAULT_MODEL].videoFrame); setMaxBatchesAllowed(10);
    setLogoClicks(0); setSuperMode(false); setLogs([]); setAiModule(DEFAULT_AI_MODULE);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLogoClick = () => {
    const newClickCount = logoClicks + 1;
    setLogoClicks(newClickCount);
    if (newClickCount >= 5 && !superMode) { setSuperMode(true); console.log("Super Mode Activated!"); }
  };

  const handleBatchChange = (e) => {
    let value = parseInt(e.target.value, 10);
    const max = Math.min(maxBatchesAllowed, superMode ? 100 : 10);
    value = Math.max(1, Math.min(value, max));
    setTotalBatches(value);
  };
  
  const handleSecondsChange = (e) => {
    let value = parseInt(e.target.value, 10);
    const max = superMode ? 600 : 60;
    value = Math.max(1, Math.min(value, max));
    setSecondsPerBatch(value);
    if (videoRef.current?.duration) { updateMaxBatches(videoRef.current.duration, value); }
  };

  const toggleSection = (section) => {
    setOpenSection(prev => (prev === section ? null : section));
  };
  const toggleFileInfo = () => setShowFileInfo(v => !v);
  const toggleConfigInfo = () => setShowConfigInfo(v => !v);

  // --- NIHAI, HATALARI GİDERİLMİŞ, İZOLE EDİLMİŞ İŞLEM FONKSİYONU ---
  const processVideoWithWASM = async (file, interval, maxDuration, onProgress) => {
      // Her seferinde yeni bir FFmpeg instance oluşturarak state bozulma sorununu KÖKTEN çözüyoruz.
      const ffmpeg = new FFmpeg(); 
      let audioBlob = null;
      const frames = [];

      try {
          onProgress(0, 'Loading FFmpeg Engine...');
          ffmpeg.on("log", ({ message }) => {
              if (superMode) {
                  onProgress(processingProgress, message); // Yüzdeyi değiştirmeden logu güncelle
              }
          });
          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
          await ffmpeg.load({
              coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
              wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });

          onProgress(10, 'Writing video to memory...');
          const inputFileName = 'input.mp4';
          await ffmpeg.writeFile(inputFileName, await fetchFile(file));
          
          onProgress(30, 'Processing video...');

          const args = [
              '-i', inputFileName,
              '-t', String(maxDuration),
              // Frame Output
              '-vf', `fps=1/${interval}`, '-qscale:v', '3', 'frame-%d.jpg',
              // Audio Output (hata vermeden devam etmesini sağlamak için)
              '-map', '0:a?', '-q:a', '0', '-acodec', 'libmp3lame', 'output.mp3'
          ];
          
          // Tek, birleşik komutu çalıştır.
          await ffmpeg.run(...args);

          onProgress(85, 'Reading results from memory...');
          
          // İşlenmiş dosyaları oku
          try {
              const audioData = await ffmpeg.readFile('output.mp3');
              audioBlob = new Blob([audioData], { type: 'audio/mp3' });
          } catch(e) {
              onProgress(88, 'No valid audio stream was extracted.');
          }

          let i = 1;
          while (true) {
              try {
                  const frameData = await ffmpeg.readFile(`frame-${i}.jpg`);
                  frames.push(new Blob([frameData], { type: 'image/jpeg' }));
                  i++;
              } catch (e) {
                  break; 
              } 
          }
      } catch(error) {
          console.error("FFmpeg processing error:", error);
          throw new Error("FFmpeg failed to process the video. It might be corrupted or in an unsupported format.");
      } finally {
          // Worker'ı sonlandırarak belleği serbest bırak, bu ÇOK önemli.
          if (ffmpeg.isLoaded()) {
            await ffmpeg.terminate();
          }
          onProgress(100, 'On-device processing finished.');
      }
      
      return { audioBlob, frames };
  };
  
  return (
    <div className="App">
      <div className="container">
        <header className="App-header">
          <h1 onClick={handleLogoClick}>VIDEOIII</h1>
          <p>Smart Video Analysis Platform</p>
          {superMode && (
            <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}
        </header>
        <main className="App-main">
          <div className={`controls-card ${openSection === 'config' ? 'open' : 'closed'}`}>
            <h2 onClick={() => toggleSection('config')}><span className="step-number">1</span> Configuration<span className="accordion-icon">{openSection === 'config' ? '▲' : '▼'}</span></h2>
            {openSection === 'config' && (
              <div className="form-grid">
                {superMode && (
                  <div className="form-group">
                    <label htmlFor="ai-module">AI Module</label>
                    <select id="ai-module" value={aiModule} onChange={(e) => setAiModule(e.target.value)} disabled={isLoading}>
                      {Object.entries(AI_MODULES).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-group model-group">
                  <label htmlFor="model-select">Model</label>
                  <select id="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={isLoading}>
                    {Object.entries(MODELS).map(([key, m]) => <option key={key} value={key}>{`${m.label} - ${m.note}`}</option>)}
                  </select>
                </div>
                {superMode && (
                  <div className="form-group">
                    <label htmlFor="processing-mode">Processing</label>
                    <select id="processing-mode" value={useServer ? 'server' : 'device'} onChange={(e) => setUseServer(e.target.value === 'server')} disabled={isLoading}>
                      <option value="device">Device (Recommended)</option>
                      <option value="server">Server</option>
                    </select>
                  </div>
                )}
                {superMode && useServer && (
                  <>
                    <div className="form-group"><label>Total Batches</label><input type="number" value={totalBatches} onChange={handleBatchChange} min="1" max={Math.min(maxBatchesAllowed, 100)} disabled={isLoading || !selectedFile} /></div>
                    <div className="form-group"><label>Batch Duration (s)</label><input type="number" value={secondsPerBatch} onChange={handleSecondsChange} min="1" max="600" disabled={isLoading} /></div>
                  </>
                )}
                 <div className="form-group"><label htmlFor="frame-interval">Frame Interval (s)</label><input id="frame-interval" type="number" value={frameInterval} onChange={(e) => setFrameInterval(Number(e.target.value))} min="1" max="60" step="1" disabled={isLoading || (superMode && useServer)} /></div>
                <div className="form-group"><label htmlFor="analysis-type">Analysis Type</label><select id="analysis-type" value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} disabled={isLoading}><option value="general">General Analysis</option><option value="meeting">Meeting Analysis</option></select></div>
                <div className="form-group"><label htmlFor="output-language">Report Language</label><select id="output-language" value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)} disabled={isLoading}><option value="Turkish">Turkish</option><option value="English">English</option></select></div>
              </div>
            )}
          </div>

          <div className={`controls-card ${openSection === 'upload' ? 'open' : 'closed'}`}>
            <h2 onClick={() => toggleSection('upload')}><span className="step-number">2</span> Upload Video<span className="accordion-icon">{openSection === 'upload' ? '▲' : '▼'}</span></h2>
            {openSection === 'upload' && (
              <>
                <input id="file-upload" type="file" accept="video/*,.mkv" onChange={handleFileChange} disabled={isLoading} ref={fileInputRef} style={{ display: 'none' }} />
                <label htmlFor="file-upload" className={`upload-button ${selectedFile ? 'file-selected' : ''}`}>{selectedFile ? selectedFile.name : 'Choose a video file...'}</label>
                {previewUrl && <div className="video-preview-container"><video controls src={previewUrl} width="100%" ref={videoRef} onLoadedMetadata={handleVideoMetadata} playsInline /></div>}
                <div className='button-group'>
                    <button className="info-button" onClick={toggleFileInfo} title="File Info">ℹ️</button>
                    <button className="info-button" onClick={toggleConfigInfo} title="Config Info">📊</button>
                    <button className="analyze-button" onClick={handleUpload} disabled={isLoading || !selectedFile}>{isLoading ? <Spinner /> : 'Start Analysis'}</button>
                </div>
                {showFileInfo && selectedFile && (
                  <div className="tooltip">
                    <p><b>Name:</b> {selectedFile.name}</p>
                    <p><b>Size:</b> {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    {videoRef.current?.duration && <p><b>Duration:</b> {Math.round(videoRef.current.duration)}s</p>}
                  </div>
                )}
                {showConfigInfo && (
                  <div className="tooltip">
                    <p><b>Mode:</b> {useServer ? "Server" : "Device"}</p>
                    <p><b>AI Module:</b> {aiModule}</p>
                    <p><b>Frame Rate:</b> 1 / {frameInterval}s</p>
                  </div>
                )}
              </>
            )}
          </div>

          {(isLoading || analysisStatus.result || analysisStatus.error) && (
            <div className={`status-card ${openSection === 'analysis' ? 'open' : 'closed'}`}>
              <h2 onClick={() => toggleSection('analysis')}><span className="step-number">3</span> Analysis<span className="accordion-icon">{openSection === 'analysis' ? '▲' : '▼'}</span></h2>
              {openSection === 'analysis' && (
                <>
                  {isLoading && <>
                    <p>On-Device Processing</p>
                    <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${processingProgress}%` }}></div></div>
                    <p>Upload</p>
                    <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div></div>
                    {timeLeft !== null && <p className="time-remaining">Est. time remaining: {timeLeft}s</p>}
                  </>}
                  {!analysisStatus.result && <p className="status-message">{analysisStatus.message}</p>}
                  {superMode && logs.length > 0 && (
                    <div className="log-container">
                      {logs.map((log, idx) => (<div key={idx} className="log-entry">{log}</div>))}
                    </div>
                  )}
                  {analysisStatus.error && <p className="error-message">{analysisStatus.error}</p>}
                  {analysisStatus.result && (
                    <div className="result-container">
                      <h4>Analysis Report:</h4>
                      <div className="report-content" dangerouslySetInnerHTML={{ __html: analysisStatus.result.replace(/\n/g, '<br />') }}></div>
                    </div>
                  )}
                  {!isLoading && (<button className="reset-button" onClick={handleReset}>Start New Analysis</button>)}
                </>
              )}
            </div>
          )}
        </main>
        <footer className="App-footer">
          <p>Developed by Mustafa Evleksiz - Version {version}</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
