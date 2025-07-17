import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from "socket.io-client";
import './App.css';
import './Spinner.css';
import { config as defaultConfig } from './config.js';

const Spinner = () => <div className="spinner"></div>;
const socket = io("http://localhost:5001");
// const socket = io("https://videoii-server.onrender.com");

function App() {
  const [logoClicks, setLogoClicks] = useState(0);
  const [superMode, setSuperMode] = useState(false);
  const getInitialAnalysisState = () => ({ message: 'Please select a video and configure settings to begin.', percent: 0, result: '', error: '' });
  const [totalBatches, setTotalBatches] = useState(defaultConfig.TOTAL_BATCHES);
  const [secondsPerBatch, setSecondsPerBatch] = useState(defaultConfig.SECONDS_PER_BATCH);
  const [frameInterval, setFrameInterval] = useState(defaultConfig.FRAME_INTERVAL_SECONDS);
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
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setAnalysisStatus({ message: `File selected: ${file.name}. Ready to start.`, percent: 0, result: '', error: '' });
      setMaxBatchesAllowed(1000);
    }
  };
  const handleVideoMetadata = () => { if (videoRef.current) { updateMaxBatches(videoRef.current.duration, secondsPerBatch); } };
  const handleUpload = async () => {
    if (!selectedFile || !socketId) { setAnalysisStatus({ ...analysisStatus, error: 'Please select a file and wait for server connection.' }); return; }
    setIsLoading(true);
    setAnalysisStatus({ message: 'Uploading video...', percent: 0, result: '', error: '' });
    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('analysisType', analysisType);
    formData.append('outputLanguage', outputLanguage);
    formData.append('socketId', socketId);
    formData.append('totalBatches', totalBatches);
    formData.append('secondsPerBatch', secondsPerBatch);
    formData.append('frameInterval', frameInterval);
    try {
      const response = await axios.post('http://localhost:5001/api/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      // const response = await axios.post('https://videoii-server.onrender.com/api/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
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
    setTotalBatches(defaultConfig.TOTAL_BATCHES);
    setSecondsPerBatch(defaultConfig.SECONDS_PER_BATCH);
    setFrameInterval(defaultConfig.FRAME_INTERVAL_SECONDS);
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
  return (
    <div className="App">
      <div className="container">
        <header className="App-header">
          <h1 onClick={handleLogoClick}>VIDEOII</h1>
          <p>Smart Video Analysis Platform</p>
        </header>
        <main className="App-main">
          {!analysisStatus.result && !analysisStatus.error && (
            <div className="controls-card">
              <h2><span className="step-number">1</span> Configuration</h2>
              <div className="form-grid">
                <div className="form-group"><label htmlFor="total-batches">Total Batches (Max: {Math.min(maxBatchesAllowed, superMode ? 100 : 10)})</label><input id="total-batches" type="number" value={totalBatches} onChange={handleBatchChange} min="1" max={Math.min(maxBatchesAllowed, superMode ? 100 : 10)} disabled={isLoading || !selectedFile} /></div>
                <div className="form-group"><label htmlFor="seconds-per-batch">Seconds per Batch {superMode && '(Super Mode: Max 600)'}</label><input id="seconds-per-batch" type="number" value={secondsPerBatch} onChange={handleSecondsChange} min="10" max={superMode ? "600" : "60"} step="10" disabled={isLoading} /></div>
                <div className="form-group"><label htmlFor="frame-interval">Frame Interval (sec)</label><input id="frame-interval" type="number" value={frameInterval} onChange={(e) => setFrameInterval(e.target.value)} min="1" disabled={isLoading} /></div>
                <div className="form-group"><label htmlFor="analysis-type">Analysis Type</label><select id="analysis-type" value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} disabled={isLoading}><option value="general">General Analysis</option><option value="meeting">Meeting Analysis</option></select></div>
                <div className="form-group"><label htmlFor="output-language">Report Language</label><select id="output-language" value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)} disabled={isLoading}><option value="Turkish">Turkish</option><option value="English">English</option></select></div>
              </div>
              <div className="upload-section">
                <h2><span className="step-number">2</span> Upload Video</h2>
                <input id="file-upload" type="file" accept="video/*" onChange={handleFileChange} disabled={isLoading} ref={fileInputRef} />
                <label htmlFor="file-upload" className={`upload-button ${selectedFile ? 'file-selected' : ''}`}>{selectedFile ? selectedFile.name : 'Choose a video file...'}</label>
                {previewUrl && (<div className="video-preview-container"><video controls src={previewUrl} width="100%" ref={videoRef} onLoadedMetadata={handleVideoMetadata} /></div>)}
              </div>
              <button className="analyze-button" onClick={handleUpload} disabled={isLoading || !selectedFile}>{isLoading ? <Spinner /> : null}{isLoading ? 'Analyzing...' : 'Start Analysis'}</button>
            </div>
          )}
          {(isLoading || analysisStatus.result || analysisStatus.error) && (
            <div className="status-card">
              <h2><span className="step-number">3</span> Analysis Progress</h2>
              <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${analysisStatus.percent}%` }}></div></div>
              {!analysisStatus.result && <p className="status-message">{analysisStatus.message}</p>}
              {analysisStatus.error && <p className="error-message">{analysisStatus.error}</p>}
              {analysisStatus.result && (<div className="result-container"><h4>Analysis Report:</h4><div className="report-content">{analysisStatus.result}</div></div>)}
              {(!isLoading) && (<button className="reset-button" onClick={handleReset}>Start New Analysis</button>)}
            </div>
          )}
        </main>
        <footer className="App-footer">
          <p>Developed by Mustafa Evleksiz</p>
        </footer>
      </div>
    </div>
  );
}

export default App;