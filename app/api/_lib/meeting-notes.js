import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { readConfigForUser } from './config-store'
import { runChat } from './llm-client'
import { signOssObjectUrl } from './oss-storage'
import {
  findLatestUserRecordingByFileName,
  getUserRecordingById
} from './recorder-multiuser-store'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const NOTES_DIR = join(UPLOAD_DIR, 'meeting_notes')
const JOBS_DIR = join(NOTES_DIR, 'jobs')
const ASR_ARCHIVE_DIR = join(NOTES_DIR, 'asr')
const TERMINAL_JOB_STATUS = new Set(['completed', 'failed', 'cancelled'])
const MEETING_JOB_STALE_MS = (() => {
  const fallback = 30 * 60 * 1000
  const raw = Number(process.env.MEETING_JOB_STALE_MS || fallback)
  if (!Number.isFinite(raw)) return fallback
  const value = Math.floor(raw)
  if (value < 60 * 1000) return 60 * 1000
  return value
})()

const JOBS = new Map()

function safeFileName(rawName) {
  const value = String(rawName || '')
  const name = basename(value)
  if (!name || name === '.' || name === '..' || name !== value) return ''
  return name
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeJobStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUS.has(normalizeJobStatus(status))
}

function isLiveJobStatus(status) {
  const normalized = normalizeJobStatus(status)
  return normalized === 'queued' || normalized === 'running'
}

function getJobActivityTs(job) {
  const updatedAt = Number(job?.updatedAt || 0)
  if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt
  const createdAt = Number(job?.createdAt || 0)
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt
  return 0
}

function buildStaleFailedJob(job) {
  const now = Date.now()
  const errorText = String(job?.error || '').trim() || '任务中断，请重试'
  return {
    ...job,
    status: 'failed',
    stage: 'error',
    error: errorText,
    updatedAt: now,
    failedAt: now
  }
}

async function collapseStalePersistedJobIfNeeded(job) {
  if (!job || typeof job !== 'object') return job
  if (!isLiveJobStatus(job.status)) return job
  const activityTs = getJobActivityTs(job)
  if (!activityTs) return job
  if ((Date.now() - activityTs) < MEETING_JOB_STALE_MS) return job
  const next = buildStaleFailedJob(job)
  await persistJob(next)
  return next
}

function createJobCancelledError(message) {
  const error = new Error(String(message || 'job cancelled'))
  error.code = 'JOB_CANCELLED'
  return error
}

function isJobCancelledError(error) {
  return String(error?.code || '') === 'JOB_CANCELLED'
}

function buildOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`
  }
  const host = request.headers.get('host')
  if (host) {
    const proto = forwardedProto || (request.url.startsWith('https://') ? 'https' : 'http')
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

function safeEntityId(rawId) {
  const value = String(rawId || '')
  const name = basename(value)
  if (!name || name === '.' || name === '..' || name !== value) return ''
  return name
}

function normalizeUserId(rawUserId) {
  return String(rawUserId || '').trim()
}

function canAccessByUser(ownerUserId, requestUserId) {
  const owner = normalizeUserId(ownerUserId)
  const requester = normalizeUserId(requestUserId)
  if (!requester) return false
  if (!owner) return false
  return owner === requester
}

function getJobFilePath(jobId) {
  return join(JOBS_DIR, `${jobId}.json`)
}

function getNoteMarkdownPath(noteId) {
  return join(NOTES_DIR, `${noteId}.md`)
}

function getNoteMetadataPath(noteId) {
  return join(NOTES_DIR, `${noteId}.json`)
}

function getAsrArchivePath(noteId) {
  return join(ASR_ARCHIVE_DIR, `${noteId}.json`)
}

async function ensureMeetingDirs() {
  await fs.mkdir(NOTES_DIR, { recursive: true })
  await fs.mkdir(JOBS_DIR, { recursive: true })
  await fs.mkdir(ASR_ARCHIVE_DIR, { recursive: true })
}

async function resolveLegacyNoteOwnerUserId(noteId) {
  const safeNoteId = safeEntityId(noteId)
  if (!safeNoteId) return ''
  try {
    const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry?.isFile?.() || !entry.name.endsWith('.json')) continue
      const jobPath = join(JOBS_DIR, entry.name)
      let job = null
      try {
        const raw = await fs.readFile(jobPath, 'utf8')
        job = JSON.parse(raw)
      } catch {
        continue
      }
      if (!job || typeof job !== 'object') continue
      const resultNoteId = safeEntityId(job?.result?.noteId)
      if (resultNoteId !== safeNoteId) continue
      const owner = normalizeUserId(job?.userId)
      if (owner) return owner
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
  return ''
}

async function existsFile(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function persistJob(job) {
  await ensureMeetingDirs()
  await fs.writeFile(getJobFilePath(job.id), JSON.stringify(job, null, 2), 'utf8')
}

async function readPersistedJob(jobId) {
  const safeJobId = safeEntityId(jobId)
  if (!safeJobId) return null
  try {
    const raw = await fs.readFile(getJobFilePath(safeJobId), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

async function getLatestJobState(jobId) {
  const safeJobId = safeEntityId(jobId)
  if (!safeJobId) return null
  const inMemory = JOBS.get(safeJobId)
  if (inMemory) return inMemory
  const stored = await readPersistedJob(safeJobId)
  if (stored) {
    const collapsed = await collapseStalePersistedJobIfNeeded(stored)
    JOBS.set(safeJobId, collapsed)
    return collapsed
  }
  return null
}

async function ensureJobNotCancelled(jobOrId) {
  const id = typeof jobOrId === 'string' ? jobOrId : String(jobOrId?.id || '')
  if (!id) return
  const latest = await getLatestJobState(id)
  const status = normalizeJobStatus(latest?.status)
  if (status === 'cancelled') {
    throw createJobCancelledError('job cancelled')
  }
}

async function updateJob(job, patch, options = null) {
  const force = options?.force === true
  const latest = await getLatestJobState(job.id) || job
  const latestStatus = normalizeJobStatus(latest?.status)
  const patchStatus = normalizeJobStatus(patch?.status)
  if (!force && isTerminalJobStatus(latestStatus)) {
    if (!patchStatus || patchStatus !== latestStatus) {
      return latest
    }
  }
  const next = {
    ...latest,
    ...patch,
    updatedAt: Date.now()
  }
  JOBS.set(next.id, next)
  await persistJob(next)
  return next
}

function toClientJob(job) {
  if (!job) return null
  return {
    id: job.id,
    recordingId: safeEntityId(job.recordingId),
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    fileName: job.fileName,
    error: job.error || '',
    result: job.result || null
  }
}

function composeUrl(baseUrl, pathOrUrl) {
  const value = String(pathOrUrl || '')
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const base = trimSlash(baseUrl)
  if (!base) return value
  if (value.startsWith('/')) return `${base}${value}`
  return `${base}/${value}`
}

function pickTaskId(data) {
  return String(
    data?.output?.task_id ||
    data?.output?.taskId ||
    data?.task_id ||
    data?.taskId ||
    ''
  )
}

function pickTaskStatus(data) {
  return String(
    data?.output?.task_status ||
    data?.output?.taskStatus ||
    data?.status ||
    ''
  ).toUpperCase()
}

function pickTranscriptionUrl(data) {
  const results = Array.isArray(data?.output?.results)
    ? data.output.results
    : (Array.isArray(data?.results) ? data.results : [])
  const fromResults = results.find(item => String(item?.transcription_url || '').trim())
  return String(
    fromResults?.transcription_url ||
    data?.output?.transcription_url ||
    data?.results?.[0]?.transcription_url ||
    ''
  )
}

function pickFailedAsrSubtask(data) {
  const results = Array.isArray(data?.output?.results)
    ? data.output.results
    : (Array.isArray(data?.results) ? data.results : [])
  return results.find(item => {
    const status = String(item?.subtask_status || '').toUpperCase()
    return status.includes('FAIL')
  }) || null
}

function compactJson(value, maxLength) {
  try {
    const text = JSON.stringify(value)
    if (!text) return ''
    const limit = Number(maxLength || 420)
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}...`
  } catch {
    return ''
  }
}

