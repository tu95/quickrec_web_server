import {
  createSupabaseServiceClient,
  getSupabaseServiceConfigError
} from './supabase-client'

const USER_CONFIG_TABLE = 'recorder_user_configs'
const MISSING_USER_CONFIG_TABLE_ERROR = '缺少 recorder_user_configs 表，请先在 Supabase 执行 web_server/supabase/schema.sql'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
}

function nowId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeUserId(raw) {
  return String(raw || '').trim()
}

function firstRow(data) {
  if (Array.isArray(data) && data.length > 0) return data[0]
  return null
}

function parseStoredUserConfig(rawValue) {
  if (!rawValue) return null
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue
  }
  return null
}

function isMissingUserConfigTableError(error) {
  const code = String(error?.code || '').toUpperCase()
  if (code === 'PGRST205') return true
  const text = String(error?.message || error || '').toLowerCase()
  return text.includes('recorder_user_configs') && text.includes('could not find the table')
}

function wrapUserConfigTableError(error, actionText) {
  if (isMissingUserConfigTableError(error)) {
    throw new Error(MISSING_USER_CONFIG_TABLE_ERROR)
  }
  throw new Error(`${actionText}: ${String(error?.message || error)}`)
}

export const DEFAULT_CONFIG = {
  access: {
    sitePassword: 'H*ZM7VwhhepPVhwP*HmC83LzWXn9o8',
    readonlySitePassword: 'test20260226'
  },
  llm: {
    providers: [
      {
        id: 'provider_default',
        name: 'SiliconFlow',
        type: 'openai_compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        enabled: true,
        selectedModel: ''
      }
    ],
    defaultProviderId: 'provider_default',
    defaultModel: ''
  },
  prompts: {
    defaultPromptId: 'prompt_default',
    items: [
      {
        id: 'prompt_default',
        name: '通用会议纪要',
        enabled: true,
        content: '请根据转写内容先判断是“会议场景”还是“口头记录场景”，再输出对应的结构化中文 Markdown。转写内容如下：\n{{transcript}}'
      }
    ]
  },
  aliyun: {
    oss: {
      provider: 'aliyun_oss',
      endpoint: '',
      region: '',
      bucket: '',
      accessKeyId: '',
      accessKeySecret: '',
      publicBaseUrl: '',
      objectPrefix: 'recordings',
      asrSignedUrlExpiresSec: 21600
    },
    asr: {
      provider: 'aliyun_dashscope_asr',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      submitPath: '/services/audio/asr/transcription',
      queryPathTemplate: '/tasks/{task_id}',
      apiKey: '',
      model: 'fun-asr',
      testFileUrl: 'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav',
      languageHints: ['zh'],
      diarizationEnabled: true,
      speakerCount: null,
      pollingIntervalMs: 3000,
      pollingTimeoutMs: 300000,
      requestExtraParams: {}
    }
  },
  meeting: {
    maxTranscriptChars: 120000,
    outputLanguage: 'zh-CN',
    outputFormat: 'markdown',
    autoGenerateOnMp3Upload: false
  }
}

function maskSecret(raw) {
  const value = String(raw || '')
  if (!value) return ''
  if (value.length <= 12) {
    const headLen = Math.min(3, Math.max(1, Math.floor(value.length / 2)))
    const tailLen = Math.min(3, Math.max(1, value.length - headLen))
    const head = value.slice(0, headLen)
    const tail = value.slice(-tailLen)
    return `${head}${'*'.repeat(6)}${tail}`
  }
  const head = value.slice(0, 6)
  const tail = value.slice(-6)
  return `${head}${'*'.repeat(Math.max(6, value.length - 12))}${tail}`
}

function isMaskedEquivalent(inputValue, plainValue) {
  const input = String(inputValue || '')
  const plain = String(plainValue || '')
  if (!input || !plain) return false
  return input === maskSecret(plain)
}

function normalizeProvider(input) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    id: String(source.id || nowId('provider')),
    name: String(source.name || '未命名提供商'),
    type: String(source.type || 'openai_compatible'),
    baseUrl: String(source.baseUrl || '').trim(),
    apiKey: String(source.apiKey || '').trim(),
    enabled: source.enabled !== false,
    selectedModel: String(source.selectedModel || '').trim()
  }
}

function normalizePrompt(input) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    id: String(source.id || nowId('prompt')),
    name: String(source.name || '未命名提示词'),
    enabled: source.enabled !== false,
    content: String(source.content || '').trim()
  }
}

