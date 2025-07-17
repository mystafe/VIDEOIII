// server/index.js - NIHAI VE DÜZELTİLMİŞ BAŞLATICI

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Diğer modüllerimizi import ediyoruz
const { analyzeVideoInBatches } = require('./analyzer.js');
const UI_TEXTS = require('./ui-texts.js'); // Arayüz metinlerini ayrı dosyadan alıyoruz

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://videoii.vercel.app", "https://videoiii.vercel.app"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5001;
app.use(cors());

// Yüklenen dosyalar için geçici bir klasör oluştur
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

io.on('connection', (socket) => {
  console.log('✔ User connected:', socket.id);
  socket.on('disconnect', () => console.log('✖ User disconnected:', socket.id));
});

app.post('/api/analyze', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file not found.' });

  const settings = {
    analysisType: req.body.analysisType,
    outputLanguage: req.body.outputLanguage,
    socketId: req.body.socketId,
    totalBatches: parseInt(req.body.totalBatches, 10) || 1,
    secondsPerBatch: parseInt(req.body.secondsPerBatch, 10) || 60,
    frameInterval: parseInt(req.body.frameInterval, 10) || 10,
  };

  if (!settings.socketId) return res.status(400).json({ error: 'Socket ID not found.' });

  console.log(`--- Analysis request received (Socket ID: ${settings.socketId}) ---`);
  res.status(202).json({ message: 'Analysis request accepted.' });

  try {
    // --- DÜZELTME BURADA ---
    // analyzer'a artık hem Socket.IO gönderme fonksiyonunu
    // hem de arayüz metinlerini içeren bir obje gönderiyoruz.
    const progressCallback = {
      send: (progressUpdate) => {
        io.to(settings.socketId).emit('progressUpdate', progressUpdate);
      },
      uiTexts: UI_TEXTS // Metin objesini de ekliyoruz
    };

    await analyzeVideoInBatches(req.file.path, settings, progressCallback);

  } catch (error) {
    console.error('Error during analysis process:', error);
    io.to(settings.socketId).emit('progressUpdate', { type: 'error', message: 'An unexpected error occurred on the server.' });
  } finally {
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("Could not delete temporary uploaded video:", err);
      else console.log("Temporary uploaded video deleted:", req.file.path);
    });
  }
});

server.listen(PORT, () => console.log(`🚀 Server started on http://localhost:${PORT}`));
//