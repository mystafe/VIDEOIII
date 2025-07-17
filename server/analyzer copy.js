// server/analyzer.js - OPTIMIZED FOR MEMORY USAGE

const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const axios = require('axios');
const { createReadStream, promises: fsPromises } = require("fs");

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

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

async function analyzeVideoInBatches(videoPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType, totalBatches, secondsPerBatch, frameInterval } = settings;
  const { send, uiTexts } = onProgressUpdate;
  const ffmpeg = require('fluent-ffmpeg');
  let finalCumulativeAnalysis = "";

  const tempFolders = {
    frames: path.join(__dirname, config.FRAMES_FOLDER),
    audio: path.join(__dirname, config.AUDIO_FOLDER),
  };

  send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), config.MODEL_NAME, totalBatches, secondsPerBatch) });

  for (const folder of Object.values(tempFolders)) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    else {
      const files = await fsPromises.readdir(folder);
      await Promise.all(files.map(file => fsPromises.unlink(path.join(folder, file))));
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
        .on('error', err => reject(new Error(`Frame extraction error: ${err.message}`)))
        .run();
    });

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`])
        .output(audioChunkPath).noVideo().audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', err => reject(new Error(`Audio extraction error: ${err.message}`)))
        .run();
    });

    const audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3", onProgressUpdate);
    if (!audioFile) continue;

    const frameFiles = (await fsPromises.readdir(tempFolders.frames)).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = [];
    for (const file of frameFiles) {
      const part = fileToGenerativePart(path.join(tempFolders.frames, file), "image/png");
      if (part) imageParts.push(part);
    }

    const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });

    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: \"${outputLanguage}\". DO NOT DEVIATE.**`;

    const promptText = `${languageInstruction}\n\n${currentBatch === 0 ? 'You are an expert...' : 'We are continuing our analysis...'}`;

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
          break;
        }
      }
    }

    if (!success) {
      send({ type: 'error', message: uiTexts.analysisFailed(config.MAX_RETRIES) });
      break;
    }

    // Temizlik: analiz bittikten sonra ilgili dosyaları kaldır
    for (const file of frameFiles) {
      await fsPromises.unlink(path.join(tempFolders.frames, file));
    }
    await fsPromises.unlink(audioChunkPath);
  }

  send({ type: 'result', data: finalCumulativeAnalysis });
  send({ type: 'status', message: uiTexts.cleanupComplete });
}

module.exports = { analyzeVideoInBatches };