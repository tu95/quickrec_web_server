#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const targets = ['.next', '.next-dev', '.next-prod'];

for (const dir of targets) {
  const absPath = path.join(rootDir, dir);
  try {
    fs.rmSync(absPath, { recursive: true, force: true });
    console.log(`removed ${dir}`);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`failed to remove ${dir}: ${message}`);
    process.exitCode = 1;
  }
}