function buildAsrSubtaskError(failedSubtask) {
  if (!failedSubtask || typeof failedSubtask !== 'object') return ''
  const parts = []
  const code = String(failedSubtask.code || '').trim()
  const message = String(failedSubtask.message || '').trim()
  const fileUrl = String(failedSubtask.file_url || failedSubtask.fileUrl || '').trim()
  if (code) parts.push(code)
  if (message) parts.push(message)
  if (fileUrl) parts.push(`file=${fileUrl}`)
  return parts.join(' | ')
}

function hasNoWordsSignal(input) {
  const text = String(input || '').toUpperCase()
  if (!text) return false
  return text.includes('ASR_RESPONSE_HAVE_NO_WORDS') || text.includes('NO_WORDS')
}

function isAsrNoWordsSubtask(failedSubtask) {
  if (!failedSubtask || typeof failedSubtask !== 'object') return false
  const code = String(failedSubtask.code || '')
  const message = String(failedSubtask.message || '')
  return hasNoWordsSignal(code) || hasNoWordsSignal(message)
}

function buildAsrTopLevelError(data, fallbackStatus) {
  const code = String(data?.code || data?.output?.code || '').trim()
  const message = String(
    data?.message ||
    data?.error?.message ||
    data?.output?.message ||
    ''
  ).trim()
  const status = String(fallbackStatus || '').trim()
  const details = []
  if (status) details.push(`status=${status}`)
  if (code) details.push(`code=${code}`)
  if (message) details.push(`message=${message}`)
  const compact = compactJson(data, 360)
  if (compact) details.push(`payload=${compact}`)
  return details.join(' | ')
}

function appendTranscriptLines(lines, input) {
  if (!input) return
  if (typeof input === 'string') {
    const text = input.trim()
    if (text) lines.push(text)
    return
  }
  if (Array.isArray(input)) {
    for (const item of input) appendTranscriptLines(lines, item)
    return
  }
  if (typeof input !== 'object') return

  const text = String(
    input.text ||
    input.content ||
    input.sentence ||
    input.transcript ||
    input.value ||
    ''
  ).trim()
  const speaker = String(
    input.speaker_id ||
    input.speaker ||
    input.spk_id ||
    input.channel_id ||
    ''
  ).trim()
  if (text) {
    lines.push(speaker ? `[${speaker}] ${text}` : text)
  }

  const children = [
    input.sentences,
    input.sentence_list,
    input.segments,
    input.paragraphs,
    input.transcripts,
    input.results,
    input.items
  ]
  for (const child of children) appendTranscriptLines(lines, child)
}

function renderPrompt(template, transcript) {
  const text = String(template || '').trim()
  if (!text) return transcript
  const hasPlaceholder = /\{\{\s*transcript\s*\}\}/i.test(text)
  if (hasPlaceholder) {
    return text.replace(/\{\{\s*transcript\s*\}\}/gi, transcript)
  }
  return `${text}\n\n转写内容如下：\n${transcript}`
}

function buildAdaptiveSummaryPrompt(transcript, template) {
  const basePrompt = renderPrompt(template, transcript)
  return [
    '请先判断输入内容属于以下哪一类：',
    '1) 会议场景（多人讨论、明确议题、决策与分工）',
    '2) 口头记录场景（个人随记、想法整理、复盘备忘）',
    '',
    '输出要求：',
    '- 必须使用中文 Markdown。',
    '- 第一行输出：`内容类型判断：会议纪要` 或 `内容类型判断：口头记录总结`。',
    '- 第二行必须输出一级标题：`# <标题>`，标题要求 8-20 字、简洁且可读。',
    '- 若判断为会议纪要，输出结构：会议主题、关键结论、行动项（负责人/事项/截止时间）、风险与待确认。',
    '- 若判断为口头记录总结，输出结构：主题摘要、核心观点、待办清单、待确认与补充信息。',
    '- 禁止编造未出现的人名、时间和数字；不确定信息请标注“待确认”。',
    '',
    '以下是补充提示词和转写原文：',
    basePrompt
  ].join('\n')
}