function normalizeLanguageHints(input) {
  if (Array.isArray(input)) {
    return input
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }
  return ['zh']
}

function normalizeSpeakerCount(input) {
  if (input == null || input === '') return null
  const value = Number(input)
  if (!Number.isInteger(value)) return null
  if (value < 2 || value > 100) return null
  return value
}

function normalizeSignedUrlExpiresSec(input) {
  const value = Number(input)
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.aliyun.oss.asrSignedUrlExpiresSec
  const rounded = Math.floor(value)
  if (rounded < 60) return 60
  if (rounded > 172800) return 172800
  return rounded
}

function normalizeConfig(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}

  const providers = Array.isArray(data?.llm?.providers) && data.llm.providers.length > 0
    ? data.llm.providers.map(normalizeProvider)
    : cloneJson(DEFAULT_CONFIG.llm.providers)

  const prompts = Array.isArray(data?.prompts?.items) && data.prompts.items.length > 0
    ? data.prompts.items.map(normalizePrompt)
    : cloneJson(DEFAULT_CONFIG.prompts.items)

  const defaultProviderId = String(data?.llm?.defaultProviderId || providers[0].id)
  const defaultPromptId = String(data?.prompts?.defaultPromptId || prompts[0].id)
  const hasAsrDiarizationFlag = data?.aliyun?.asr?.diarizationEnabled != null
  const diarizationEnabled = hasAsrDiarizationFlag
    ? data.aliyun.asr.diarizationEnabled !== false
    : (
      data?.aliyun?.diarization?.enabled != null
        ? data.aliyun.diarization.enabled !== false
        : DEFAULT_CONFIG.aliyun.asr.diarizationEnabled !== false
    )

  return {
    access: {
      sitePassword: String(data?.access?.sitePassword || data?.access?.settingsPageKey || DEFAULT_CONFIG.access.sitePassword),
      readonlySitePassword: String(data?.access?.readonlySitePassword || DEFAULT_CONFIG.access.readonlySitePassword)
    },
    llm: {
      providers,
      defaultProviderId,
      defaultModel: String(data?.llm?.defaultModel || '')
    },
    prompts: {
      defaultPromptId,
      items: prompts
    },
    aliyun: {
      oss: {
        provider: String(data?.aliyun?.oss?.provider || DEFAULT_CONFIG.aliyun.oss.provider).trim(),
        endpoint: String(data?.aliyun?.oss?.endpoint || '').trim(),
        region: String(data?.aliyun?.oss?.region || '').trim(),
        bucket: String(data?.aliyun?.oss?.bucket || '').trim(),
        accessKeyId: String(data?.aliyun?.oss?.accessKeyId || '').trim(),
        accessKeySecret: String(data?.aliyun?.oss?.accessKeySecret || '').trim(),
        publicBaseUrl: String(data?.aliyun?.oss?.publicBaseUrl || '').trim(),
        objectPrefix: String(data?.aliyun?.oss?.objectPrefix || DEFAULT_CONFIG.aliyun.oss.objectPrefix).trim(),
        asrSignedUrlExpiresSec: normalizeSignedUrlExpiresSec(data?.aliyun?.oss?.asrSignedUrlExpiresSec)
      },
      asr: {
        provider: String(data?.aliyun?.asr?.provider || DEFAULT_CONFIG.aliyun.asr.provider).trim(),
        baseUrl: String(data?.aliyun?.asr?.baseUrl || DEFAULT_CONFIG.aliyun.asr.baseUrl).trim(),
        submitPath: String(data?.aliyun?.asr?.submitPath || DEFAULT_CONFIG.aliyun.asr.submitPath).trim(),
        queryPathTemplate: String(data?.aliyun?.asr?.queryPathTemplate || DEFAULT_CONFIG.aliyun.asr.queryPathTemplate).trim(),
        apiKey: String(data?.aliyun?.asr?.apiKey || '').trim(),
        model: String(data?.aliyun?.asr?.model || DEFAULT_CONFIG.aliyun.asr.model).trim(),
        testFileUrl: String(data?.aliyun?.asr?.testFileUrl || DEFAULT_CONFIG.aliyun.asr.testFileUrl).trim(),
        languageHints: normalizeLanguageHints(data?.aliyun?.asr?.languageHints),
        diarizationEnabled,
        speakerCount: normalizeSpeakerCount(data?.aliyun?.asr?.speakerCount),
        pollingIntervalMs: Number(data?.aliyun?.asr?.pollingIntervalMs || DEFAULT_CONFIG.aliyun.asr.pollingIntervalMs),
        pollingTimeoutMs: Number(data?.aliyun?.asr?.pollingTimeoutMs || DEFAULT_CONFIG.aliyun.asr.pollingTimeoutMs),
        requestExtraParams: data?.aliyun?.asr?.requestExtraParams && typeof data.aliyun.asr.requestExtraParams === 'object'
          ? data.aliyun.asr.requestExtraParams
          : {}
      }
    },
    meeting: {
      maxTranscriptChars: Number(data?.meeting?.maxTranscriptChars || DEFAULT_CONFIG.meeting.maxTranscriptChars),
      outputLanguage: String(data?.meeting?.outputLanguage || DEFAULT_CONFIG.meeting.outputLanguage),
      outputFormat: String(data?.meeting?.outputFormat || DEFAULT_CONFIG.meeting.outputFormat),
      autoGenerateOnMp3Upload: data?.meeting?.autoGenerateOnMp3Upload === true
    }
  }
}

