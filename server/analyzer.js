// server/analyzer.js - NIHAI, TAM VE HATASIZ VERSİYON

const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const { createReadStream, promises: fsPromises } = require("fs");
const path = require("path");
const axios = require('axios');
const OpenAI = require('openai');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.warn("WARNING: GOOGLE_API_KEY not found. Gemini module will be unavailable.");
}
const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Yardımcı Fonksiyonlar ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function uploadFileToGemini(filePath, mimeType, onProgressUpdate) {
  const { send, uiTexts } = onProgressUpdate;
  try {
    send({ type: 'status', message: `${uiTexts.uploading} ${path.basename(filePath)}` });
    const stats = await fsPromises.stat(filePath);
    const fileStream = createReadStream(filePath);
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GOOGLE_API_KEY}`,
      fileStream,
      {
        headers: {
          'Content-Type': mimeType,
          'x-goog-upload-protocol': 'raw',
          'x-goog-file-name': path.basename(filePath),
          'Content-Length': stats.size.toString()
        }
      }
    );
    send({ type: 'status', message: uiTexts.audioUploadSuccess });
    return response.data.file;
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    send({ type: 'error', message: `File Upload Error: ${errorMessage}` });
    return null;
  }
}

async function fileToGenerativePart(filePath, mimeType) {
  try {
    const data = await fsPromises.readFile(filePath, { encoding: "base64" });
    return { inlineData: { data, mimeType } };
  } catch (error) {
    console.error(`Error reading file for generative part: ${filePath}.`, error);
    return null;
  }
}

// --- Gemini Tabanlı Analiz Fonksiyonu ---
async function analyzeVideoInBatchesGemini(videoPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType, totalBatches, secondsPerBatch, frameInterval } = settings;
  const { send, uiTexts } = onProgressUpdate; // Fonksiyonları ve metinleri en başta alıyoruz
  if (!genAI) { send({ type: 'error', message: 'Gemini API key not configured.' }); return; }
  const ffmpeg = require('fluent-ffmpeg');
  let finalCumulativeAnalysis = "";
  const uploadedFileNames = [];
  let processedBatches = 0;

  const tempFolders = {
    frames: path.join(__dirname, config.FRAMES_FOLDER),
    audio: path.join(__dirname, config.AUDIO_FOLDER),
  };

  send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), config.MODEL_NAME, totalBatches, secondsPerBatch) });

  await Promise.all(Object.values(tempFolders).map(async (folder) => {
    await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {});
    await fsPromises.mkdir(folder, { recursive: true });
  }));

  const model = genAI.getGenerativeModel({ model: config.MODEL_NAME });
  const chat = model.startChat({ history: [] });

  for (let currentBatch = 0; currentBatch < totalBatches; currentBatch++) {
    const percentage = Math.round(((currentBatch) / totalBatches) * 100);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.extracting), percent: percentage });

    const startTimeSeconds = currentBatch * secondsPerBatch;
    const audioChunkPath = path.join(tempFolders.audio, `audio_chunk_${currentBatch}.mp3`);
    const framePattern = path.join(
      tempFolders.frames,
      `batch_${currentBatch}_frame-%d.${config.FRAME_FORMAT}`
    );

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([
          `-t ${secondsPerBatch}`,
          `-vf fps=1/${frameInterval},scale=${config.FRAME_WIDTH}:-1`,
          `-qscale:v ${config.FRAME_QUALITY}`,
        ])
        .output(framePattern)
        .noAudio()
        .on('end', resolve)
        .on('error', (err) => {
          send({ type: 'error', message: `FFmpeg frame extraction error: ${err.message}` });
          reject(err);
        })
        .run();
    });

    let audioFile = null;
    let audioExtractionFailed = false;
    await new Promise((resolve) => {
      ffmpeg(videoPath)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([`-t ${secondsPerBatch}`])
        .output(audioChunkPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', () => {
          audioExtractionFailed = true;
          send({ type: 'status', message: uiTexts.noAudioStream });
          resolve();
        })
        .run();
    });
    if (!audioExtractionFailed) {
      audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3", onProgressUpdate);
      if (!audioFile) {
        send({ type: 'error', message: uiTexts.fileUploadError });
      } else {
        uploadedFileNames.push(audioFile.name);
      }
      await fsPromises.unlink(audioChunkPath).catch(() => {});
    }

    const frameFiles = (await fsPromises.readdir(tempFolders.frames)).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = [];
    for (const file of frameFiles) {
      const mimeType = config.FRAME_FORMAT === 'png' ? 'image/png' : 'image/jpeg';
      const part = await fileToGenerativePart(
        path.join(tempFolders.frames, file),
        mimeType
      );
      if (part) imageParts.push(part);
      await fsPromises.unlink(path.join(tempFolders.frames, file)).catch(() => {});
    }

    const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });

    let promptText;
    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;

    if (currentBatch === 0) {
      if (analysisType === 'meeting') {
        promptText = `${languageInstruction}\n\nYou are an expert meeting analysis AI. Generate a clear transcript of the spoken content and then provide detailed meeting minutes including key decisions and action items.`;
      } else {
        promptText = `${languageInstruction}\n\nYou are an expert video interpretation AI. Describe in detail what happens in the video segment, highlighting important objects and actions.`;
      }
    } else {
      promptText = `${languageInstruction}\n\nWe are continuing our analysis. Update the transcript or summary with insights from this segment.`;
    }

    const promptParts = [promptText, ...imageParts];
    if (audioFile) {
      const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } };
      promptParts.push(audioPart);
    }

    let success = false;
    for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
      try {
        const result = await chat.sendMessage(promptParts);
        finalCumulativeAnalysis = result.response.text();
        success = true;
        break;
      } catch (error) {
        const isOverloaded = error.message && error.message.includes('503');
        if (attempt < config.MAX_RETRIES && isOverloaded) {
          const waitTime = config.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          send({ type: 'status', message: uiTexts.apiOverloaded(waitTime / 1000, attempt, config.MAX_RETRIES) });
          await delay(waitTime);
        } else {
          send({ type: 'error', message: `Analysis failed: ${error.message}` });
          success = false;
          break;
        }
      }
    }

    if (success) {
      const batchCompletePercent = Math.round(((currentBatch + 1) / totalBatches) * 100);
      send({ type: 'progress', message: `Batch ${currentBatch + 1}/${totalBatches} complete.`, percent: batchCompletePercent });
      processedBatches += 1;
    } else {
      // Hata mesajı zaten gönderildi, döngüyü kırabiliriz.
      send({ type: 'error', message: uiTexts.analysisFailed(config.MAX_RETRIES) });
      break;
    }
  }

  // Sadece tüm batch'ler başarılı olduysa sonucu gönder
  if (processedBatches === totalBatches) {
    send({ type: 'result', data: finalCumulativeAnalysis });
  } else if (processedBatches === 0) {
    send({ type: 'error', message: 'Video analiz edilemedi, daha uzun bir video seçiniz.' });
  }

  send({ type: 'status', message: uiTexts.cleanup });
  for (const fileName of uploadedFileNames) {
    try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { }
  }
  for (const folder of Object.values(tempFolders)) {
    await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
  send({ type: 'status', message: uiTexts.cleanupComplete });
}

// --- Tarayıcıdan Gelen Ses ve Kareleri Analiz Et ---
async function analyzeUploadedMediaGemini(framePaths, audioPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType } = settings;
  const { send, uiTexts } = onProgressUpdate;
  if (!genAI) { send({ type: 'error', message: 'Gemini API key not configured.' }); return; }
  let finalCumulativeAnalysis = "";
  const uploadedFileNames = [];

  send({ type: 'status', message: uiTexts.processing('client-frames', config.MODEL_NAME, 1, 0) });

  let audioFile = null;
  if (audioPath) {
    audioFile = await uploadFileToGemini(audioPath, 'audio/webm', onProgressUpdate);
    if (audioFile) uploadedFileNames.push(audioFile.name);
  }

  const imageParts = [];
  for (const fp of framePaths) {
    const mimeType = fp.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const part = await fileToGenerativePart(fp, mimeType);
    if (part) imageParts.push(part);
  }

  const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;
  let promptText;
  if (analysisType === 'meeting') {
    promptText = `${languageInstruction}\n\nYou are an expert meeting analysis AI. Create a transcript of the discussion and summarize the meeting with key decisions and action items.`;
  } else {
    promptText = `${languageInstruction}\n\nYou are an expert video interpretation AI. Describe in detail the content of the video.`;
  }
  const promptParts = [promptText, ...imageParts];
  if (audioFile) {
    const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } };
    promptParts.push(audioPart);
  }

  try {
    const model = genAI.getGenerativeModel({ model: config.MODEL_NAME });
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage(promptParts);
    finalCumulativeAnalysis = result.response.text();
    send({ type: 'result', data: finalCumulativeAnalysis });
  } catch (error) {
    send({ type: 'error', message: `Analysis failed: ${error.message}` });
  }

  send({ type: 'status', message: uiTexts.cleanup });
  for (const fileName of uploadedFileNames) {
    try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { }
  }
  for (const fp of framePaths) { await fsPromises.unlink(fp).catch(() => {}); }
  if (audioPath) { await fsPromises.unlink(audioPath).catch(() => {}); }
  send({ type: 'status', message: uiTexts.cleanupComplete });
}
// --- OpenAI Tabanlı Analiz Fonksiyonları ---
async function analyzeVideoInBatchesOpenAI(videoPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType, totalBatches, secondsPerBatch } = settings;
  const { send, uiTexts } = onProgressUpdate;
  if (!OPENAI_API_KEY) {
    send({ type: 'error', message: 'OPENAI_API_KEY not configured.' });
    return;
  }
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const ffmpeg = require('fluent-ffmpeg');
  let transcript = '';
  const tempAudio = path.join(__dirname, config.AUDIO_FOLDER);
  await fsPromises.rm(tempAudio, { recursive: true, force: true }).catch(() => {});
  await fsPromises.mkdir(tempAudio, { recursive: true });
  send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), 'gpt-4o-mini', totalBatches, secondsPerBatch) });
  for (let currentBatch = 0; currentBatch < totalBatches; currentBatch++) {
    const percentage = Math.round((currentBatch / totalBatches) * 100);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.extracting), percent: percentage });
    const startTimeSeconds = currentBatch * secondsPerBatch;
    const audioChunkPath = path.join(tempAudio, `audio_chunk_${currentBatch}.mp3`);
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([`-t ${secondsPerBatch}`])
        .output(audioChunkPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });
    try {
      const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(audioChunkPath), model: 'gpt-4o-mini-transcribe' });
      transcript += tr.text + '\n';
      const batchCompletePercent = Math.round(((currentBatch + 1) / totalBatches) * 100);
      send({ type: 'progress', message: `Batch ${currentBatch + 1}/${totalBatches} complete.`, percent: batchCompletePercent });
    } catch (error) {
      send({ type: 'error', message: `Transcription failed: ${error.message}` });
      break;
    }
    await fsPromises.unlink(audioChunkPath).catch(() => {});
  }
  if (transcript.trim()) {
    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;
    let prompt;
    if (analysisType === 'meeting') {
      prompt = `${languageInstruction}\n\nBased on the following transcript, first present the transcript, then provide detailed meeting minutes with key decisions and action items.\n\nTranscript:\n${transcript}`;
    } else {
      prompt = `${languageInstruction}\n\nProvide a detailed summary and key insights for the following video transcript:\n${transcript}`;
    }
    try {
      const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
      const text = completion.choices[0].message.content;
      send({ type: 'result', data: text });
    } catch (error) {
      send({ type: 'error', message: `Analysis failed: ${error.message}` });
    }
  } else {
    send({ type: 'error', message: 'No transcript generated.' });
  }
  send({ type: 'status', message: uiTexts.cleanup });
  await fsPromises.rm(tempAudio, { recursive: true, force: true }).catch(() => {});
  send({ type: 'status', message: uiTexts.cleanupComplete });
}

async function analyzeUploadedMediaOpenAI(framePaths, audioPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType } = settings;
  const { send, uiTexts } = onProgressUpdate;
  if (!OPENAI_API_KEY) {
    send({ type: 'error', message: 'OPENAI_API_KEY not configured.' });
    return;
  }
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  send({ type: 'status', message: uiTexts.processing('client-frames', 'gpt-4o-mini', 1, 0) });
  let transcript = '';
  if (audioPath) {
    try {
      const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(audioPath), model: 'gpt-4o-mini-transcribe' });
      transcript = tr.text;
    } catch (error) {
      send({ type: 'error', message: `Transcription failed: ${error.message}` });
    }
  }
  const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;
  let prompt;
  if (analysisType === 'meeting') {
    prompt = `${languageInstruction}\n\nBased on the following transcript, first present the transcript and then provide detailed meeting minutes with key decisions and action items.\n\nTranscript:\n${transcript}`;
  } else {
    prompt = `${languageInstruction}\n\nProvide a detailed summary and key insights for the following video transcript:\n${transcript}`;
  }
  try {
    const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
    const text = completion.choices[0].message.content;
    send({ type: 'result', data: text });
  } catch (error) {
    send({ type: 'error', message: `Analysis failed: ${error.message}` });
  }
  send({ type: 'status', message: uiTexts.cleanup });
  for (const fp of framePaths) { await fsPromises.unlink(fp).catch(() => {}); }
  if (audioPath) { await fsPromises.unlink(audioPath).catch(() => {}); }
  send({ type: 'status', message: uiTexts.cleanupComplete });
}

async function analyzeVideoInBatches(videoPath, settings, onProgressUpdate) {
  if (settings.aiModule === 'openai') {
    return analyzeVideoInBatchesOpenAI(videoPath, settings, onProgressUpdate);
  }
  return analyzeVideoInBatchesGemini(videoPath, settings, onProgressUpdate);
}

async function analyzeUploadedMedia(framePaths, audioPath, settings, onProgressUpdate) {
  if (settings.aiModule === 'openai') {
    return analyzeUploadedMediaOpenAI(framePaths, audioPath, settings, onProgressUpdate);
  }
  return analyzeUploadedMediaGemini(framePaths, audioPath, settings, onProgressUpdate);
}

module.exports = { analyzeVideoInBatches, analyzeUploadedMedia };