function normalizeTitle(text) {
  return String(text || '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
}

function fallbackTitleFromFileName(fileName) {
  const source = String(fileName || '').replace(extname(String(fileName || '')), '').trim()
  const normalized = normalizeTitle(source.replace(/[_-]+/g, ' '))
  if (!normalized) return '未命名纪要'
  if (normalized.length <= 24) return normalized
  return `${normalized.slice(0, 24)}...`
}

function extractNoteTitle(markdown, fileName) {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (/^内容类型判断[:：]/.test(line)) continue
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch) {
      const heading = normalizeTitle(headingMatch[1])
      if (heading) return heading
      continue
    }
    const titleMatch = line.match(/^标题[:：]\s*(.+)$/)
    if (titleMatch) {
      const title = normalizeTitle(titleMatch[1])
      if (title) return title
    }
  }

  return fallbackTitleFromFileName(fileName)
}

function buildNoSpeechMarkdown(fileName) {
  const base = fallbackTitleFromFileName(fileName)
  return [
    '# 空白录音（无有效语音）',
    '',
    `源文件：${base}`,
    '',
    '本次音频未检测到可识别的语音内容。',
    '- 可能是静音、环境噪声为主或音量过低',
    '- 可重新录制后再次生成纪要',
  ].join('\n')
}

function resolveProvider(config, options) {
  const providers = Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  const providerId = String(options?.providerId || config?.llm?.defaultProviderId || '')
  const provider = providers.find(item => String(item?.id || '') === providerId) || providers.find(item => item?.enabled !== false)
  if (!provider) {
    throw new Error('未配置可用 LLM 提供商')
  }
  return provider
}

function resolvePrompt(config, options) {
  const prompts = Array.isArray(config?.prompts?.items) ? config.prompts.items : []
  const promptId = String(options?.promptId || config?.prompts?.defaultPromptId || '')
  const prompt = prompts.find(item => String(item?.id || '') === promptId) || prompts.find(item => item?.enabled !== false)
  if (!prompt) {
    throw new Error('未配置可用 Prompt')
  }
  return prompt
}

