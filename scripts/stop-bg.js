#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const pidFiles = ['dev.pid', 'start.pid', 'start-trace.pid', 'next-start.pid'];
const fallbackPatterns = [
  'next dev --hostname 0.0.0.0 --port 3000',
  'next start --hostname 0.0.0.0 --port 3000',
  `${rootDir}/node_modules/.bin/next dev`,
  `${rootDir}/node_modules/next/dist/bin/next start`,
  `${rootDir}/scripts/start-trace.js`,
  'node scripts/start-trace.js',
  'npm run dev',
  'npm run start:trace'
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

function readChildPids(pid) {
  try {
    const output = execFileSync('pgrep', ['-P', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return String(output || '')
      .split('\n')
      .map(item => Number(item.trim()))
      .filter(item => Number.isInteger(item) && item > 1);
  } catch (e) {
    return [];
  }
}

function collectPidTree(rootPid, acc = new Set()) {
  if (!Number.isInteger(rootPid) || rootPid <= 1) return acc;
  if (acc.has(rootPid)) return acc;
  acc.add(rootPid);
  const children = readChildPids(rootPid);
  for (const childPid of children) {
    collectPidTree(childPid, acc);
  }
  return acc;
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

async function killPidTree(rootPid) {
  const pidTree = [...collectPidTree(rootPid)];
  // 先停子进程，再停父进程，避免 orphan
  pidTree.sort((a, b) => b - a);
  let hasStopped = false;
  for (const pid of pidTree) {
    const stopped = await killPid(pid);
    hasStopped = hasStopped || stopped;
  }
  return {
    hasStopped,
    killed: pidTree
  };
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
    const result = await killPidTree(pid);
    if (result.hasStopped) {
      console.log(`stopped pid tree from ${pid}: ${result.killed.join(',')}`);
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
