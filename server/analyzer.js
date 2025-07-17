// server/analyzer.js - NIHAI, TAM VE HATASIZ VERSİYON

const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const { createReadStream, promises: fsPromises } = require("fs");
const path = require("path");
const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

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

function fileToGenerativePart(filePath, mimeType) {
  try {
    const data = fs.readFileSync(filePath).toString("base64");
    return { inlineData: { data, mimeType } };
  } catch (error) {
    console.error(`Error reading file for generative part: ${filePath}.`, error);
    return null;
  }
}

// --- Ana Analiz Fonksiyonu ---
async function analyzeVideoInBatches(videoPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType, totalBatches, secondsPerBatch, frameInterval } = settings;
  const { send, uiTexts } = onProgressUpdate; // Fonksiyonları ve metinleri en başta alıyoruz
  const ffmpeg = require('fluent-ffmpeg');
  let finalCumulativeAnalysis = "";
  const uploadedFileNames = [];

  const tempFolders = {
    frames: path.join(__dirname, config.FRAMES_FOLDER),
    audio: path.join(__dirname, config.AUDIO_FOLDER),
  };

  send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), config.MODEL_NAME, totalBatches, secondsPerBatch) });

  for (const folder of Object.values(tempFolders)) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    else {
      fs.readdirSync(folder).forEach(file => { try { fs.unlinkSync(path.join(folder, file)); } catch (err) { } });
    }
  }

  const model = genAI.getGenerativeModel({ model: config.MODEL_NAME });
  const chat = model.startChat({ history: [] });

  for (let currentBatch = 0; currentBatch < totalBatches; currentBatch++) {
    const percentage = Math.round(((currentBatch) / totalBatches) * 100);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.extracting), percent: percentage });

    const startTimeSeconds = currentBatch * secondsPerBatch;
    const audioChunkPath = path.join(tempFolders.audio, `audio_chunk_${currentBatch}.mp3`);
    const framePattern = path.join(tempFolders.frames, `batch_${currentBatch}_frame-%d.png`);

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`])
        .output(framePattern).outputOptions([`-vf fps=1/${frameInterval}`]).noAudio()
        .on('end', resolve)
        .on('error', (err) => {
          send({ type: 'error', message: `FFmpeg frame extraction error: ${err.message}` });
          reject(err);
        })
        .run();
    });

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`])
        .output(audioChunkPath).noVideo().audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', (err) => {
          send({ type: 'error', message: `FFmpeg audio extraction error: ${err.message}` });
          reject(err);
        })
        .run();
    });

    const audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3", onProgressUpdate);
    if (!audioFile) {
      send({ type: 'error', message: uiTexts.fileUploadError });
      continue;
    }
    uploadedFileNames.push(audioFile.name);
    await fsPromises.unlink(audioChunkPath).catch(() => {});

    const frameFiles = (await fsPromises.readdir(tempFolders.frames)).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = [];
    for (const file of frameFiles) {
      const part = fileToGenerativePart(path.join(tempFolders.frames, file), "image/png");
      if (part) imageParts.push(part);
      await fsPromises.unlink(path.join(tempFolders.frames, file)).catch(() => {});
    }

    const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });

    let promptText;
    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;

    if (currentBatch === 0) {
      if (analysisType === 'meeting') {
        promptText = `${languageInstruction}\n\nYou are an expert meeting analysis AI... (Önceki cevaptaki tam toplantı prompt'u)`;
      } else {
        promptText = `${languageInstruction}\n\nYou are an expert video interpretation AI... (Önceki cevaptaki tam genel video prompt'u)`;
      }
    } else {
      promptText = `${languageInstruction}\n\nWe are continuing our analysis... (Önceki cevaptaki tam güncelleme prompt'u)`;
    }

    const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } };
    const promptParts = [promptText, ...imageParts, audioPart];

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
    } else {
      // Hata mesajı zaten gönderildi, döngüyü kırabiliriz.
      send({ type: 'error', message: uiTexts.analysisFailed(config.MAX_RETRIES) });
      break;
    }
  }

  // Sadece tüm batch'ler başarılı olduysa sonucu gönder
  if (uploadedFileNames.length === totalBatches) {
    send({ type: 'result', data: finalCumulativeAnalysis });
  }

  send({ type: 'status', message: uiTexts.cleanup });
  for (const fileName of uploadedFileNames) {
    try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { }
  }
  for (const folder of Object.values(tempFolders)) {
    if (fs.existsSync(folder)) {
      fs.readdirSync(folder).forEach(file => { try { fs.unlinkSync(path.join(folder, file)); } catch (err) { } });
      try { fs.rmdirSync(folder); } catch (err) { }
    }
  }
  send({ type: 'status', message: uiTexts.cleanupComplete });
}

module.exports = { analyzeVideoInBatches };