async function transcribeWithAsr(config, audioUrl, options = null) {
  const checkCancelled = typeof options?.checkCancelled === 'function'
    ? options.checkCancelled
    : null
  const checkJob = async () => {
    if (checkCancelled) {
      await checkCancelled()
    }
  }

  await checkJob()
  const asr = config?.aliyun?.asr || {}
  const diarizationEnabled = asr?.diarizationEnabled !== false
  const apiKey = String(asr?.apiKey || '').trim()
  const baseUrl = String(asr?.baseUrl || '').trim()
  const submitPath = String(asr?.submitPath || '').trim()
  const queryPathTemplate = String(asr?.queryPathTemplate || '').trim()
  const model = String(asr?.model || '').trim()
  const pollingIntervalMs = Number(asr?.pollingIntervalMs || 3000)
  const pollingTimeoutMs = Number(asr?.pollingTimeoutMs || 300000)
  const languageHints = Array.isArray(asr?.languageHints) ? asr.languageHints : []
  const speakerCount = Number(asr?.speakerCount)
  const hasSpeakerCount = Number.isInteger(speakerCount) && speakerCount >= 2 && speakerCount <= 100
  const requestExtraParams = asr?.requestExtraParams && typeof asr.requestExtraParams === 'object'
    ? asr.requestExtraParams
    : {}

  if (!apiKey) throw new Error('ASR apiKey 未配置')
  if (!baseUrl) throw new Error('ASR baseUrl 未配置')
  if (!submitPath) throw new Error('ASR submitPath 未配置')
  if (!queryPathTemplate) throw new Error('ASR queryPathTemplate 未配置')
  if (!model) throw new Error('ASR model 未配置')

  const submitUrl = composeUrl(baseUrl, submitPath)
  const parameters = {
    ...requestExtraParams
  }
  if (languageHints.length > 0) {
    parameters.language_hints = languageHints
  }
  if (diarizationEnabled) {
    parameters.diarization_enabled = true
    if (hasSpeakerCount) {
      parameters.speaker_count = speakerCount
    }
  }
  const submitBody = {
    model,
    input: {
      file_urls: [audioUrl]
    },
    parameters
  }
  const submitHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-DashScope-Async': 'enable'
  }
  if (String(audioUrl).toLowerCase().startsWith('oss://')) {
    submitHeaders['X-DashScope-OssResourceResolve'] = 'enable'
  }

  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: submitHeaders,
    body: JSON.stringify(submitBody)
  })

  const submitData = await submitRes.json().catch(() => null)
  if (!submitRes.ok) {
    const errorText = submitData?.message || submitData?.error?.message || `HTTP ${submitRes.status}`
    throw new Error(`ASR 提交失败: ${errorText}`)
  }

  const taskId = pickTaskId(submitData)
  if (!taskId) {
    throw new Error('ASR 提交失败: 未返回 task_id')
  }

  const queryUrl = composeUrl(baseUrl, queryPathTemplate.replace('{task_id}', taskId))
  const startedAt = Date.now()
  while (Date.now() - startedAt < pollingTimeoutMs) {
    await checkJob()
    await wait(pollingIntervalMs)
    await checkJob()
    const queryRes = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      cache: 'no-store'
    })
    const queryData = await queryRes.json().catch(() => null)
    if (!queryRes.ok) {
      const errorText = queryData?.message || queryData?.error?.message || `HTTP ${queryRes.status}`
      throw new Error(`ASR 查询失败: ${errorText}`)
    }
    const status = pickTaskStatus(queryData)
    const failedSubtask = pickFailedAsrSubtask(queryData)
    if (failedSubtask) {
      const detail = buildAsrSubtaskError(failedSubtask)
      if (isAsrNoWordsSubtask(failedSubtask)) {
        return {
          transcript: '',
          transcriptionUrl: pickTranscriptionUrl(queryData),
          noSpeech: true,
          noSpeechDetail: detail || 'ASR_RESPONSE_HAVE_NO_WORDS'
        }
      }
      throw new Error(`ASR 子任务失败: ${detail || '未知错误'}`)
    }
    if (status.includes('FAIL')) {
      const detail = buildAsrTopLevelError(queryData, status)
      throw new Error(`ASR 任务失败: ${detail || status}`)
    }

    const url = pickTranscriptionUrl(queryData)
    if (url) {
      await checkJob()
      const transcriptRes = await fetch(url, { cache: 'no-store' })
      const contentType = String(transcriptRes.headers.get('content-type') || '')
      const transcriptPayload = contentType.includes('application/json')
        ? await transcriptRes.json().catch(() => null)
        : await transcriptRes.text()
      const lines = []
      appendTranscriptLines(lines, transcriptPayload)
      const transcript = lines.join('\n').trim()
      if (!transcript) {
        return {
          transcript: '',
          transcriptionUrl: url,
          noSpeech: true,
          noSpeechDetail: 'ASR_TRANSCRIPT_EMPTY'
        }
      }
      await checkJob()
      return {
        transcript,
        transcriptionUrl: url
      }
    }

    if (status.includes('SUCCESS') && queryData?.output?.text) {
      const text = String(queryData.output.text || '').trim()
      if (text) {
        return {
          transcript: text,
          transcriptionUrl: ''
        }
      }
    }
    if (status.includes('SUCCESS')) {
      if (hasNoWordsSignal(queryData?.code) || hasNoWordsSignal(queryData?.message) || hasNoWordsSignal(queryData?.output?.message)) {
        return {
          transcript: '',
          transcriptionUrl: '',
          noSpeech: true,
          noSpeechDetail: 'ASR_RESPONSE_HAVE_NO_WORDS'
        }
      }
      throw new Error('ASR 任务成功但未返回 transcription_url')
    }
  }
  throw new Error('ASR 超时: 任务未在预期时间内完成')
}

