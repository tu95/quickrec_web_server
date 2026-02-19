#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const supervisorLogPath = path.join(logsDir, 'supervisor.log');
const nextBinPath = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const host = process.env.HOST || '0.0.0.0';
const port = String(process.env.PORT || '3000');

let child = null;
let shuttingDown = false;

function timestamp() {
  return new Date().toISOString();
}

function appendSupervisorLog(level, message) {
  const line = `[${timestamp()}] [${level}] ${message}\n`;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(supervisorLogPath, line);
  } catch (e) {}
}

function logInfo(message) {
  appendSupervisorLog('INFO', message);
  console.log(`[trace] ${message}`);
}

function logError(message) {
  appendSupervisorLog('ERROR', message);
  console.error(`[trace] ${message}`);
}

function exitWithChildResult(code, signal) {
  if (signal) {
    logError(`next start exited by signal=${signal}`);
    process.exit(1);
    return;
  }
  const exitCode = Number.isInteger(code) ? code : 1;
  logInfo(`next start exited code=${exitCode}`);
  process.exit(exitCode);
}

function startNext() {
  if (!fs.existsSync(nextBinPath)) {
    logError(`next binary not found: ${nextBinPath}`);
    process.exit(1);
    return;
  }

  const nodeArgs = [
    '--trace-uncaught',
    '--unhandled-rejections=strict',
    '--report-uncaught-exception',
    '--report-on-fatalerror',
    '--report-directory',
    logsDir,
    '--report-filename',
    'node-report.%p.%t.json',
    nextBinPath,
    'start',
    '--hostname',
    host,
    '--port',
    port
  ];

  logInfo(`launch next start host=${host} port=${port}`);
  child = spawn(process.execPath, nodeArgs, {
    cwd: rootDir,
    env: Object.assign({}, process.env),
    stdio: 'inherit'
  });
  logInfo(`child pid=${child.pid}`);

  child.on('error', (err) => {
    logError(`spawn error: ${err && err.stack ? err.stack : String(err)}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    exitWithChildResult(code, signal);
  });
}

function forwardStop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo(`received ${signal}, forwarding SIGTERM to child`);
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch (e) {
      logError(`failed to signal child: ${String(e)}`);
    }
    setTimeout(() => {
      if (child && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch (e) {}
      }
    }, 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => forwardStop('SIGINT'));
process.on('SIGTERM', () => forwardStop('SIGTERM'));

process.on('uncaughtException', (err) => {
  logError(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const detail = reason && reason.stack ? reason.stack : String(reason);
  logError(`unhandledRejection: ${detail}`);
  process.exit(1);
});

startNext();
