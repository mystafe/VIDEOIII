// client/src/config.js

// Bu dosya, backend'deki config.js'nin bir kopyasıdır
// ve React component'inin başlangıç değerlerini almasını sağlar.
export const config = {
  MODEL_NAME: "gemini-2.5-flash",
  TOTAL_BATCHES: 2,
  SECONDS_PER_BATCH: 30,
  FRAME_INTERVAL_SECONDS: 3,
  SOCKET: "https://videoii-server.onrender.com"
};