async function resolveRecordingForJob(job) {
  const userId = normalizeUserId(job?.userId)
  if (!userId) {
    throw new Error('任务缺少用户信息')
  }
  const recordingId = safeEntityId(job?.recordingId)
  if (recordingId) {
    const recording = await getUserRecordingById(userId, recordingId)
    if (recording) return recording
    throw new Error('录音不存在或无权限')
  }
  const sourceName = safeFileName(job?.fileName)
  if (!sourceName) {
    throw new Error('任务缺少录音信息')
  }
  const recording = await findLatestUserRecordingByFileName(userId, sourceName)
  if (!recording) {
    throw new Error('录音不存在或无权限')
  }
  return recording
}

function resolveAsrSourceFromRecording(config, recording) {
  const sourceName = safeFileName(recording?.file_name || recording?.fileName || '')
  if (!sourceName) {
    throw new Error('录音文件名无效')
  }
  const ossKey = String(recording?.oss_key || recording?.ossKey || '').trim()
  const ossUrl = String(recording?.oss_url || recording?.ossUrl || '').trim()
  if (ossKey) {
    const signed = signOssObjectUrl(config, ossKey, {
      signedUrlExpiresSec: config?.aliyun?.oss?.asrSignedUrlExpiresSec
    })
    const asrUrl = String(signed?.signedUrl || signed?.url || '').trim()
    if (!asrUrl) {
      throw new Error('录音对象签名失败')
    }
    return {
      fileName: sourceName,
      asrAudioUrl: asrUrl,
      asrPublicAudioUrl: String(signed?.url || ossUrl),
      asrOssObjectKey: ossKey,
      asrSignedUrlExpiresSec: Number(signed?.signedUrlExpiresSec || 0)
    }
  }
  if (!ossUrl) {
    throw new Error('录音缺少 OSS 地址')
  }
  return {
    fileName: sourceName,
    asrAudioUrl: ossUrl,
    asrPublicAudioUrl: ossUrl,
    asrOssObjectKey: '',
    asrSignedUrlExpiresSec: 0
  }
}

