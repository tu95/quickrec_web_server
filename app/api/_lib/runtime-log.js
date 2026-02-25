import { promises as fs } from 'fs'
import { join } from 'path'

const LOG_DIR = join(process.cwd(), 'logs')
const RUNTIME_LOG_PATH = join(LOG_DIR, 'runtime.log')

function redactSecrets(value) {
  return String(value || '')
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***')
}

function sanitize(value, depth = 0) {
  if (depth > 4) return '[max-depth]'
  if (value == null) return value
  if (typeof value === 'string') return redactSecrets(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [key, raw] of Object.entries(value)) {
      out[key] = /apiKey|authorization|token|secret|password/i.test(key)
        ? '***'
        : sanitize(raw, depth + 1)
    }
    return out
  }
  return String(value)
}

export async function writeRuntimeLog(level, event, detail = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: String(level || 'INFO').toUpperCase(),
    event: String(event || 'unknown'),
    detail: sanitize(detail)
  }
  try {
    await fs.mkdir(LOG_DIR, { recursive: true })
    await fs.appendFile(RUNTIME_LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch {}
}

export async function logRuntimeError(event, detail = {}) {
  await writeRuntimeLog('ERROR', event, detail)
}