export async function readConfig() {
  return normalizeConfig(DEFAULT_CONFIG)
}

export async function readConfigForUser(userId) {
  const baseConfig = normalizeConfig(DEFAULT_CONFIG)
  const uid = normalizeUserId(userId)
  if (!uid) {
    return baseConfig
  }

  const configError = getSupabaseServiceConfigError()
  if (configError) {
    throw new Error(`${configError}（无法读取用户配置）`)
  }

  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(USER_CONFIG_TABLE)
    .select('config_json')
    .eq('user_id', uid)
    .limit(1)

  if (error) {
    wrapUserConfigTableError(error, '读取用户配置失败')
  }

  const row = firstRow(data)
  const userConfig = parseStoredUserConfig(row?.config_json)
  if (!userConfig) {
    const now = nowIso()
    const { data: insertedData, error: insertError } = await client
      .from(USER_CONFIG_TABLE)
      .upsert(
        {
          user_id: uid,
          config_json: baseConfig,
          updated_at: now
        },
        { onConflict: 'user_id' }
      )
      .select('config_json')
      .limit(1)
    if (insertError) {
      wrapUserConfigTableError(insertError, '初始化用户配置失败')
    }
    const inserted = parseStoredUserConfig(firstRow(insertedData)?.config_json)
    return normalizeConfig(inserted || baseConfig)
  }
  return mergeConfigWithSecretPreserve(baseConfig, userConfig)
}

export function sanitizeConfigForClient(inputConfig) {
  const config = normalizeConfig(inputConfig)
  const out = cloneJson(config)

  out.access.sitePassword = maskSecret(config.access.sitePassword)
  out.access.readonlySitePassword = maskSecret(config.access.readonlySitePassword)
  out.aliyun.oss.accessKeyId = maskSecret(config.aliyun.oss.accessKeyId)
  out.aliyun.oss.accessKeySecret = maskSecret(config.aliyun.oss.accessKeySecret)
  out.aliyun.asr.apiKey = maskSecret(config.aliyun.asr.apiKey)
  out.llm.providers = config.llm.providers.map(provider => ({
    ...provider,
    apiKey: maskSecret(provider.apiKey)
  }))

  return out
}

function mergeProviderSecrets(currentProviders, incomingProviders) {
  const currentList = Array.isArray(currentProviders) ? currentProviders : []
  const incomingList = Array.isArray(incomingProviders) ? incomingProviders : []
  const byId = new Map()
  for (const item of currentList) {
    byId.set(String(item?.id || ''), item)
  }

  return incomingList.map((incomingProvider, index) => {
    const next = incomingProvider && typeof incomingProvider === 'object'
      ? { ...incomingProvider }
      : {}
    const currentById = byId.get(String(next.id || ''))
    const currentByIndex = currentList[index]
    const currentProvider = currentById || currentByIndex || null
    const currentApiKey = String(currentProvider?.apiKey || '')
    const hasIncomingApiKey = hasOwn(next, 'apiKey')
    const incomingApiKey = String(next.apiKey || '')

    if (!hasIncomingApiKey || isMaskedEquivalent(incomingApiKey, currentApiKey)) {
      next.apiKey = currentApiKey
    }

    return next
  })
}

