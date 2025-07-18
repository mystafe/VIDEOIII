const { execSync } = require('child_process');

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatVersion(date) {
  return `${date.getFullYear() % 10}.${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
}

function getInfoForPath(path) {
  const gitDateStr = execSync(`git log -1 --format=%cd --date=iso-strict -- ${path}`, { encoding: 'utf8' }).trim();
  const date = new Date(gitDateStr);
  return { lastModifyDate: formatDate(date), version: formatVersion(date) };
}

function getVersionInfo() {
  try {
    return {
      client: getInfoForPath('client'),
      server: getInfoForPath('server'),
    };
  } catch (err) {
    console.error('Could not derive version from git:', err);
    return { client: { lastModifyDate: null, version: null }, server: { lastModifyDate: null, version: null } };
  }
}

module.exports = { getVersionInfo };
