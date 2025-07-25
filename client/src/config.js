// client/src/config.js

// Bu dosya, backend'deki config.js'nin bir kopyasıdır
// ve React component'inin başlangıç değerlerini almasını sağlar.
export const MODELS = {
  speedy: {
    label: "\uD83D\uDE80 Speedy",
    note: "En hızlı model",
    secondsPerBatch: 60,
    meetingFrame: 20,
    videoFrame: 5,
    maxDuration: 600,
    maxSize: 200,
  },
  regular: {
    label: "\uD83E\uDD85 Regular",
    note: "Akıllı ve hızlı model",
    secondsPerBatch: 30,
    meetingFrame: 10,
    videoFrame: 3,
    maxDuration: 300,
    maxSize: 150,
  },
  smart: {
    label: "\uD83E\uDD81 Smart",
    note: "En akıllı model",
    secondsPerBatch: 20,
    meetingFrame: 5,
    videoFrame: 1,
    maxDuration: 180,
    maxSize: 120,
  },
};

export const DEFAULT_MODEL = "speedy";

export const config = {
  MODEL_NAME: "gemini-2.5-flash",
  SOCKET: "https://videoii-server.onrender.com",
  // Default client version derived from the last modification date
  VERSION: process.env.REACT_APP_VERSION || "2.0718.1437",
};
