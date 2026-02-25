function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
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

function safePreviewList(items, max = 5) {
  return Array.isArray(items) ? items.slice(0, max) : []
}

async function parsePayload(response) {
  const text = await response.text().catch(() => '')
  if (!text) return { data: null, rawText: '' }
  try {
    return { data: JSON.parse(text), rawText: text }
  } catch {
    return { data: null, rawText: text }
  }
}

function pickErrorText(payload, rawText, status) {
  return payload?.error?.message || payload?.message || rawText || `HTTP ${status}`
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

export function extractAsrTaskStatus(payload) {
  const taskStatus = String(
    payload?.output?.task_status ||
    payload?.output?.taskStatus ||
    payload?.task_status ||
    payload?.status ||
    ''
  ).toUpperCase()

  const results = Array.isArray(payload?.output?.results)
    ? payload.output.results
    : (Array.isArray(payload?.results) ? payload.results : [])

  const failedSubtask = results.find(item => {
    const status = String(item?.subtask_status || '').toUpperCase()
    return status.includes('FAIL')
  }) || null

  const transcriptionUrl = String(
    results.find(item => String(item?.transcription_url || '').trim())?.transcription_url ||
    payload?.output?.transcription_url ||
    payload?.transcription_url ||
    ''
  ).trim()

  return {
    taskStatus,
    results,
    failedSubtask,
    transcriptionUrl
  }
}

export const DASHSCOPE_ASR_DEFAULT_TEST_FILE_URL = 'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav'

export async function submitDashscopeAsrTask(options) {
  const baseUrl = trimSlash(options?.baseUrl)
  const submitPath = String(options?.submitPath || '/services/audio/asr/transcription').trim()
  const apiKey = String(options?.apiKey || '').trim()
  const model = String(options?.model || '').trim()
  const fileUrls = Array.isArray(options?.fileUrls)
    ? options.fileUrls.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const requestExtraParams = options?.requestExtraParams && typeof options.requestExtraParams === 'object'
    ? options.requestExtraParams
    : {}
  const languageHints = Array.isArray(options?.languageHints)
    ? options.languageHints.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const diarizationEnabled = !!options?.diarizationEnabled
  const speakerCount = Number(options?.speakerCount)
  const hasSpeakerCount = Number.isInteger(speakerCount) && speakerCount >= 2 && speakerCount <= 100

  if (!baseUrl) throw new Error('ASR baseUrl 未配置')
  if (!apiKey) throw new Error('ASR apiKey 未配置')
  if (!model) throw new Error('ASR model 未配置')
  if (!submitPath) throw new Error('ASR submitPath 未配置')
  if (fileUrls.length === 0) throw new Error('ASR file_urls 为空')

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

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable'
  }
  if (fileUrls.some(url => String(url).toLowerCase().startsWith('oss://'))) {
    headers['X-DashScope-OssResourceResolve'] = 'enable'
  }

  const body = {
    model,
    input: {
      file_urls: fileUrls
    },
    parameters
  }

  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store'
  })
  const { data, rawText } = await parsePayload(submitRes)
  if (!submitRes.ok) {
    throw new Error(`HTTP ${submitRes.status}: ${pickErrorText(data, rawText, submitRes.status)}`)
  }
  const taskId = pickTaskId(data)
  if (!taskId) {
    throw new Error('ASR 提交失败: 未返回 task_id')
  }
  return {
    taskId,
    submitPayload: data
  }
}

export async function queryDashscopeAsrTask(options) {
  const baseUrl = trimSlash(options?.baseUrl)
  const queryPathTemplate = String(options?.queryPathTemplate || '/tasks/{task_id}').trim()
  const apiKey = String(options?.apiKey || '').trim()
  const taskId = String(options?.taskId || '').trim()

  if (!baseUrl) throw new Error('ASR baseUrl 未配置')
  if (!apiKey) throw new Error('ASR apiKey 未配置')
  if (!queryPathTemplate) throw new Error('ASR queryPathTemplate 未配置')
  if (!taskId) throw new Error('ASR taskId 为空')

  const queryPath = queryPathTemplate.replace('{task_id}', taskId)
  const queryUrl = composeUrl(baseUrl, queryPath)
  const queryRes = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable'
    },
    cache: 'no-store'
  })
  const { data, rawText } = await parsePayload(queryRes)
  if (!queryRes.ok) {
    throw new Error(`HTTP ${queryRes.status}: ${pickErrorText(data, rawText, queryRes.status)}`)
  }
  return data
}

export async function testDashscopeModels(baseUrl, apiKey) {
  const normalizedBase = trimSlash(baseUrl)
  if (!normalizedBase) throw new Error('baseUrl 未配置')
  if (!apiKey) throw new Error('apiKey 未配置')
  const url = `${normalizedBase}/models`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    cache: 'no-store'
  })
  const { data, rawText } = await parsePayload(res)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${pickErrorText(data, rawText, res.status)}`)
  }
  const list = Array.isArray(data?.data) ? data.data : []
  const modelIds = list.map(item => String(item?.id || '')).filter(Boolean)
  return {
    models: modelIds,
    count: modelIds.length,
    preview: safePreviewList(modelIds, 5)
  }
}
