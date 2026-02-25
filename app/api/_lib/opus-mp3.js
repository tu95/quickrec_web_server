import { once } from 'events'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import { extname, join } from 'path'

function loadOpusScript() {
  try {
    const req = eval('require')
    return req('opusscript')
  } catch {
    throw new Error('缺少依赖，请执行: npm i opusscript')
  }
}

function getFfmpegBin() {
  const fromEnv = String(process.env.FFMPEG_BIN || '').trim()
  return fromEnv || 'ffmpeg'
}

async function writeStreamChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain')
  }
}

async function decodeWatchOpusToMp3(opusBuffer, outputPath, options) {
  const sampleRate = Number(options?.sampleRate || 16000)
  const channels = Number(options?.channels || 1)
  const bitrateKbps = Number(options?.bitrateKbps || 48)
  const OpusScript = loadOpusScript()
  const decoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO)

  const ffmpegArgs = [
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', `${bitrateKbps}k`,
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-y',
    outputPath
  ]

  const ffmpeg = spawn(getFfmpegBin(), ffmpegArgs, {
    stdio: ['pipe', 'ignore', 'pipe']
  })

  let stderr = ''
  ffmpeg.stderr.on('data', chunk => {
    stderr += chunk.toString()
    if (stderr.length > 64 * 1024) {
      stderr = stderr.slice(-64 * 1024)
    }
  })

  let stdinError = null
  ffmpeg.stdin.on('error', err => {
    stdinError = err
  })

  let pos = 0
  let frameCount = 0
  while (pos + 8 <= opusBuffer.length) {
    if (stdinError) {
      throw new Error(`ffmpeg stdin 错误: ${String(stdinError.message || stdinError)}`)
    }
    const payloadLen = opusBuffer.readUInt32BE(pos)
    if (!Number.isInteger(payloadLen) || payloadLen <= 0) {
      throw new Error(`无效帧长度: frame=${frameCount}, len=${payloadLen}`)
    }
    const payloadStart = pos + 8
    const payloadEnd = payloadStart + payloadLen
    if (payloadEnd > opusBuffer.length) {
      throw new Error(`帧越界: frame=${frameCount}, end=${payloadEnd}, total=${opusBuffer.length}`)
    }
    const payload = opusBuffer.subarray(payloadStart, payloadEnd)
    let pcm
    try {
      pcm = decoder.decode(payload)
    } catch (err) {
      throw new Error(`Opus 解码失败: frame=${frameCount}, err=${String(err)}`)
    }

    const pcmBuffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
    await writeStreamChunk(ffmpeg.stdin, pcmBuffer)

    pos = payloadEnd
    frameCount += 1
  }

  if (frameCount === 0) {
    throw new Error('未解析到任何 Opus 帧')
  }

  ffmpeg.stdin.end()
  const [code] = await once(ffmpeg, 'close')
  if (Number(code) !== 0) {
    const detail = stderr.trim() || `exit=${code}`
    throw new Error(`ffmpeg 编码失败: ${detail}`)
  }
}

export async function convertOpusFileToMp3(options) {
  const uploadDir = options && options.uploadDir ? String(options.uploadDir) : ''
  const opusFileName = options && options.opusFileName ? String(options.opusFileName) : ''
  const overwrite = !options || options.overwrite !== false
  const removeSource = !!(options && options.removeSource)
  const sampleRate = Number(options?.sampleRate || 16000)
  const channels = Number(options?.channels || 1)
  const bitrateKbps = Number(options?.bitrateKbps || 48)

  if (!uploadDir || !opusFileName) {
    throw new Error('convertOpusFileToMp3 参数缺失')
  }
  if (extname(opusFileName).toLowerCase() !== '.opus') {
    throw new Error('仅支持 .opus 转 .mp3')
  }

  const inputPath = join(uploadDir, opusFileName)
  await fs.access(inputPath)

  const outputName = `${opusFileName.slice(0, -5)}.mp3`
  const outputPath = join(uploadDir, outputName)

  if (!overwrite) {
    try {
      const stat = await fs.stat(outputPath)
      return {
        filename: outputName,
        size: stat.size,
        path: outputPath,
        reused: true,
      }
    } catch {}
  } else {
    try {
      await fs.unlink(outputPath)
    } catch {}
  }

  const opusBuffer = await fs.readFile(inputPath)
  await decodeWatchOpusToMp3(opusBuffer, outputPath, {
    sampleRate,
    channels,
    bitrateKbps
  })

  if (removeSource) {
    try {
      await fs.unlink(inputPath)
    } catch {}
  }

  const stat = await fs.stat(outputPath)
  return {
    filename: outputName,
    size: stat.size,
    path: outputPath,
    reused: false,
  }
}

