#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function listJsFiles(dirPath, out = []) {
  if (!exists(dirPath)) return out;
  for (const name of fs.readdirSync(dirPath)) {
    const abs = path.join(dirPath, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      listJsFiles(abs, out);
    } else if (name.endsWith('.js')) {
      out.push(abs);
    }
  }
  return out;
}

function collectChunkRefs(jsFile) {
  const refs = new Set();
  const text = fs.readFileSync(jsFile, 'utf8');
  const reg = /\.X\(0,\[([0-9,\s]+)\]/g;
  let match = null;
  while ((match = reg.exec(text))) {
    const list = String(match[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const id of list) refs.add(id);
  }
  return refs;
}

function inspectDist(distDir) {
  const absDist = path.join(rootDir, distDir);
  const serverDir = path.join(absDist, 'server');
  const chunksDir = path.join(serverDir, 'chunks');
  const appDir = path.join(serverDir, 'app');
  const pagesDir = path.join(serverDir, 'pages');

  if (!exists(serverDir)) {
    return { distDir, missing: [], checked: 0, present: false };
  }

  const files = [...listJsFiles(appDir), ...listJsFiles(pagesDir)];
  const refs = new Set();
  for (const file of files) {
    for (const ref of collectChunkRefs(file)) refs.add(ref);
  }

  const missing = [];
  for (const chunkId of refs) {
    const chunkPath = path.join(chunksDir, `${chunkId}.js`);
    if (!exists(chunkPath)) {
      missing.push(chunkId);
    }
  }

  return {
    distDir,
    present: true,
    checked: refs.size,
    missing
  };
}

function findPidsByPattern(pattern) {
  try {
    const output = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
    return String(output || '')
      .trim()
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 1);
  } catch {
    return [];
  }
}

function main() {
  const distReports = ['.next', '.next-dev', '.next-prod'].map(inspectDist);
  const devPids = findPidsByPattern('next dev --hostname 0.0.0.0 --port 3000');
  const startPids = findPidsByPattern('next start --hostname 0.0.0.0 --port 3000');

  let hasError = false;

  for (const item of distReports) {
    if (!item.present) {
      console.log(`[doctor] ${item.distDir}: not found`);
      continue;
    }
    if (item.missing.length === 0) {
      console.log(`[doctor] ${item.distDir}: ok (checked ${item.checked} chunk refs)`);
      continue;
    }
    hasError = true;
    console.log(`[doctor] ${item.distDir}: missing chunks -> ${item.missing.join(', ')}`);
  }

  if (devPids.length > 0) {
    console.log(`[doctor] dev process pids: ${devPids.join(', ')}`);
  }
  if (startPids.length > 0) {
    console.log(`[doctor] start process pids: ${startPids.join(', ')}`);
  }
  if (devPids.length > 0 && startPids.length > 0) {
    hasError = true;
    console.log('[doctor] detected dev/start running at the same time, this can corrupt runtime artifacts');
  }

  if (hasError) {
    console.log('[doctor] suggest: npm run stop:bg && npm run clean');
    process.exit(1);
    return;
  }

  console.log('[doctor] healthy');
}

main();
