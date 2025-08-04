import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from "socket.io-client";
import './App.css';
import './Spinner.css';
import { config as defaultConfig, MODELS, DEFAULT_MODEL, AI_MODULES, DEFAULT_AI_MODULE } from './config.js';

const Spinner = () => <div className="spinner"></div>;
// const socket = io("http://localhost:5001");
const socket = io("https://videoii-server.onrender.com");

function App() {
  const [logoClicks, setLogoClicks] = useState(0);
  const [superMode, setSuperMode] = useState(false);
  const getPreferredTheme = () =>
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
    if (superMode) setLogs(prev => [...prev, msg]);
  }, [superMode]);

  useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
  }, [theme]);

  useEffect(() => {
    fetch(`${defaultConfig.SOCKET}/`)
      .then(res => res.json())
      .then(data => {
        if (data.client && data.client.version) {
          setVersion(data.client.version);
        } else if (data.clientVersion) {
          setVersion(data.clientVersion);
        } else if (data.version) {
          setVersion(data.version);
        }
      })
      .catch(() => { /* ignore errors and keep default version */ });
  }, []);

  useEffect(() => {
    const handleProgress = (data) => {
      if (data.type === 'status' || data.type === 'progress') {
        setAnalysisStatus(prev => ({
          ...prev,
          message: data.message,
          percent: data.percent === undefined ? prev.percent : data.percent,
          error: ''
        }));
        if (data.percent !== undefined) {
          setProcessingProgress(data.percent);
          addLog(`${data.message} (${data.percent}%)`);
        } else {
          addLog(data.message);
        }
        if (analysisStartTime && data.percent !== undefined && data.percent > 0) {
          const elapsed = (Date.now() - analysisStartTime) / 1000;
          const estimatedTotal = elapsed / (data.percent / 100);
          const remaining = Math.max(estimatedTotal - elapsed, 0);
          setTimeLeft(Math.round(remaining));
        }
      }
      if (data.type === 'result') {
        setAnalysisStatus(prev => ({ ...prev, message: 'Analysis complete!', result: data.data, percent: 100, error: '' }));
        setProcessingProgress(100);
        addLog('Analysis complete!');
        setIsLoading(false);
        setTimeLeft(null);
      }
      if (data.type === 'error') {
        setAnalysisStatus(prev => ({ ...prev, message: '', error: data.message, percent: 0 }));
        addLog(`Error: ${data.message}`);
        setIsLoading(false);
        setTimeLeft(null);
      }
    };
    socket.on('connect', () => { setSocketId(socket.id); });
    socket.on('progressUpdate', handleProgress);
    return () => { socket.off('connect'); socket.off('progressUpdate', handleProgress); };
  }, [analysisStartTime, addLog]);

  const updateMaxBatches = (videoDuration, seconds) => {
    if (videoDuration && seconds > 0) {
      const calculatedMax = Math.ceil(videoDuration / seconds);
      const newMax = calculatedMax > 0 ? calculatedMax : 1;
      setMaxBatchesAllowed(newMax);
      if (totalBatches > newMax) { setTotalBatches(newMax); }
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
      if (videoRef.current && videoRef.current.duration) {
        setTotalBatches(Math.ceil(videoRef.current.duration / modelCfg.secondsPerBatch));
        updateMaxBatches(videoRef.current.duration, modelCfg.secondsPerBatch);
      }
    }
  }, [selectedModel, analysisType, superMode, useServer]);

  const handleUpload = async () => {
    if (!selectedFile) {
      const msg = 'Please select a file before starting analysis.';
      setAnalysisStatus({ ...analysisStatus, error: msg });
      addLog(msg);
      return;
    }
    if (!socketId) {
      const msg = 'Server connection not established yet.';
      setAnalysisStatus({ ...analysisStatus, error: msg });
      addLog(msg);
      return;
    }
    setIsLoading(true);
    setAnalysisStartTime(Date.now());
    setTimeLeft(null);
    setOpenSection('analysis');
    setUploadProgress(0);
    setProcessingProgress(0);
    setLogs([]);

    const uploadToServer = async () => {
      setAnalysisStatus({ message: 'Uploading video...', percent: 0, result: '', error: '' });
      addLog('Uploading video to server...');
      const durationNeeded = totalBatches * secondsPerBatch;
      let uploadFile = selectedFile;
      if (videoRef.current && durationNeeded < videoRef.current.duration) {
        try {
          // Note: trimVideo may also fail on iPhone as it uses captureStream.
          // The catch block ensures we send the full file in that case.
          uploadFile = await trimVideo(selectedFile, durationNeeded);
        } catch (e) {
          console.error('Trim failed, sending full file', e);
        }
      }
      const formData = new FormData();
      formData.append('video', uploadFile);
      formData.append('analysisType', analysisType);
      formData.append('outputLanguage', outputLanguage);
      formData.append('socketId', socketId);
      formData.append('aiModule', aiModule);
      formData.append('totalBatches', totalBatches);
      formData.append('secondsPerBatch', secondsPerBatch);
      formData.append('frameInterval', frameInterval);
      try {
        const response = await axios.post('https://videoii-server.onrender.com/api/analyze', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 100) / e.total);
            setUploadProgress(percent);
            addLog(`Upload ${percent}%`);
          }
        });
        setAnalysisStatus(prev => ({ ...prev, message: response.data.message }));
        addLog('Upload complete, processing started...');
        setProcessingProgress(0);
      } catch (error) {
        setAnalysisStatus({ ...analysisStatus, error: error.response?.data?.error || error.message || 'An upload error occurred.' });
        addLog(`Error: ${error.message || 'An upload error occurred.'}`);
        setIsLoading(false);
      }
    };

    if (useServer) {
      await uploadToServer();
    } else {
      setAnalysisStatus({ message: 'Processing on device...', percent: 0, result: '', error: '' });
      addLog('Processing on device...');
      try {
        const maxDur = MODELS[selectedModel].maxDuration;
        const duration = videoRef.current ? Math.min(videoRef.current.duration, maxDur) : maxDur;
        const { audioBlob, frames } = await processVideoOnDevice(selectedFile, frameInterval, duration, (percent, msg) => {
          setProcessingProgress(Math.round(percent));
          addLog(`${msg} (${Math.round(percent)}%)`);
        });
        addLog('Device processing finished. Uploading to server...');
        setProcessingProgress(0);
        const formData = new FormData();
        frames.forEach((blob, idx) => formData.append('frames', blob, `frame_${idx}.jpg`));
        if (audioBlob) formData.append('audio', audioBlob, 'audio.webm');
        formData.append('analysisType', analysisType);
        formData.append('outputLanguage', outputLanguage);
        formData.append('socketId', socketId);
        formData.append('aiModule', aiModule);
        const response = await axios.post('https://videoii-server.onrender.com/api/analyze-browser', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 100) / e.total);
            setUploadProgress(percent);
            addLog(`Upload ${percent}%`);
          }
        });
        setAnalysisStatus(prev => ({ ...prev, message: response.data.message }));
        addLog('Upload complete, waiting for server analysis...');
      } catch (error) {
        if (error.message && error.message.includes('Stream capture is not supported')) {
          addLog('Tarayıcıda işleme desteklenmiyor, sunucuda işlenecektir.');
          setUseServer(true);
          await uploadToServer();
        } else {
          setAnalysisStatus({ ...analysisStatus, error: error.response?.data?.error || error.message || 'An upload error occurred.' });
          addLog(`Error: ${error.message || 'An upload error occurred.'}`);
          setIsLoading(false);
        }
      }
    }
  };

  const handleReset = () => {
    setIsLoading(false);
    setAnalysisStartTime(null);
    setTimeLeft(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisStatus(getInitialAnalysisState());
    setTotalBatches(1);
    setSecondsPerBatch(MODELS[DEFAULT_MODEL].secondsPerBatch);
    setFrameInterval(MODELS[DEFAULT_MODEL].videoFrame);
    setMaxBatchesAllowed(10);
    setLogoClicks(0);
    setSuperMode(false);
    setLogs([]);
    setAiModule(DEFAULT_AI_MODULE);
    if (fileInputRef.current) { fileInputRef.current.value = ''; }
  };

  const handleLogoClick = () => {
    const newClickCount = logoClicks + 1;
    setLogoClicks(newClickCount);
    if (newClickCount >= 5 && !superMode) { setSuperMode(true); console.log("Super Mode Activated!"); }
  };

  const handleBatchChange = (e) => {
    let value = parseInt(e.target.value, 10);
    const max = Math.min(maxBatchesAllowed, superMode ? 100 : 10);
    if (value > max) value = max;
    if (value < 1) value = 1;
    setTotalBatches(value);
  }
  
  const handleSecondsChange = (e) => {
    let value = parseInt(e.target.value, 10);
    const max = superMode ? 600 : 60;
    if (value > max) value = max;
    if (value < 1) value = 1;
    setSecondsPerBatch(value);
    if (videoRef.current && videoRef.current.duration) { updateMaxBatches(videoRef.current.duration, value); }
  };

  const toggleSection = (section) => {
    setOpenSection(prev => (prev === section ? null : section));
  };
  
  const toggleFileInfo = () => setShowFileInfo(v => !v);
  
  const toggleConfigInfo = () => setShowConfigInfo(v => !v);


  // --- DEĞİŞTİRİLEN VE İYİLEŞTİRİLEN FONKSİYON ---
  // Bu fonksiyon artık 'captureStream' desteği olmayan tarayıcılarda (örn. iPhone Safari) hata vermek yerine
  // sadece görsel işleme yapacak şekilde güncellendi.
  const processVideoOnDevice = (file, interval, maxDuration, onProgress) => {
    return new Promise((resolve, reject) => {
      try {
        if (!file || !file.type.startsWith('video')) {
          return reject(new Error('Selected file is not a valid video.'));
        }

        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const frames = [];

        // Önce API'lerin varlığını ve desteğini kontrol et
        const captureStreamMethod = video.captureStream || video.mozCaptureStream;
        const audioCaptureSupported = !!captureStreamMethod && !!window.MediaRecorder;

        let audioChunks = [];
        let recorder = null;

        if (!audioCaptureSupported) {
          console.warn("Audio capture is not supported by this browser. Proceeding with frame extraction only.");
          onProgress && onProgress(0, 'Warning: Audio capture not supported. Visual analysis only.');
        }

        video.onloadedmetadata = () => {
          onProgress && onProgress(0, 'Video metadata loaded');
          const duration = Math.min(video.duration, maxDuration);
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          // SADECE DESTEKLENİYORSA ses kaydediciyi ayarla
          if (audioCaptureSupported) {
            const stream = captureStreamMethod.call(video);
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
              const audioStream = new MediaStream(audioTracks);
              recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
              recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
              recorder.onerror = (e) => console.error('MediaRecorder error:', e);
            } else {
              onProgress && onProgress(0, 'No audio tracks found in video.');
            }
          }
          
          let lastPercent = 0;
          const captureFrame = () => {
            try {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((blob) => { if (blob) frames.push(blob); }, 'image/jpeg', 0.7);
              const percent = (video.currentTime / duration) * 100;
              if (onProgress && percent - lastPercent >= 1) {
                lastPercent = percent;
                onProgress(percent, 'Capturing frames...');
              }
            } catch (e) {
              console.error('Frame capture error', e);
            }
          };

          const intervalId = setInterval(captureFrame, interval * 1000);

          video.onpause = () => {
            clearInterval(intervalId);
            const audioBlob = audioChunks.length > 0 ? new Blob(audioChunks, { type: 'audio/webm' }) : null;
            onProgress && onProgress(100, 'Device processing complete.');
            resolve({ audioBlob, frames });
          };
          
          video.ontimeupdate = () => {
            if (video.currentTime >= duration) {
              if (!video.paused) {
                 video.pause();
                 if (recorder && recorder.state === "recording") {
                    recorder.stop();
                 }
              }
            }
          };

          video.play().catch(reject);
          if (recorder) {
            recorder.start();
          }

          setTimeout(() => {
              if (!video.paused) video.pause();
          }, duration * 1000 + 200);

        };

        video.onerror = (e) => reject(new Error('Video element could not be loaded.'));

      } catch (err) {
        reject(err);
      }
    });
  };

  const trimVideo = (file, duration) => {
    return new Promise((resolve, reject) => {
      try {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        let chunks = [];
        video.onloadedmetadata = () => {
          const stream = video.captureStream();
          const recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: file.type });
            resolve(new File([blob], file.name, { type: file.type }));
          };
          recorder.start();
          video.play();
          setTimeout(() => { recorder.stop(); video.pause(); }, duration * 1000);
        };
        video.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  };
  
  return (
    <div className="App">
      <div className="container">
        <header className="App-header">
          <h1 onClick={handleLogoClick}>VIDEOIII</h1>
          <p>Smart Video Analysis Platform</p>
          {superMode && (
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}
        </header>
        <main className="App-main">
          <div className={`controls-card ${openSection === 'config' ? 'open' : 'closed'}`}>
            <h2 onClick={() => toggleSection('config')}><span className="step-number">1</span> Configuration<span className="accordion-icon">{openSection === 'config' ? '▲' : '▼'}</span></h2>
            {openSection === 'config' && (
              <>
                <div className="form-grid">
                  {superMode && (
                    <div className="form-group">
                      <label htmlFor="ai-module">AI Module</label>
                      <select id="ai-module" value={aiModule} onChange={(e) => setAiModule(e.target.value)} disabled={isLoading}>
                        {Object.entries(AI_MODULES).map(([key, m]) => (
                          <option key={key} value={key}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="form-group model-group">
                    <label htmlFor="model-select">Model</label>
                    <select id="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={isLoading}>
                      {Object.entries(MODELS).map(([key, m]) => (
                        <option key={key} value={key}>{`${m.label} - ${m.note}`}</option>
                      ))}
                    </select>
                  </div>
                  {superMode && (
                    <div className="form-group">
                      <label htmlFor="processing-mode">Processing</label>
                      <select id="processing-mode" value={useServer ? 'server' : 'device'} onChange={(e) => setUseServer(e.target.value === 'server')} disabled={isLoading}>
                        <option value="device">Device</option>
                        <option value="server">Server</option>
                      </select>
                    </div>
                  )}
                  {superMode && useServer && (
                    <>
                      <div className="form-group"><label htmlFor="total-batches">Total Batches (Max: {Math.min(maxBatchesAllowed, superMode ? 100 : 10)})</label><input id="total-batches" type="number" value={totalBatches} onChange={handleBatchChange} min="1" max={Math.min(maxBatchesAllowed, superMode ? 100 : 10)} disabled={isLoading || !selectedFile} /></div>
                      <div className="form-group"><label htmlFor="seconds-per-batch">Batch Duration (seconds)</label><input id="seconds-per-batch" type="number" value={secondsPerBatch} onChange={handleSecondsChange} min="10" max="600" step="10" disabled={isLoading} /></div>
                      <div className="form-group"><label htmlFor="frame-interval">Frame Interval (sec)</label><input id="frame-interval" type="number" value={frameInterval} onChange={(e) => setFrameInterval(Number(e.target.value))} min="0.1" step="0.1" disabled={isLoading} /></div>
                    </>
                  )}
                  <div className="form-group"><label htmlFor="analysis-type">Analysis Type</label><select id="analysis-type" value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} disabled={isLoading}><option value="general">General Analysis</option><option value="meeting">Meeting Analysis</option></select></div>
                  <div className="form-group"><label htmlFor="output-language">Report Language</label><select id="output-language" value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)} disabled={isLoading}><option value="Turkish">Turkish</option><option value="English">English</option></select></div>
                </div>
              </>
            )}
          </div>

          <div className={`controls-card ${openSection === 'upload' ? 'open' : 'closed'}`}>
            <h2 onClick={() => toggleSection('upload')}><span className="step-number">2</span> Upload Video<span className="accordion-icon">{openSection === 'upload' ? '▲' : '▼'}</span></h2>
            {openSection === 'upload' && (
              <>
                <input id="file-upload" type="file" accept="video/*" onChange={handleFileChange} disabled={isLoading} ref={fileInputRef} style={{ display: 'none' }} />
                <label htmlFor="file-upload" className={`upload-button ${selectedFile ? 'file-selected' : ''}`}>{selectedFile ? selectedFile.name : 'Choose a video file...'}</label>
                {previewUrl && (
                  <div className="video-preview-container">
                    <video controls src={previewUrl} width="100%" ref={videoRef} onLoadedMetadata={handleVideoMetadata} />
                  </div>
                )}
                <div className='button-group'>
                    <button className="info-button" onClick={toggleFileInfo} title="File Info">ℹ️</button>
                    <button className="info-button" onClick={toggleConfigInfo} title="Config Info">📊</button>
                    <button className="analyze-button" onClick={handleUpload} disabled={isLoading || !selectedFile}>{isLoading ? <Spinner /> : null}{isLoading ? 'Analyzing...' : 'Start Analysis'}</button>
                </div>
                {showFileInfo && selectedFile && (
                  <div className="tooltip">
                    <p>Name: {selectedFile.name}</p>
                    <p>Size: {(selectedFile.size / (1024*1024)).toFixed(2)} MB</p>
                    {videoRef.current && <p>Duration: {Math.round(videoRef.current.duration)} s</p>}
                  </div>
                )}
                {showConfigInfo && (
                  <div className="tooltip">
                    <p>Module: {aiModule}</p>
                    <p>Model: {selectedModel}</p>
                    {superMode && useServer && <p>Batches: {totalBatches}</p>}
                    {superMode && useServer && <p>Batch Len: {secondsPerBatch}s</p>}
                    <p>Frame Rate: 1 every {frameInterval}s</p>
                    <p>Type: {analysisType}</p>
                    <p>Language: {outputLanguage}</p>
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
                  <p>Upload</p>
                  <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div></div>
                  <p>Processing</p>
                  <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${processingProgress}%` }}></div></div>
                  {isLoading && timeLeft !== null && (
                    <p className="time-remaining">Estimated time left: {timeLeft}s</p>
                  )}
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
                      <div className="report-content" dangerouslySetInnerHTML={{ __html: analysisStatus.result }}></div>
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
