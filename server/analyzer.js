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
        headers: { 'Content-Type': mimeType, 'x-goog-upload-protocol': 'raw', 'x-goog-file-name': path.basename(filePath), 'Content-Length': stats.size.toString() }
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

// --- YENİ EKLENEN YARDIMCI FONKSİYON (OpenAI için görselleri kodlamak amacıyla) ---
async function fileToBase64(filePath) {
  try {
    const data = await fsPromises.readFile(filePath, { encoding: "base64" });
    const mimeType = path.extname(filePath) === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${data}`;
  } catch (error) {
    console.error(`Error reading file for base64 encoding: ${filePath}`, error);
    return null;
  }
}

// --- Gemini Tabanlı Analiz Fonksiyonu (DEĞİŞTİRİLMEDİ) ---
async function analyzeVideoInBatchesGemini(videoPath, settings, onProgressUpdate) {
    // ... Bu fonksiyonun içeriği orijinaliyle aynıdır, bu nedenle kısaltılmıştır ...
    const { outputLanguage, analysisType, totalBatches, secondsPerBatch, frameInterval } = settings;
    const { send, uiTexts } = onProgressUpdate; 
    if (!genAI) { send({ type: 'error', message: 'Gemini API key not configured.' }); return; }
    const ffmpeg = require('fluent-ffmpeg');
    let finalCumulativeAnalysis = "";
    const uploadedFileNames = [];
    let processedBatches = 0;
    const tempFolders = { frames: path.join(__dirname, config.FRAMES_FOLDER), audio: path.join(__dirname, config.AUDIO_FOLDER) };
    send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), config.MODEL_NAME, totalBatches, secondsPerBatch) });
    await Promise.all(Object.values(tempFolders).map(async (folder) => { await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {}); await fsPromises.mkdir(folder, { recursive: true }); }));
    const model = genAI.getGenerativeModel({ model: config.MODEL_NAME });
    const chat = model.startChat({ history: [] });
    for (let currentBatch = 0; currentBatch < totalBatches; currentBatch++) {
        const percentage = Math.round(((currentBatch) / totalBatches) * 100);
        send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.extracting), percent: percentage });
        const startTimeSeconds = currentBatch * secondsPerBatch;
        const audioChunkPath = path.join(tempFolders.audio, `audio_chunk_${currentBatch}.mp3`);
        const framePattern = path.join(tempFolders.frames,`batch_${currentBatch}_frame-%d.${config.FRAME_FORMAT}`);
        await new Promise((resolve, reject) => { ffmpeg(videoPath).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`,`-vf fps=1/${frameInterval},scale=${config.FRAME_WIDTH}:-1`,`-qscale:v ${config.FRAME_QUALITY}`,]).output(framePattern).noAudio().on('end', resolve).on('error', (err) => { send({ type: 'error', message: `FFmpeg frame extraction error: ${err.message}` }); reject(err); }).run(); });
        let audioFile = null;
        let audioExtractionFailed = false;
        await new Promise((resolve) => { ffmpeg(videoPath).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`]).output(audioChunkPath).noVideo().audioCodec('libmp3lame').on('end', resolve).on('error', () => { audioExtractionFailed = true; send({ type: 'status', message: uiTexts.noAudioStream }); resolve(); }).run(); });
        if (!audioExtractionFailed) {
            audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3", onProgressUpdate);
            if (!audioFile) { send({ type: 'error', message: uiTexts.fileUploadError }); } else { uploadedFileNames.push(audioFile.name); }
            await fsPromises.unlink(audioChunkPath).catch(() => {});
        }
        const frameFiles = (await fsPromises.readdir(tempFolders.frames)).filter(f => f.startsWith(`batch_${currentBatch}`));
        const imageParts = [];
        for (const file of frameFiles) { const mimeType = config.FRAME_FORMAT === 'png' ? 'image/png' : 'image/jpeg'; const part = await fileToGenerativePart(path.join(tempFolders.frames, file), mimeType); if (part) imageParts.push(part); await fsPromises.unlink(path.join(tempFolders.frames, file)).catch(() => {}); }
        const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
        send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });
        let promptText; const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;
        if (currentBatch === 0) { if (analysisType === 'meeting') { promptText = `${languageInstruction}\n\nYou are an expert meeting analysis AI. Generate a clear transcript of the spoken content and then provide detailed meeting minutes including key decisions and action items.`; } else { promptText = `${languageInstruction}\n\nYou are an expert video interpretation AI. Describe in detail what happens in the video segment, highlighting important objects and actions.`; } } else { promptText = `${languageInstruction}\n\nWe are continuing our analysis. Update the transcript or summary with insights from this segment.`; }
        const promptParts = [promptText, ...imageParts];
        if (audioFile) { const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } }; promptParts.push(audioPart); }
        let success = false;
        for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
            try { const result = await chat.sendMessage(promptParts); finalCumulativeAnalysis = result.response.text(); success = true; break; } catch (error) {
                const isOverloaded = error.message && error.message.includes('503');
                if (attempt < config.MAX_RETRIES && isOverloaded) { const waitTime = config.INITIAL_DELAY_MS * Math.pow(2, attempt - 1); send({ type: 'status', message: uiTexts.apiOverloaded(waitTime / 1000, attempt, config.MAX_RETRIES) }); await delay(waitTime); } else { send({ type: 'error', message: `Analysis failed: ${error.message}` }); success = false; break; }
            }
        }
        if (success) { const batchCompletePercent = Math.round(((currentBatch + 1) / totalBatches) * 100); send({ type: 'progress', message: `Batch ${currentBatch + 1}/${totalBatches} complete.`, percent: batchCompletePercent }); processedBatches += 1; } else { send({ type: 'error', message: uiTexts.analysisFailed(config.MAX_RETRIES) }); break; }
    }
    if (processedBatches === totalBatches) { send({ type: 'result', data: finalCumulativeAnalysis }); } else if (processedBatches === 0) { send({ type: 'error', message: 'Video analiz edilemedi, daha uzun bir video seçiniz.' }); }
    send({ type: 'status', message: uiTexts.cleanup });
    for (const fileName of uploadedFileNames) { try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { } }
    for (const folder of Object.values(tempFolders)) { await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {}); }
    send({ type: 'status', message: uiTexts.cleanupComplete });
}

// --- Tarayıcıdan Gelen Ses ve Kareleri Analiz Etme (Gemini - DEĞİŞTİRİLMEDİ) ---
async function analyzeUploadedMediaGemini(framePaths, audioPath, settings, onProgressUpdate) {
    // ... Bu fonksiyonun içeriği orijinaliyle aynıdır, bu nedenle kısaltılmıştır ...
    const { outputLanguage, analysisType } = settings;
    const { send, uiTexts } = onProgressUpdate;
    if (!genAI) { send({ type: 'error', message: 'Gemini API key not configured.' }); return; }
    let finalCumulativeAnalysis = ""; const uploadedFileNames = [];
    send({ type: 'status', message: uiTexts.processing('client-frames', config.MODEL_NAME, 1, 0) });
    let audioFile = null;
    if (audioPath) { audioFile = await uploadFileToGemini(audioPath, 'audio/webm', onProgressUpdate); if (audioFile) uploadedFileNames.push(audioFile.name); }
    const imageParts = [];
    for (const fp of framePaths) { const mimeType = fp.endsWith('.png') ? 'image/png' : 'image/jpeg'; const part = await fileToGenerativePart(fp, mimeType); if (part) imageParts.push(part); }
    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE. EVERY SINGLE WORD, INCLUDING HEADERS, MUST BE IN ${outputLanguage}.**`;
    let promptText; if (analysisType === 'meeting') { promptText = `${languageInstruction}\n\nYou are an expert meeting analysis AI. Create a transcript of the discussion and summarize the meeting with key decisions and action items.`; } else { promptText = `${languageInstruction}\n\nYou are an expert video interpretation AI. Describe in detail the content of the video.`; }
    const promptParts = [promptText, ...imageParts];
    if (audioFile) { const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } }; promptParts.push(audioPart); }
    try { const model = genAI.getGenerativeModel({ model: config.MODEL_NAME }); const chat = model.startChat({ history: [] }); const result = await chat.sendMessage(promptParts); finalCumulativeAnalysis = result.response.text(); send({ type: 'result', data: finalCumulativeAnalysis }); } catch (error) { send({ type: 'error', message: `Analysis failed: ${error.message}` }); }
    send({ type: 'status', message: uiTexts.cleanup });
    for (const fileName of uploadedFileNames) { try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { } }
    for (const fp of framePaths) { await fsPromises.unlink(fp).catch(() => {}); }
    if (audioPath) { await fsPromises.unlink(audioPath).catch(() => {}); }
    send({ type: 'status', message: uiTexts.cleanupComplete });
}

