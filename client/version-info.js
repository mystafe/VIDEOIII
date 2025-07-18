const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function formatDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatVersion(date) {
  return `2.${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
}

function tryGetGitDate(targetPath) {
  try {
    const gitDateStr = execSync(`git log -1 --format=%cd --date=iso-strict -- ${targetPath}`, { encoding: 'utf8' }).trim();
    return new Date(gitDateStr);
  } catch (_) {
    return null;
  }
}

function getFsDate(targetPath) {
  try {
    return fs.statSync(targetPath).mtime;
  } catch (_) {
    return null;
  }
}

function getPackageVersion(targetPath) {
  try {
    const pkg = require(path.join(targetPath, 'package.json'));
    return pkg.version || null;
  } catch (_) {
    return null;
  }
}

function getClientInfo() {
  const date = tryGetGitDate(__dirname) || getFsDate(__dirname);
  if (!date) {
    return { lastModifyDate: null, version: getPackageVersion(__dirname) };
  }
  return { lastModifyDate: formatDate(date), version: formatVersion(date) };
}

if (require.main === module) {
  console.log(getClientInfo().version);
}

module.exports = { getClientInfo };