async function runMeetingJob(job) {
  let current = await updateJob(job, {
    status: 'running',
    stage: 'preparing',
    error: ''
  })

  try {
    await ensureJobNotCancelled(current)
    const recording = await resolveRecordingForJob(current)
    await ensureJobNotCancelled(current)
    current = await updateJob(current, {
      recordingId: String(recording.id || ''),
      fileName: String(recording.file_name || current.fileName || '')
    })
    await ensureJobNotCancelled(current)
    const config = await readConfigForUser(current.userId)
    await ensureJobNotCancelled(current)
    const asrSource = resolveAsrSourceFromRecording(config, recording)
    const asrUrl = String(asrSource.asrAudioUrl || '').trim()
    if (!asrUrl) {
      throw new Error('录音缺少可用的 ASR 访问链接')
    }

    current = await updateJob(current, {
      stage: 'asr',
      asrSourceFileName: asrSource.fileName,
      asrAudioUrl: asrUrl,
      asrPublicAudioUrl: String(asrSource.asrPublicAudioUrl || ''),
      asrOssObjectKey: String(asrSource.asrOssObjectKey || ''),
      asrSignedUrlExpiresSec: Number(asrSource.asrSignedUrlExpiresSec || 0)
    })
    const asrResult = await transcribeWithAsr(config, asrUrl, {
      checkCancelled: () => ensureJobNotCancelled(current.id)
    })
    await ensureJobNotCancelled(current)
    const transcriptText = String(asrResult?.transcript || '')
    const maxChars = Number(config?.meeting?.maxTranscriptChars || 120000)
    const normalizedTranscript = transcriptText.slice(0, maxChars)
    const asrNoSpeech = asrResult?.noSpeech === true || !normalizedTranscript.trim()
    const asrNoSpeechDetail = String(asrResult?.noSpeechDetail || '').trim()

    let provider = { id: 'asr-only', name: 'ASR-only' }
    let prompt = { id: 'asr-empty', name: 'ASR 空白音频兜底' }
    let model = ''
    let completion = { usage: null }
    let markdown = ''

    if (asrNoSpeech) {
      markdown = buildNoSpeechMarkdown(current.fileName)
    } else {
      provider = resolveProvider(config, current.options)
      prompt = resolvePrompt(config, current.options)
      model = String(
        current.options?.model ||
        provider?.selectedModel ||
        config?.llm?.defaultModel ||
        ''
      )
      if (!model) {
        throw new Error('未配置默认模型，请在设置页为提供商选择模型')
      }

      current = await updateJob(current, { stage: 'llm' })
      await ensureJobNotCancelled(current)
      const promptText = buildAdaptiveSummaryPrompt(normalizedTranscript, prompt.content)
      completion = await runChat(provider, {
        model,
        temperature: 0.2,
        maxTokens: 2000,
        messages: [
          {
            role: 'system',
            content: '你是专业会议纪要助手，请严格输出结构化且可执行的会议纪要。'
          },
          {
            role: 'user',
            content: promptText
          }
        ]
      })
      await ensureJobNotCancelled(current)

      markdown = String(completion?.text || '').trim()
      if (!markdown) {
        throw new Error('LLM 返回为空，请更换模型或 Prompt')
      }
    }

    current = await updateJob(current, { stage: 'saving' })
    await ensureJobNotCancelled(current)
    await ensureMeetingDirs()
    const noteId = makeId('note')
    const markdownFileName = `${noteId}.md`
    const markdownPath = getNoteMarkdownPath(noteId)
    const metaPath = getNoteMetadataPath(noteId)
    const asrArchivePath = getAsrArchivePath(noteId)

    const noteTitle = extractNoteTitle(markdown, current.fileName)
    const persistedMarkdown = `${markdown}\n`
    const asrArchive = {
      noteId,
      userId: normalizeUserId(current.userId),
      recordingId: safeEntityId(current.recordingId),
      fileName: current.fileName,
      createdAt: Date.now(),
      asrAudioUrl: String(current.asrAudioUrl || ''),
      asrPublicAudioUrl: String(current.asrPublicAudioUrl || ''),
      asrOssObjectKey: String(current.asrOssObjectKey || ''),
      asrSourceFileName: String(current.asrSourceFileName || ''),
      transcriptionUrl: String(asrResult?.transcriptionUrl || ''),
      transcript: transcriptText,
      transcriptChars: transcriptText.length,
      llmTranscriptChars: normalizedTranscript.length,
      llmTranscriptTruncated: normalizedTranscript.length < transcriptText.length,
      asrNoSpeech,
      asrNoSpeechDetail
    }
    const metadata = {
      id: noteId,
      userId: normalizeUserId(current.userId),
      recordingId: safeEntityId(current.recordingId),
      fileName: current.fileName,
      createdAt: Date.now(),
      providerId: provider.id,
      providerName: provider.name,
      model,
      promptId: prompt.id,
      promptName: prompt.name,
      noteTitle,
      transcriptChars: normalizedTranscript.length,
      asrNoSpeech,
      asrNoSpeechDetail,
      hasAsrArchive: true,
      asrArchiveUrl: `/api/meeting-notes/${encodeURIComponent(noteId)}/asr`,
      usage: completion.usage || null
    }

    await fs.writeFile(markdownPath, persistedMarkdown, 'utf8')
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8')
    await fs.writeFile(asrArchivePath, JSON.stringify(asrArchive, null, 2), 'utf8')

    await ensureJobNotCancelled(current)
    await updateJob(current, {
      status: 'completed',
      stage: 'done',
      result: {
        noteId,
        fileName: markdownFileName,
        noteUrl: `/notes/${encodeURIComponent(noteId)}`,
        asrArchiveUrl: `/api/meeting-notes/${encodeURIComponent(noteId)}/asr`,
        metadata
      }
    })
  } catch (error) {
    if (isJobCancelledError(error)) {
      await updateJob(current, {
        status: 'cancelled',
        stage: 'cancelled',
        error: ''
      }, { force: true })
      return
    }
    await updateJob(current, {
      status: 'failed',
      stage: 'error',
      error: String(error?.message || error)
    })
  }
}

