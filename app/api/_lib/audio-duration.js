import { once } from 'events'
import { spawn } from 'child_process'

function getFfprobeBin() {
  const fromEnv = String(process.env.FFPROBE_BIN || '').trim()
  return fromEnv || 'ffprobe'
}

function parseDurationSec(rawText) {
  const text = String(rawText || '').trim()
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(1, Math.round(value))
}

export async function probeAudioDurationSec(filePath) {
  const pathText = String(filePath || '').trim()
  if (!pathText) {
    throw new Error('probeAudioDurationSec 参数缺失')
  }

  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    pathText
  ]
  const ffprobe = spawn(getFfprobeBin(), args, {
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  ffprobe.stdout.on('data', chunk => {
    stdout += chunk.toString()
    if (stdout.length > 8 * 1024) {
      stdout = stdout.slice(-8 * 1024)
    }
  })
  ffprobe.stderr.on('data', chunk => {
    stderr += chunk.toString()
    if (stderr.length > 32 * 1024) {
      stderr = stderr.slice(-32 * 1024)
    }
  })

  const [code] = await once(ffprobe, 'close')
  if (Number(code) !== 0) {
    const detail = stderr.trim() || `exit=${code}`
    throw new Error(`ffprobe 执行失败: ${detail}`)
  }

  const durationSec = parseDurationSec(stdout)
  if (!durationSec) {
    throw new Error('ffprobe 未返回有效时长')
  }
  return durationSec
}
