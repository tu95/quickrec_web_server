#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const pidFiles = ['dev.pid', 'start.pid', 'start-trace.pid', 'next-start.pid'];
const fallbackPatterns = [
  `${rootDir}/node_modules/.bin/next dev --hostname 0.0.0.0 --port 3000`,
  `${rootDir}/node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000`,
  `${rootDir}/scripts/start-trace.js`,
  'node scripts/start-trace.js',
];

function readPid(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    const pid = Number(text);
    if (Number.isInteger(pid) && pid > 1) return pid;
  } catch (e) {}
  return null;
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {}
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (!isAlive(pid)) return false;

  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {}

  for (let i = 0; i < 15; i += 1) {
    if (!isAlive(pid)) return true;
    await sleep(200);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {}

  for (let i = 0; i < 10; i += 1) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }

  return !isAlive(pid);
}

function fallbackKill(pattern) {
  try {
    execFileSync('pkill', ['-f', pattern], { stdio: 'ignore' });
  } catch (e) {}
}

async function main() {
  const uniquePids = new Set();

  for (const file of pidFiles) {
    const filePath = path.join(logsDir, file);
    const pid = readPid(filePath);
    if (pid) uniquePids.add(pid);
    removeFile(filePath);
  }

  for (const pid of uniquePids) {
    const stopped = await killPid(pid);
    if (stopped) {
      console.log(`stopped pid=${pid}`);
    } else {
      console.log(`pid not running=${pid}`);
    }
  }

  for (const pattern of fallbackPatterns) {
    fallbackKill(pattern);
  }
}

main().catch((err) => {
  const message = err && err.stack ? err.stack : String(err);
  console.error(message);
  process.exit(1);
});