// --- OpenAI Tabanlı Analiz Fonksiyonları (OPTİMİZE EDİLMİŞ VE MULTIMODAL YETENEK KAZANDIRILMIŞ) ---

async function analyzeVideoInBatchesOpenAI(videoPath, settings, onProgressUpdate) {
  const { outputLanguage, analysisType, totalBatches, secondsPerBatch, frameInterval } = settings;
  const { send, uiTexts } = onProgressUpdate;
  if (!OPENAI_API_KEY) {
    send({ type: 'error', message: 'OPENAI_API_KEY not configured.' });
    return;
  }
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const ffmpeg = require('fluent-ffmpeg');
  const MODEL_NAME = 'gpt-4o'; // Veya daha hızlı bir alternatif için 'gpt-4o-mini'

  // Geçici klasörleri yönet (hem ses hem de GÖRÜNTÜLER için)
  const tempFolders = {
    frames: path.join(__dirname, config.FRAMES_FOLDER),
    audio: path.join(__dirname, config.AUDIO_FOLDER),
  };
  await Promise.all(Object.values(tempFolders).map(async (folder) => {
    await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {});
    await fsPromises.mkdir(folder, { recursive: true });
  }));
  
  let conversationHistory = [];
  let finalAnalysis = "";

  // Sisteme rolünü ve genel talimatları en başta ver
  const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE.**`;
  let systemPrompt = "";
  if (analysisType === 'meeting') {
      systemPrompt = `${languageInstruction}\nYou are a multimodal AI assistant for meeting analysis. For each segment (images + audio transcript), provide a brief summary. After the final segment, generate a single comprehensive report with a full transcript, key decisions, and action items.`;
  } else {
      systemPrompt = `${languageInstruction}\nYou are a multimodal AI for video interpretation. For each segment, describe what is happening based on both visuals and audio. At the end, provide a single, detailed summary of the entire video.`;
  }
  conversationHistory.push({ role: 'system', content: systemPrompt });

  send({ type: 'status', message: uiTexts.processing(path.basename(videoPath), MODEL_NAME, totalBatches, secondsPerBatch) });

  for (let currentBatch = 0; currentBatch < totalBatches; currentBatch++) {
    const percentage = Math.round((currentBatch / totalBatches) * 100);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.extracting), percent: percentage });
    
    const startTimeSeconds = currentBatch * secondsPerBatch;
    
    // Hem ses hem de GÖRÜNTÜ karelerini çıkar
    const audioChunkPath = path.join(tempFolders.audio, `audio_chunk_${currentBatch}.mp3`);
    const framePattern = path.join(tempFolders.frames, `batch_${currentBatch}_frame-%d.${config.FRAME_FORMAT}`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([`-t ${secondsPerBatch}`, `-vf fps=1/${frameInterval},scale=${config.FRAME_WIDTH}:-1`, `-qscale:v ${config.FRAME_QUALITY}`])
        .output(framePattern).noAudio()
        .on('end', resolve).on('error', (err) => reject(new Error(`FFmpeg frame extraction error: ${err.message}`)))
        .run();
    });

    let transcript = "No audio detected in this segment.";
    let audioExtractionFailed = false;
    await new Promise((resolve) => {
        ffmpeg(videoPath)
        .inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${secondsPerBatch}`])
        .output(audioChunkPath).noVideo().audioCodec('libmp3lame')
        .on('end', resolve).on('error', () => { audioExtractionFailed = true; resolve(); })
        .run();
    });
    if (!audioExtractionFailed) {
        try {
            const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(audioChunkPath), model: 'whisper-1' });
            transcript = tr.text.trim() ? tr.text : "No speech detected.";
        } catch(e){
            transcript = "Audio could not be transcribed.";
        }
    }
    
    const analysisPercent = percentage + Math.round((100 / totalBatches) / 2);
    send({ type: 'progress', message: uiTexts.step(currentBatch + 1, totalBatches, uiTexts.analyzing), percent: analysisPercent });

    const frameFiles = (await fsPromises.readdir(tempFolders.frames)).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = [];
    for (const file of frameFiles) {
        const framePath = path.join(tempFolders.frames, file);
        const base64Image = await fileToBase64(framePath);
        if (base64Image) {
            imageParts.push({ type: 'image_url', image_url: { url: base64Image, detail: "low" } });
        }
    }
    
    const userContent = [
      { type: 'text', text: `This is segment ${currentBatch + 1}/${totalBatches}. Transcript: "${transcript}"\nAnalyze this segment based on the images and audio.` },
      ...imageParts
    ];

    conversationHistory.push({ role: 'user', content: userContent });

    try {
      const completion = await openai.chat.completions.create({ model: MODEL_NAME, messages: conversationHistory });
      const assistantResponse = completion.choices[0].message;
      finalAnalysis = assistantResponse.content; 
      conversationHistory.push(assistantResponse); 
      
      const batchCompletePercent = Math.round(((currentBatch + 1) / totalBatches) * 100);
      send({ type: 'progress', message: `Batch ${currentBatch + 1}/${totalBatches} complete.`, percent: batchCompletePercent });
    } catch (error) {
      send({ type: 'error', message: `OpenAI API error: ${error.message}` });
      break; 
    } finally {
        // Her döngüden sonra o döngüye ait dosyaları sil
        if(!audioExtractionFailed) await fsPromises.unlink(audioChunkPath).catch(() => {});
        for(const file of frameFiles) await fsPromises.unlink(path.join(tempFolders.frames, file)).catch(() => {});
    }
  }

  // Döngü bittikten sonra nihai bir özet iste
  if (finalAnalysis){
    try {
        send({ type: 'status', message: "Generating final report..." });
        conversationHistory.push({ role: 'user', content: "Based on everything analyzed, provide the final, comprehensive report in the required language and format." });
        
        const finalCompletion = await openai.chat.completions.create({ model: MODEL_NAME, messages: conversationHistory });
        send({ type: 'result', data: finalCompletion.choices[0].message.content });
    } catch (error) {
        send({ type: 'error', message: `Failed to generate final report: ${error.message}` });
        send({ type: 'result', data: "Final report failed. Here is the last available analysis:\n\n" + finalAnalysis });
    }
  } else {
    send({ type: 'error', message: 'Video analysis failed. No content was processed.' });
  }

  send({ type: 'status', message: uiTexts.cleanup });
  await Promise.all(Object.values(tempFolders).map(async (folder) => {
    await fsPromises.rm(folder, { recursive: true, force: true }).catch(() => {});
  }));
  send({ type: 'status', message: uiTexts.cleanupComplete });
}


