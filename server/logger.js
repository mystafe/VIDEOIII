const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function logAnalysis({ ip, userAgent, settings, fileInfo, startTime, analysisResult }) {
  const logDir = path.join(__dirname, 'log');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logDir, `Analysis_${timestamp}.txt`);

  let location = 'Unknown';
  try {
    if (ip && ip !== '::1') {
      const resp = await axios.get(`https://ipapi.co/${ip.replace('::ffff:', '')}/json/`);
      if (resp.data && resp.data.city) {
        location = `${resp.data.city}, ${resp.data.region}, ${resp.data.country_name}`;
      }
    }
  } catch (err) {
    // Ignore location errors
  }

  const totalRender = ((Date.now() - startTime) / 1000).toFixed(2);

  const lines = [
    `Date: ${new Date().toLocaleString()}`,
    `IP: ${ip}`,
    `Location: ${location}`,
    `Device: ${userAgent}`,
    `Configuration: ${JSON.stringify(settings)}`,
    `Video: ${JSON.stringify(fileInfo)}`,
    `Total Render Time: ${totalRender} sec`,
    `Analysis Result:\n${analysisResult}`,
  ];

  fs.writeFileSync(logPath, lines.join('\n\n'), 'utf8');
}

module.exports = { logAnalysis };
