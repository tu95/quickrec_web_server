function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

export function normalizeOpenAiBaseUrl(baseUrl) {
  const base = trimSlash(baseUrl)
  if (!base) return ''
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function resolveModelsEndpoint(baseUrl) {
  return `${normalizeOpenAiBaseUrl(baseUrl)}/models`
}

function resolveChatEndpoint(baseUrl) {
  return `${normalizeOpenAiBaseUrl(baseUrl)}/chat/completions`
}

async function parseResponsePayload(response) {
  const text = await response.text().catch(() => '')
  if (!text) return { rawText: '', data: null }
  try {
    return {
      rawText: text,
      data: JSON.parse(text)
    }
  } catch {
    return {
      rawText: text,
      data: null
    }
  }
}

export async function fetchModels(provider) {
  const baseUrl = normalizeOpenAiBaseUrl(provider?.baseUrl)
  const apiKey = String(provider?.apiKey || '')
  if (!baseUrl || !apiKey) {
    throw new Error('模型列表拉取失败：baseUrl 或 apiKey 未配置')
  }

  const res = await fetch(resolveModelsEndpoint(baseUrl), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    cache: 'no-store'
  })

  const { data, rawText } = await parseResponsePayload(res)
  if (!res.ok) {
    const errorText = data?.error?.message || data?.message || rawText || `HTTP ${res.status}`
    throw new Error(`模型列表拉取失败 (HTTP ${res.status}): ${errorText}`)
  }

  const list = Array.isArray(data?.data) ? data.data : []
  return list
    .map(item => ({
      id: String(item?.id || ''),
      ownedBy: String(item?.owned_by || '')
    }))
    .filter(item => !!item.id)
}

export async function runChat(provider, options) {
  const baseUrl = normalizeOpenAiBaseUrl(provider?.baseUrl)
  const apiKey = String(provider?.apiKey || '')
  const model = String(options?.model || provider?.selectedModel || '')
  const messages = Array.isArray(options?.messages) ? options.messages : []
  const temperature = typeof options?.temperature === 'number' ? options.temperature : 0.2
  const maxTokens = typeof options?.maxTokens === 'number' ? options.maxTokens : 1200

  if (!baseUrl || !apiKey || !model) {
    throw new Error('LLM 调用失败：baseUrl / apiKey / model 缺失')
  }
  if (messages.length === 0) {
    throw new Error('LLM 调用失败：messages 不能为空')
  }

  const res = await fetch(resolveChatEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    })
  })

  const { data, rawText } = await parseResponsePayload(res)
  if (!res.ok) {
    const errorText = data?.error?.message || data?.message || rawText || `HTTP ${res.status}`
    throw new Error(`LLM 调用失败 (HTTP ${res.status}): ${errorText}`)
  }

  const content = data?.choices?.[0]?.message?.content
  return {
    text: String(content || '').trim(),
    usage: data?.usage || null,
    raw: data
  }
}
