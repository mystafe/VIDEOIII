import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from "socket.io-client";
import './App.css';
import './Spinner.css';
import { config as defaultConfig, MODELS, DEFAULT_MODEL } from './config.js';

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
  const getInitialAnalysisState = () => ({ message: 'Please select a video and configure settings to begin.', percent: 0, result: '', error: '' });
  const [totalBatches, setTotalBatches] = useState(1);
  const [secondsPerBatch, setSecondsPerBatch] = useState(MODELS[DEFAULT_MODEL].secondsPerBatch);
  const [frameInterval, setFrameInterval] = useState(MODELS[DEFAULT_MODEL].videoFrame);
  // const [socket2, setSocket2] = useState(defaultConfig.SOCKET);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [analysisType, setAnalysisType] = useState('general');
  const [outputLanguage, setOutputLanguage] = useState('Turkish');
  const [analysisStatus, setAnalysisStatus] = useState(getInitialAnalysisState());
  const [isLoading, setIsLoading] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [maxBatchesAllowed, setMaxBatchesAllowed] = useState(10);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const [openSection, setOpenSection] = useState('config');
  const [showFileInfo, setShowFileInfo] = useState(false);
  const [showConfigInfo, setShowConfigInfo] = useState(false);

  useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
  }, [theme]);

  useEffect(() => {
    socket.on('connect', () => { setSocketId(socket.id); });
    socket.on('progressUpdate', (data) => {
      if (data.type === 'status' || data.type === 'progress') { setAnalysisStatus(prev => ({ ...prev, message: data.message, percent: data.percent === undefined ? prev.percent : data.percent, error: '' })); }
      if (data.type === 'result') { setAnalysisStatus(prev => ({ ...prev, message: 'Analysis complete!', result: data.data, percent: 100, error: '' })); setIsLoading(false); }
      if (data.type === 'error') { setAnalysisStatus(prev => ({ ...prev, message: '', error: data.message, percent: 0 })); setIsLoading(false); }
    });
    return () => { socket.off('connect'); socket.off('progressUpdate'); };
  }, []);

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
    if (!superMode) {
      const modelCfg = MODELS[selectedModel];
      setSecondsPerBatch(modelCfg.secondsPerBatch);
      const interval = analysisType === 'meeting' ? modelCfg.meetingFrame : modelCfg.videoFrame;
      setFrameInterval(interval);
      if (videoRef.current && videoRef.current.duration) {
        setTotalBatches(Math.ceil(videoRef.current.duration / modelCfg.secondsPerBatch));
        updateMaxBatches(videoRef.current.duration, modelCfg.secondsPerBatch);
      }
    }
  }, [selectedModel, analysisType, superMode]);
  const handleUpload = async () => {
    if (!selectedFile || !socketId) { setAnalysisStatus({ ...analysisStatus, error: 'Please select a file and wait for server connection.' }); return; }
    setIsLoading(true);
    setOpenSection('analysis');
    setAnalysisStatus({ message: 'Uploading video...', percent: 0, result: '', error: '' });
    const durationNeeded = totalBatches * secondsPerBatch;
    let uploadFile = selectedFile;
    if (videoRef.current && durationNeeded < videoRef.current.duration) {
      try {
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
    formData.append('totalBatches', totalBatches);
    formData.append('secondsPerBatch', secondsPerBatch);
    formData.append('frameInterval', frameInterval);
    try {
      // const response = await axios.post('http://localhost:5001/api/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const response = await axios.post('https://videoii-server.onrender.com/api/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAnalysisStatus(prev => ({ ...prev, message: response.data.message }));
    } catch (error) {
      setAnalysisStatus({ ...analysisStatus, error: error.response?.data?.error || 'An upload error occurred.' });
      setIsLoading(false);
    }
  };
  const handleReset = () => {
    setIsLoading(false);
    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisStatus(getInitialAnalysisState());
    setTotalBatches(1);
    setSecondsPerBatch(MODELS[DEFAULT_MODEL].secondsPerBatch);
    setFrameInterval(MODELS[DEFAULT_MODEL].videoFrame);
    // setSocket(defaultConfig.SOCKET);
    setMaxBatchesAllowed(10);
    setLogoClicks(0);
    setSuperMode(false);
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
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            disabled={!superMode}
            title={!superMode ? 'Activate super mode to toggle theme' : ''}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </header>
        <main className="App-main">
          <div className={`controls-card ${openSection === 'config' ? 'open' : 'closed'}`}>
            <h2 onClick={() => toggleSection('config')}><span className="step-number">1</span> Configuration<span className="accordion-icon">{openSection === 'config' ? '▲' : '▼'}</span></h2>
            {openSection === 'config' && (
              <>
                <div className="form-grid">
                  <div className="form-group model-group">
                    <label htmlFor="model-select">Model</label>
                    <select id="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={isLoading}>
                      {Object.entries(MODELS).map(([key, m]) => (
                        <option key={key} value={key}>{`${m.label} - ${m.note}`}</option>
                      ))}
                    </select>
                  </div>
                  {superMode && (
                    <>
                      <div className="form-group"><label htmlFor="total-batches">Total Batches (Max: {Math.min(maxBatchesAllowed, superMode ? 100 : 10)})</label><input id="total-batches" type="number" value={totalBatches} onChange={handleBatchChange} min="1" max={Math.min(maxBatchesAllowed, superMode ? 100 : 10)} disabled={isLoading || !selectedFile} /></div>
                      <div className="form-group"><label htmlFor="seconds-per-batch">Batch Duration (seconds)</label><input id="seconds-per-batch" type="number" value={secondsPerBatch} onChange={handleSecondsChange} min="10" max="600" step="10" disabled={isLoading} /></div>
                      <div className="form-group"><label htmlFor="frame-interval">Frame Interval (sec)</label><input id="frame-interval" type="number" value={frameInterval} onChange={(e) => setFrameInterval(e.target.value)} min="1" disabled={isLoading} /></div>
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
                <input id="file-upload" type="file" accept="video/*" onChange={handleFileChange} disabled={isLoading} ref={fileInputRef} />
                <label htmlFor="file-upload" className={`upload-button ${selectedFile ? 'file-selected' : ''}`}>{selectedFile ? selectedFile.name : 'Choose a video file...'}</label>
                {previewUrl && (
                  <div className="video-preview-container">
                    <video controls src={previewUrl} width="100%" ref={videoRef} onLoadedMetadata={handleVideoMetadata} />
                  </div>
                )}
                <button className="info-button" onClick={toggleFileInfo}>ℹ️</button>
                <button className="info-button" onClick={toggleConfigInfo}>📊</button>
                {showFileInfo && selectedFile && (
                  <div className="tooltip">
                    <p>Name: {selectedFile.name}</p>
                    <p>Size: {(selectedFile.size / (1024*1024)).toFixed(2)} MB</p>
                    {videoRef.current && <p>Duration: {Math.round(videoRef.current.duration)} s</p>}
                  </div>
                )}
                {showConfigInfo && (
                  <div className="tooltip">
                    <p>Model: {selectedModel}</p>
                    <p>Batches: {totalBatches}</p>
                    <p>Batch Duration: {secondsPerBatch} seconds</p>
                    <p>Frame Interval: {frameInterval}</p>
                    <p>Type: {analysisType}</p>
                    <p>Language: {outputLanguage}</p>
                  </div>
                )}
                <button className="analyze-button" onClick={handleUpload} disabled={isLoading || !selectedFile}>{isLoading ? <Spinner /> : null}{isLoading ? 'Analyzing...' : 'Start Analysis'}</button>
              </>
            )}
          </div>

          {(isLoading || analysisStatus.result || analysisStatus.error) && (
            <div className={`status-card ${openSection === 'analysis' ? 'open' : 'closed'}`}>
              <h2 onClick={() => toggleSection('analysis')}><span className="step-number">3</span> Analysis<span className="accordion-icon">{openSection === 'analysis' ? '▲' : '▼'}</span></h2>
              {openSection === 'analysis' && (
                <>
                  <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${analysisStatus.percent}%` }}></div></div>
                  {!analysisStatus.result && <p className="status-message">{analysisStatus.message}</p>}
                  {analysisStatus.error && <p className="error-message">{analysisStatus.error}</p>}
                  {analysisStatus.result && (
                    <div className="result-container">
                      <h4>Analysis Report:</h4>
                      <div className="report-content">{analysisStatus.result}</div>
                    </div>
                  )}
                  {!isLoading && (<button className="reset-button" onClick={handleReset}>Start New Analysis</button>)}
                </>
              )}
            </div>
          )}
        </main>
        <footer className="App-footer">
          <p>Developed by Mustafa Evleksiz - Version {defaultConfig.VERSION}</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
