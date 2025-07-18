const { execSync } = require('child_process');

function getVersionInfo() {
  try {
    const gitDateStr = execSync('git log -1 --format=%cd --date=iso-strict', { encoding: 'utf8' }).trim();
    const date = new Date(gitDateStr);

    const lastModifyDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const version = `${date.getFullYear() % 10}.${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;

    return { lastModifyDate, version };
  } catch (err) {
    console.error('Could not derive version from git:', err);
    return { lastModifyDate: null, version: null };
  }
}

module.exports = { getVersionInfo };
