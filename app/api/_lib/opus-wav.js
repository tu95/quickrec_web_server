import { promises as fs } from 'fs'
import { extname, join } from 'path'

function loadCodecLibs() {
  try {
    const req = eval('require')
    const OpusScript = req('opusscript')
    const wav = req('wav')
    return { OpusScript, wav }
  } catch {
    throw new Error('缺少依赖，请执行: npm i opusscript wav')
  }
}

function decodeWatchOpusToPcm(opusBuffer, sampleRate, channels, OpusScript) {
  const decoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO)
  const chunks = []
  let pos = 0
  let frameCount = 0

  while (pos + 8 <= opusBuffer.length) {
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
    chunks.push(Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm))
    pos = payloadEnd
    frameCount += 1
  }

  if (frameCount === 0) {
    throw new Error('未解析到任何 Opus 帧')
  }

  return Buffer.concat(chunks)
}

function writePcm16LeToWavFile(outputPath, pcmBuffer, sampleRate, channels, wav) {
  if (!pcmBuffer.length) {
    throw new Error('PCM 数据为空')
  }

  return new Promise((resolve, reject) => {
    const writer = new wav.FileWriter(outputPath, {
      channels,
      sampleRate,
      bitDepth: 16
    })

    writer.once('error', reject)
    writer.once('finish', resolve)
    writer.end(Buffer.from(pcmBuffer))
  })
}

export async function convertOpusFileToWav(options) {
  const uploadDir = options && options.uploadDir ? String(options.uploadDir) : ''
  const opusFileName = options && options.opusFileName ? String(options.opusFileName) : ''
  const overwrite = !options || options.overwrite !== false
  if (!uploadDir || !opusFileName) {
    throw new Error('convertOpusFileToWav 参数缺失')
  }
  if (extname(opusFileName).toLowerCase() !== '.opus') {
    throw new Error('仅支持 .opus 自动转码')
  }

  const inputPath = join(uploadDir, opusFileName)
  await fs.access(inputPath)

  // Zepp 录音是语音场景，默认降采样到 8k 以减少 WAV 体积。
  const sampleRate = 8000
  const channels = 1
  const outputName = `${opusFileName.slice(0, -5)}.wav`
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

  const { OpusScript, wav } = loadCodecLibs()
  const opusBuffer = await fs.readFile(inputPath)
  const pcmBuffer = decodeWatchOpusToPcm(opusBuffer, sampleRate, channels, OpusScript)
  await writePcm16LeToWavFile(outputPath, pcmBuffer, sampleRate, channels, wav)
  const stat = await fs.stat(outputPath)

  return {
    filename: outputName,
    size: stat.size,
    path: outputPath,
    reused: false,
  }
}