export async function createMeetingJob(input) {
  const userId = normalizeUserId(input?.userId)
  if (!userId) {
    throw new Error('缺少用户信息')
  }
  const requestedRecordingId = safeEntityId(input?.recordingId)
  const requestedFileName = safeFileName(input?.fileName)

  let recording = null
  if (requestedRecordingId) {
    recording = await getUserRecordingById(userId, requestedRecordingId)
    if (!recording) {
      throw new Error('录音不存在或无权限')
    }
  } else if (requestedFileName) {
    recording = await findLatestUserRecordingByFileName(userId, requestedFileName)
    if (!recording) {
      throw new Error('录音不存在或无权限')
    }
  } else {
    throw new Error('recordingId is required')
  }

  const recordingId = safeEntityId(recording?.id || requestedRecordingId)
  const fileName = safeFileName(recording?.file_name || requestedFileName)
  if (!recordingId || !fileName) throw new Error('录音信息无效')

  const id = makeId('job')
  const job = {
    id,
    userId,
    recordingId,
    fileName,
    origin: String(input?.origin || ''),
    status: 'queued',
    stage: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: '',
    result: null,
    options: {
      providerId: String(input?.providerId || ''),
      model: String(input?.model || ''),
      promptId: String(input?.promptId || '')
    }
  }
  JOBS.set(id, job)
  await persistJob(job)
  runMeetingJob(job).catch(() => {})
  return toClientJob(job)
}

export async function getMeetingJob(id, userId) {
  const jobId = safeEntityId(id)
  if (!jobId) return null

  const inMemory = JOBS.get(jobId)
  if (inMemory) {
    if (!canAccessByUser(inMemory.userId, userId)) return null
    return toClientJob(inMemory)
  }

  const stored = await readPersistedJob(jobId)
  if (!stored) return null
  if (!canAccessByUser(stored.userId, userId)) return null
  JOBS.set(jobId, stored)
  return toClientJob(stored)
}

export async function cancelMeetingJob(id, userId) {
  const jobId = safeEntityId(id)
  if (!jobId) return null
  const job = await getLatestJobState(jobId)
  if (!job) return null
  if (!canAccessByUser(job.userId, userId)) return null

  const status = normalizeJobStatus(job.status)
  if (status === 'cancelled' || status === 'completed' || status === 'failed') {
    return toClientJob(job)
  }

  const cancelled = await updateJob(job, {
    status: 'cancelled',
    stage: 'cancelled',
    error: '',
    cancelledAt: Date.now()
  }, { force: true })
  return toClientJob(cancelled)
}

export async function getMeetingNote(noteId, userId) {
  const safeNoteId = safeEntityId(noteId)
  if (!safeNoteId) return null
  const markdownPath = getNoteMarkdownPath(safeNoteId)
  const metadataPath = getNoteMetadataPath(safeNoteId)
  const asrArchivePath = getAsrArchivePath(safeNoteId)
  try {
    const markdown = await fs.readFile(markdownPath, 'utf8')
    const metadataText = await fs.readFile(metadataPath, 'utf8')
    const metadata = JSON.parse(metadataText)
    let ownerUserId = normalizeUserId(metadata?.userId)
    if (!ownerUserId) {
      ownerUserId = await resolveLegacyNoteOwnerUserId(safeNoteId)
      if (ownerUserId) {
        metadata.userId = ownerUserId
        try {
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
        } catch {}
      }
    }
    if (!canAccessByUser(ownerUserId, userId)) {
      return null
    }
    const hasAsrArchive = await existsFile(asrArchivePath)
    return {
      markdown,
      metadata,
      hasAsrArchive,
      asrArchiveUrl: hasAsrArchive ? `/api/meeting-notes/${encodeURIComponent(safeNoteId)}/asr` : ''
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function getMeetingNoteAsr(noteId, userId) {
  const safeNoteId = safeEntityId(noteId)
  if (!safeNoteId) return null
  const asrArchivePath = getAsrArchivePath(safeNoteId)
  try {
    const raw = await fs.readFile(asrArchivePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!canAccessByUser(parsed?.userId, userId)) {
      return null
    }
    const transcript = String(parsed.transcript || '').trim()
    return {
      ...parsed,
      transcript
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

export function getRequestOrigin(request) {
  return buildOrigin(request)
}
