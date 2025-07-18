// server/ui-texts.js

const UI_TEXTS = {
  languagePrompt: "In which language should the report be generated? (e.g., Turkish, English): ",
  analysisTypePrompt: "Select analysis type: [1] Meeting Analysis [2] General Video Analysis: ",
  languageConfirmed: (lang) => `✔ Language confirmed: ${lang}.`,
  analysisTypeConfirmed: (type) => `✔ Analysis type confirmed: ${type}.`,
  unsupportedLanguage: (lang, defaultLang) => `❌ '${lang}' is not a supported language. Defaulting to ${defaultLang}.`,
  noLanguage: (defaultLang) => `✔ No language entered. Defaulting to ${defaultLang}.`,
  processing: (path, model) => `▶ Analyzing '${path}' with "${model}" model...`,
  step: (current, total, message) => `[${current}/${total}] ${message}`,
  extracting: "Extracting media chunks...",
  uploading: "Uploading media...",
  analyzing: "Performing cumulative analysis...",
  audioUploadSuccess: "Audio uploaded successfully.",
  fileUploadError: "Failed to upload audio file.",
  noAudioStream: "No audio stream detected. Skipping audio extraction.",
  finalReport: "--- FINAL CUMULATIVE ANALYSIS REPORT ---",
  cleanup: "\nCleaning up...",
  serverCleanup: "  ↪ Deleting temporary audio file(s) from server...",
  localCleanup: "  ↪ Deleting local temporary files...",
  cleanupComplete: "✔ Cleanup complete.",
  error: "An error occurred during the process:",
  apiOverloaded: (delay) => `API is overloaded. Retrying in ${delay}s...`,
  analysisFailed: "Analysis failed after multiple retries."
};

module.exports = UI_TEXTS;