// --- Tarayıcıdan Gelen Ses ve Kareleri Analiz Etme (OpenAI - OPTİMİZE EDİLMİŞ) ---
async function analyzeUploadedMediaOpenAI(framePaths, audioPath, settings, onProgressUpdate) {
    const { outputLanguage, analysisType } = settings;
    const { send, uiTexts } = onProgressUpdate;
    if (!OPENAI_API_KEY) {
        send({ type: 'error', message: 'OPENAI_API_KEY not configured.' });
        return;
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const MODEL_NAME = 'gpt-4o'; 

    send({ type: 'status', message: uiTexts.processing('client-frames', MODEL_NAME, 1, 0) });

    let transcript = 'No audio provided.';
    if (audioPath) {
        try {
            const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(audioPath), model: 'whisper-1' });
            transcript = tr.text;
        } catch (error) {
            transcript = `Audio transcription failed: ${error.message}`;
            send({ type: 'error', message: transcript });
        }
    }
    
    const imageParts = [];
    for (const fp of framePaths) {
        const base64Image = await fileToBase64(fp);
        if (base64Image) {
            imageParts.push({ type: 'image_url', image_url: { url: base64Image, detail: "low" } });
        }
    }
    
    const languageInstruction = `**ULTIMATE RULE: YOUR ENTIRE RESPONSE MUST BE EXCLUSIVELY IN THE FOLLOWING LANGUAGE: "${outputLanguage}". DO NOT DEVIATE.**`;
    let userPromptText = "";
    if (analysisType === 'meeting') {
        userPromptText = `${languageInstruction}\n\nYou are an expert meeting analyst. Based on the transcript and images, create a report with transcript, decisions, and action items.`;
    } else {
        userPromptText = `${languageInstruction}\n\nYou are an expert video interpretation AI. Using the images and transcript, describe what's happening.`;
    }

    const userContent = [
        { type: 'text', text: `${userPromptText}\n\nAudio Transcript: "${transcript}"` },
        ...imageParts
    ];

    try {
        const completion = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [{ role: 'user', content: userContent }],
            max_tokens: 4000
        });
        send({ type: 'result', data: completion.choices[0].message.content });
    } catch (error) {
        send({ type: 'error', message: `Analysis failed: ${error.message}` });
    }

    send({ type: 'status', message: uiTexts.cleanup });
    for (const fp of framePaths) { await fsPromises.unlink(fp).catch(() => {}); }
    if (audioPath) { await fsPromises.unlink(audioPath).catch(() => {}); }
    send({ type: 'status', message: uiTexts.cleanupComplete });
}

// --- Ana Yönlendirici Fonksiyonlar (DEĞİŞTİRİLMEDİ) ---
// Bu fonksiyonlar, gelen isteği seçilen AI modülüne göre doğru işleve yönlendirir.

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