export function mergeConfigWithSecretPreserve(currentConfig, incomingConfig) {
  const current = normalizeConfig(currentConfig)
  const incoming = incomingConfig && typeof incomingConfig === 'object' ? incomingConfig : {}

  const merged = {
    ...current,
    ...incoming,
    access: {
      ...current.access,
      ...(incoming.access && typeof incoming.access === 'object' ? incoming.access : {})
    },
    llm: {
      ...current.llm,
      ...(incoming.llm && typeof incoming.llm === 'object' ? incoming.llm : {})
    },
    prompts: {
      ...current.prompts,
      ...(incoming.prompts && typeof incoming.prompts === 'object' ? incoming.prompts : {})
    },
    aliyun: {
      ...current.aliyun,
      ...(incoming.aliyun && typeof incoming.aliyun === 'object' ? incoming.aliyun : {}),
      oss: {
        ...current.aliyun.oss,
        ...(incoming?.aliyun?.oss && typeof incoming.aliyun.oss === 'object' ? incoming.aliyun.oss : {})
      },
      asr: {
        ...current.aliyun.asr,
        ...(incoming?.aliyun?.asr && typeof incoming.aliyun.asr === 'object' ? incoming.aliyun.asr : {})
      }
    },
    meeting: {
      ...current.meeting,
      ...(incoming.meeting && typeof incoming.meeting === 'object' ? incoming.meeting : {})
    }
  }

  const hasSitePassword = hasOwn(incoming?.access, 'sitePassword')
  if (!hasSitePassword || isMaskedEquivalent(merged.access.sitePassword, current.access.sitePassword)) {
    merged.access.sitePassword = current.access.sitePassword
  }
  const hasReadonlySitePassword = hasOwn(incoming?.access, 'readonlySitePassword')
  if (!hasReadonlySitePassword || isMaskedEquivalent(merged.access.readonlySitePassword, current.access.readonlySitePassword)) {
    merged.access.readonlySitePassword = current.access.readonlySitePassword
  }

  const hasAccessKeyId = hasOwn(incoming?.aliyun?.oss, 'accessKeyId')
  if (!hasAccessKeyId || isMaskedEquivalent(merged.aliyun.oss.accessKeyId, current.aliyun.oss.accessKeyId)) {
    merged.aliyun.oss.accessKeyId = current.aliyun.oss.accessKeyId
  }

  const hasAccessKeySecret = hasOwn(incoming?.aliyun?.oss, 'accessKeySecret')
  if (!hasAccessKeySecret || isMaskedEquivalent(merged.aliyun.oss.accessKeySecret, current.aliyun.oss.accessKeySecret)) {
    merged.aliyun.oss.accessKeySecret = current.aliyun.oss.accessKeySecret
  }

  const hasAsrApiKey = hasOwn(incoming?.aliyun?.asr, 'apiKey')
  if (!hasAsrApiKey || isMaskedEquivalent(merged.aliyun.asr.apiKey, current.aliyun.asr.apiKey)) {
    merged.aliyun.asr.apiKey = current.aliyun.asr.apiKey
  }

  const hasProviders = Array.isArray(incoming?.llm?.providers)
  if (hasProviders) {
    merged.llm.providers = mergeProviderSecrets(current.llm.providers, incoming.llm.providers)
  } else {
    merged.llm.providers = current.llm.providers
  }

  return normalizeConfig(merged)
}

export async function writeConfig(inputConfig) {
  throw new Error('writeConfig 已停用，请使用 writeConfigForUser 保存到 Supabase')
}

export async function writeConfigForUser(userId, inputConfig) {
  const uid = normalizeUserId(userId)
  if (!uid) {
    throw new Error('用户信息为空，无法保存配置')
  }
  const configError = getSupabaseServiceConfigError()
  if (configError) {
    throw new Error(`${configError}（无法保存用户配置）`)
  }
  const nextConfig = normalizeConfig(inputConfig)
  const now = nowIso()
  const client = createSupabaseServiceClient()
  const { data, error } = await client
    .from(USER_CONFIG_TABLE)
    .upsert(
      {
        user_id: uid,
        config_json: nextConfig,
        updated_at: now
      },
      { onConflict: 'user_id' }
    )
    .select('config_json')
    .limit(1)

  if (error) {
    wrapUserConfigTableError(error, '保存用户配置失败')
  }

  const row = firstRow(data)
  const stored = parseStoredUserConfig(row?.config_json)
  return normalizeConfig(stored || nextConfig)
}
