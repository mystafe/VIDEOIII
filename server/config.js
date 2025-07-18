// config.js - Nihai, Toplantı Odaklı ve Batch Kontrollü Versiyon

const config = {
  // --- Genel Ayarlar ---
  // Not: "gemini-2.0-flash" henüz mevcut olmadığından, en güncel ve hızlı "Flash" modeli kullanılıyor.
  // Google yeni bir model duyurduğunda bu satırı güncelleyebilirsiniz.
  MODEL_NAME: "gemini-2.5-flash",

  // --- Dosya ve Klasör Ayarları ---
  VIDEO_PATH: 'Input/sample-video.mp4',
  FRAMES_FOLDER: 'temp_frames',
  AUDIO_FOLDER: 'temp_audio',
  // Upload limit for incoming files (in megabytes)
  MAX_UPLOAD_SIZE_MB: 250,

  // --- Batch (Parça) Analiz Ayarları ---
  TOTAL_BATCHES: 1,
  SECONDS_PER_BATCH: 60,
  FRAME_INTERVAL_SECONDS: 10,

  // --- Görsel Çıktı Ayarları ---
  // Daha düşük çözünürlük ve sıkıştırılmış JPEG formatı bellek kullanımını azalır.
  FRAME_WIDTH: 320, // piksel
  FRAME_FORMAT: 'jpg',
  FRAME_QUALITY: 3,

  // --- Tekrar Deneme Mekanizması Ayarları ---
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 2000,
};

module.exports = config;
