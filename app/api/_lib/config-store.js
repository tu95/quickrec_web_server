import { promises as fs } from 'fs'
import { join } from 'path'

const CONFIG_PATH = join(process.cwd(), 'config.json')

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function nowId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const DEFAULT_CONFIG = {
  access: {
    sitePassword: 'H*ZM7VwhhepPVhwP*HmC83LzWXn9o8'
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
    outputFormat: 'markdown'
  }
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
      sitePassword: String(data?.access?.sitePassword || data?.access?.settingsPageKey || DEFAULT_CONFIG.access.sitePassword)
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
      outputFormat: String(data?.meeting?.outputFormat || DEFAULT_CONFIG.meeting.outputFormat)
    }
  }
}

export async function ensureConfigFile() {
  try {
    await fs.access(CONFIG_PATH)
  } catch {
    const text = `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`
    await fs.writeFile(CONFIG_PATH, text, 'utf8')
  }
}

export async function readConfig() {
  await ensureConfigFile()
  const text = await fs.readFile(CONFIG_PATH, 'utf8')
  const parsed = JSON.parse(text)
  return normalizeConfig(parsed)
}

export async function writeConfig(inputConfig) {
  const nextConfig = normalizeConfig(inputConfig)
  const text = `${JSON.stringify(nextConfig, null, 2)}\n`
  await fs.writeFile(CONFIG_PATH, text, 'utf8')
  return nextConfig
}
