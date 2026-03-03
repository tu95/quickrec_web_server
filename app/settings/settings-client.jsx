'use client'

import { useEffect, useMemo, useState } from 'react'
import { validateOssConfig } from '../../lib/aliyun-validators'

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildDefaultProvider() {
  return {
    id: makeId('provider'),
    name: '新提供商',
    type: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    selectedModel: ''
  }
}

function buildDefaultPrompt() {
  return {
    id: makeId('prompt'),
    name: '新Prompt',
    enabled: true,
    content: '请基于转写内容输出结构化会议纪要。\n\n{{transcript}}'
  }
}

const OSS_FIELD_KEYS = [
  'provider',
  'endpoint',
  'region',
  'bucket',
  'accessKeyId',
  'accessKeySecret',
  'publicBaseUrl',
  'objectPrefix'
]

function buildSecretDirtyState(config) {
  const providerApiKeys = {}
  const providers = Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  for (const provider of providers) {
    providerApiKeys[String(provider?.id || '')] = false
  }
  return {
    sitePassword: false,
    asrApiKey: false,
    ossAccessKeyId: false,
    ossAccessKeySecret: false,
    providerApiKeys
  }
}

export default function SettingsClient() {
  const [config, setConfig] = useState(null)
  const [readOnly, setReadOnly] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saveBusy, setSaveBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [modelsMap, setModelsMap] = useState({})
  const [modelsBusyMap, setModelsBusyMap] = useState({})
  const [testBusyMap, setTestBusyMap] = useState({})
  const [providerResultMap, setProviderResultMap] = useState({})
  const [providerCopyResultMap, setProviderCopyResultMap] = useState({})
  const [copyDoneMap, setCopyDoneMap] = useState({})
  const [copyPressedMap, setCopyPressedMap] = useState({})
  const [aliyunTestBusyMap, setAliyunTestBusyMap] = useState({})
  const [aliyunTestResultMap, setAliyunTestResultMap] = useState({})
  const [ossFieldErrors, setOssFieldErrors] = useState({})
  const [ossTouchedMap, setOssTouchedMap] = useState({})
  const [languageHintsText, setLanguageHintsText] = useState('zh')
  const [asrExtraText, setAsrExtraText] = useState('{}')
  const [secretDirty, setSecretDirty] = useState(() => buildSecretDirtyState(null))

  useEffect(() => {
    loadConfig().catch(() => {})
  }, [])

  const providerList = useMemo(() => {
    return Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  }, [config])

  const promptList = useMemo(() => {
    return Array.isArray(config?.prompts?.items) ? config.prompts.items : []
  }, [config])

  async function loadConfig() {
    setLoadingConfig(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/config', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data?.config) {
        if (res.status === 401 && typeof window !== 'undefined') {
          window.location.href = '/login?next=/settings'
          return
        }
        if (res.status === 503) {
          throw new Error(data?.error || '认证服务连接失败，请稍后重试')
        }
        throw new Error(data?.error || `加载配置失败: HTTP ${res.status}`)
      }
      setConfig(data.config)
      setReadOnly(data?.readOnly === true)
      setOssFieldErrors({})
      setOssTouchedMap({})
      setLanguageHintsText((data.config?.aliyun?.asr?.languageHints || ['zh']).join(', '))
      setAsrExtraText(JSON.stringify(data.config?.aliyun?.asr?.requestExtraParams || {}, null, 2))
      setSecretDirty(buildSecretDirtyState(data.config))
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoadingConfig(false)
    }
  }

  function patchConfig(patchFn) {
    setConfig(prev => {
      if (!prev) return prev
      return patchFn(prev)
    })
  }

  function markSecretDirty(fieldKey) {
    setSecretDirty(prev => ({ ...prev, [fieldKey]: true }))
  }

  function markProviderApiKeyDirty(providerId) {
    const id = String(providerId || '')
    setSecretDirty(prev => ({
      ...prev,
      providerApiKeys: {
        ...prev.providerApiKeys,
        [id]: true
      }
    }))
  }

  function updateAliyunSection(sectionKey, patch) {
    patchConfig(prev => ({
      ...prev,
      aliyun: {
        ...prev.aliyun,
        [sectionKey]: {
          ...prev.aliyun[sectionKey],
          ...patch
        }
      }
    }))
  }

  function buildAllOssTouched() {
    const map = {}
    for (const key of OSS_FIELD_KEYS) {
      map[key] = true
    }
    return map
  }

  function markOssFieldTouched(field) {
    setOssTouchedMap(prev => ({ ...prev, [field]: true }))
  }

  function validateCurrentOss(nextOss, touchAll = false) {
    const validation = validateOssConfig(nextOss || {})
    setOssFieldErrors(validation.errors)
    if (touchAll) {
      setOssTouchedMap(buildAllOssTouched())
    }
    return validation
  }

  function updateOssField(field, value) {
    if (!config) return
    markOssFieldTouched(field)
    const nextOss = {
      ...(config.aliyun?.oss || {}),
      [field]: value
    }
    validateCurrentOss(nextOss, false)
    updateAliyunSection('oss', { [field]: value })
  }

  function getFieldInputStyle(field) {
    if (ossTouchedMap[field] && ossFieldErrors[field]) {
      return { ...inputStyle, ...inputErrorStyle }
    }
    return inputStyle
  }

  function renderFieldError(field) {
    if (!ossTouchedMap[field] || !ossFieldErrors[field]) return null
    return <div style={fieldErrorStyle}>{ossFieldErrors[field]}</div>
  }

  function updateProvider(providerId, patch) {
    patchConfig(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: prev.llm.providers.map(item => (
          item.id === providerId ? { ...item, ...patch } : item
        ))
      }
    }))
  }

  function removeProvider(providerId) {
    patchConfig(prev => {
      const nextProviders = prev.llm.providers.filter(item => item.id !== providerId)
      const nextDefaultProviderId = prev.llm.defaultProviderId === providerId
        ? (nextProviders[0]?.id || '')
        : prev.llm.defaultProviderId
      return {
        ...prev,
        llm: {
          ...prev.llm,
          providers: nextProviders,
          defaultProviderId: nextDefaultProviderId
        }
      }
    })
    setSecretDirty(prev => {
      const nextMap = { ...prev.providerApiKeys }
      delete nextMap[String(providerId || '')]
      return { ...prev, providerApiKeys: nextMap }
    })
  }

  function addProvider() {
    const newProvider = buildDefaultProvider()
    patchConfig(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: [...prev.llm.providers, newProvider]
      }
    }))
    setSecretDirty(prev => ({
      ...prev,
      providerApiKeys: {
        ...prev.providerApiKeys,
        [String(newProvider.id || '')]: false
      }
    }))
  }

  function updatePrompt(promptId, patch) {
    patchConfig(prev => ({
      ...prev,
      prompts: {
        ...prev.prompts,
        items: prev.prompts.items.map(item => (
          item.id === promptId ? { ...item, ...patch } : item
        ))
      }
    }))
  }

  function removePrompt(promptId) {
    patchConfig(prev => {
      const nextItems = prev.prompts.items.filter(item => item.id !== promptId)
      const nextDefaultPromptId = prev.prompts.defaultPromptId === promptId
        ? (nextItems[0]?.id || '')
        : prev.prompts.defaultPromptId
      return {
        ...prev,
        prompts: {
          ...prev.prompts,
          items: nextItems,
          defaultPromptId: nextDefaultPromptId
        }
      }
    })
  }

  function addPrompt() {
    patchConfig(prev => ({
      ...prev,
      prompts: {
        ...prev.prompts,
        items: [...prev.prompts.items, buildDefaultPrompt()]
      }
    }))
  }

  async function fetchProviderModels(providerId) {
    setModelsBusyMap(prev => ({ ...prev, [providerId]: true }))
    setError('')
    try {
      const res = await fetch('/api/admin/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `模型拉取失败: HTTP ${res.status}`)
      }
      const modelIds = (data.models || []).map(item => item.id).filter(Boolean)
      setModelsMap(prev => ({ ...prev, [providerId]: modelIds }))
      if (modelIds.length > 0) {
        const current = providerList.find(item => item.id === providerId)
        if (current && !current.selectedModel) {
          updateProvider(providerId, { selectedModel: modelIds[0] })
        }
      }
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'success',
          text: `已拉取 ${modelIds.length} 个模型`
        }
      }))
    } catch (err) {
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'error',
          text: String(err?.message || err)
        }
      }))
    } finally {
      setModelsBusyMap(prev => ({ ...prev, [providerId]: false }))
    }
  }

  async function testProvider(providerId) {
    const provider = providerList.find(item => item.id === providerId)
    if (!provider) return
    setTestBusyMap(prev => ({ ...prev, [providerId]: true }))
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/admin/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          model: provider.selectedModel
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `连通性测试失败: HTTP ${res.status}`)
      }
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'success',
          text: `测试成功: ${String(data.text || '').slice(0, 120)}`
        }
      }))
    } catch (err) {
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'error',
          text: String(err?.message || err)
        }
      }))
    } finally {
      setTestBusyMap(prev => ({ ...prev, [providerId]: false }))
    }
  }

  async function copyText(providerId, text) {
    const value = String(text || '').trim()
    if (!value) {
      setCopyDoneMap(prev => ({ ...prev, [providerId]: false }))
      setProviderCopyResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'error',
          text: '没有可复制的模型名'
        }
      }))
      return
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('当前浏览器不支持剪贴板 API')
      }
      await navigator.clipboard.writeText(value)
      setCopyDoneMap(prev => ({ ...prev, [providerId]: true }))
      setProviderCopyResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'success',
          text: `已复制模型名: ${value}`
        }
      }))
      window.setTimeout(() => {
        setCopyDoneMap(prev => ({ ...prev, [providerId]: false }))
      }, 1200)
    } catch (err) {
      setCopyDoneMap(prev => ({ ...prev, [providerId]: false }))
      setProviderCopyResultMap(prev => ({
        ...prev,
        [providerId]: {
          type: 'error',
          text: String(err?.message || err)
        }
      }))
    }
  }

  async function testAliyunService(serviceKey) {
    if (!config) return
    const endpointMap = {
      oss: '/api/admin/aliyun/oss/test',
      asr: '/api/admin/aliyun/asr/test'
    }
    const endpoint = endpointMap[serviceKey]
    if (!endpoint) return

    let aliyunPayload = config.aliyun
    if (serviceKey === 'oss') {
      aliyunPayload = {
        ...config.aliyun,
        oss: {
          ...(config.aliyun?.oss || {})
        }
      }
      if (!secretDirty.ossAccessKeyId) {
        delete aliyunPayload.oss.accessKeyId
      }
      if (!secretDirty.ossAccessKeySecret) {
        delete aliyunPayload.oss.accessKeySecret
      }
    }
    if (serviceKey === 'asr') {
      let parsedAsrExtra = {}
      try {
        parsedAsrExtra = JSON.parse(asrExtraText || '{}')
      } catch {
        setAliyunTestResultMap(prev => ({
          ...prev,
          [serviceKey]: {
            type: 'error',
            text: 'ASR requestExtraParams 不是合法 JSON'
          }
        }))
        return
      }
      const diarizationEnabled = config?.aliyun?.asr?.diarizationEnabled !== false
      aliyunPayload = {
        ...config.aliyun,
        asr: {
          ...config.aliyun.asr,
          languageHints: languageHintsText
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
          diarizationEnabled,
          requestExtraParams: parsedAsrExtra
        }
      }
      if (!secretDirty.asrApiKey) {
        delete aliyunPayload.asr.apiKey
      }
    }

    setAliyunTestBusyMap(prev => ({ ...prev, [serviceKey]: true }))
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliyun: aliyunPayload })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (serviceKey === 'oss' && data?.fields && typeof data.fields === 'object') {
          setOssFieldErrors(data.fields)
          setOssTouchedMap(buildAllOssTouched())
        }
        throw new Error(data?.error || `测试失败: HTTP ${res.status}`)
      }
      setAliyunTestResultMap(prev => ({
        ...prev,
        [serviceKey]: {
          type: 'success',
          text: String(data?.message || '测试成功')
        }
      }))
    } catch (err) {
      setAliyunTestResultMap(prev => ({
        ...prev,
        [serviceKey]: {
          type: 'error',
          text: String(err?.message || err)
        }
      }))
    } finally {
      setAliyunTestBusyMap(prev => ({ ...prev, [serviceKey]: false }))
    }
  }

  async function saveConfig() {
    if (!config || readOnly) return
    setSaveBusy(true)
    setError('')
    setMessage('')
    try {
      const parsedAsrExtra = JSON.parse(asrExtraText || '{}')
      const diarizationEnabled = config?.aliyun?.asr?.diarizationEnabled !== false
      const nextConfig = {
        ...config,
        aliyun: {
          ...config.aliyun,
          oss: {
            ...config.aliyun.oss
          },
          asr: {
            ...config.aliyun.asr,
            languageHints: languageHintsText
              .split(',')
              .map(item => item.trim())
              .filter(Boolean),
            diarizationEnabled,
            requestExtraParams: parsedAsrExtra
          }
        }
      }
      const payloadConfig = JSON.parse(JSON.stringify(nextConfig))
      if (payloadConfig.access && !secretDirty.sitePassword) {
        delete payloadConfig.access.sitePassword
      }
      if (payloadConfig.aliyun?.asr && !secretDirty.asrApiKey) {
        delete payloadConfig.aliyun.asr.apiKey
      }
      if (payloadConfig.aliyun?.oss && !secretDirty.ossAccessKeyId) {
        delete payloadConfig.aliyun.oss.accessKeyId
      }
      if (payloadConfig.aliyun?.oss && !secretDirty.ossAccessKeySecret) {
        delete payloadConfig.aliyun.oss.accessKeySecret
      }
      if (Array.isArray(payloadConfig?.llm?.providers)) {
        payloadConfig.llm.providers = payloadConfig.llm.providers.map(provider => {
          const id = String(provider?.id || '')
          if (secretDirty.providerApiKeys[id]) return provider
          const nextProvider = { ...provider }
          delete nextProvider.apiKey
          return nextProvider
        })
      }
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payloadConfig })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data?.config) {
        if (data?.fields && typeof data.fields === 'object') {
          setOssFieldErrors(data.fields)
          setOssTouchedMap(buildAllOssTouched())
        }
        throw new Error(data?.error || `保存失败: HTTP ${res.status}`)
      }
      setConfig(data.config)
      setSecretDirty(buildSecretDirtyState(data.config))
      setMessage('配置已保存')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setSaveBusy(false)
    }
  }

  if (loadingConfig) {
    return <div style={loadingStyle}>加载配置中...</div>
  }

  if (!config) {
    return <div style={errorStyle}>{error || '配置加载失败'}</div>
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={topBarStyle}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={primaryBtnStyle} onClick={saveConfig} disabled={saveBusy || readOnly}>
            {saveBusy ? '保存中...' : '保存全部配置'}
          </button>
        </div>
        <a href="/" style={linkStyle}>返回文件控制台</a>
      </div>

      {message && <div style={okStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {readOnly && <div style={readonlyBannerStyle}>当前使用只读密钥登录，设置页仅可查看，无法修改。</div>}

      <div style={readOnly ? readonlyWrapStyle : undefined} aria-disabled={readOnly}>
      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>网站访问密码</h3>
        <p style={sectionHintStyle}>未登录时会统一跳转到 `/login`。修改后需使用新密码重新登录。</p>
        <label style={labelStyle}>sitePassword</label>
        <input
          type="text"
          value={config.access.sitePassword || ''}
          onChange={e => {
            markSecretDirty('sitePassword')
            patchConfig(prev => ({ ...prev, access: { ...prev.access, sitePassword: e.target.value } }))
          }}
          placeholder="输入网站访问密码"
          style={inputStyle}
        />
        <label style={labelStyle}>readonlySitePassword</label>
        <input
          type="text"
          value={config.access.readonlySitePassword || ''}
          onChange={e => {
            patchConfig(prev => ({ ...prev, access: { ...prev.access, readonlySitePassword: e.target.value } }))
          }}
          placeholder="只读访问密码"
          style={inputStyle}
        />
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>纪要自动化</h3>
        <p style={sectionHintStyle}>开启后，上传后产出的 MP3 会自动创建纪要任务（异步执行）。</p>
        <label style={checkLabelStyle}>
          <input
            type="checkbox"
            checked={config?.meeting?.autoGenerateOnMp3Upload === true}
            onChange={e => patchConfig(prev => ({
              ...prev,
              meeting: {
                ...prev.meeting,
                autoGenerateOnMp3Upload: e.target.checked
              }
            }))}
          />
          上传的 MP3 自动生成纪要
        </label>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>LLM 提供商与模型</h3>
            <p style={sectionHintStyle}>支持 OpenAI-compatible（SiliconFlow 可直接接入）。</p>
          </div>
          <button style={ghostBtnStyle} onClick={addProvider}>新增提供商</button>
        </div>

        <div style={fieldGridStyle}>
          <div>
            <label style={labelStyle}>默认 Provider</label>
            <select
              value={config.llm.defaultProviderId}
              onChange={e => patchConfig(prev => ({ ...prev, llm: { ...prev.llm, defaultProviderId: e.target.value } }))}
              style={inputStyle}
            >
              {providerList.map(item => (
                <option key={item.id} value={item.id}>{item.name} ({item.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>默认 Model（兜底）</label>
            <input
              value={config.llm.defaultModel || ''}
              onChange={e => patchConfig(prev => ({ ...prev, llm: { ...prev.llm, defaultModel: e.target.value } }))}
              placeholder="例如 deepseek-ai/DeepSeek-V3"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
          {providerList.map(provider => {
            const modelOptions = modelsMap[provider.id] || []
            const providerResult = providerResultMap[provider.id]
            const providerCopyResult = providerCopyResultMap[provider.id]
            return (
              <div key={provider.id} style={subCardStyle}>
                <div style={providerHeadStyle}>
                  <strong>{provider.name}</strong>
                  <button style={dangerBtnStyle} onClick={() => removeProvider(provider.id)}>删除</button>
                </div>
                <div style={fieldGridStyle}>
                  <div>
                    <label style={labelStyle}>ID</label>
                    <input value={provider.id} onChange={e => updateProvider(provider.id, { id: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>名称</label>
                    <input value={provider.name} onChange={e => updateProvider(provider.id, { name: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Base URL</label>
                    <input value={provider.baseUrl} onChange={e => updateProvider(provider.id, { baseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>API Key</label>
                    <input
                      value={provider.apiKey}
                      onChange={e => {
                        markProviderApiKeyDirty(provider.id)
                        updateProvider(provider.id, { apiKey: e.target.value })
                      }}
                      placeholder="sk-..."
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>模型</label>
                    <select
                      value={provider.selectedModel || ''}
                      onChange={e => updateProvider(provider.id, { selectedModel: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">请选择模型</option>
                      {modelOptions.map(modelId => (
                        <option key={modelId} value={modelId}>{modelId}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <label style={checkLabelStyle}>
                      <input
                        type="checkbox"
                        checked={provider.enabled !== false}
                        onChange={e => updateProvider(provider.id, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button style={ghostBtnStyle} onClick={() => fetchProviderModels(provider.id)} disabled={modelsBusyMap[provider.id]}>
                    {modelsBusyMap[provider.id] ? '拉取中...' : '获取模型列表'}
                  </button>
                  <button style={ghostBtnStyle} onClick={() => testProvider(provider.id)} disabled={testBusyMap[provider.id]}>
                    {testBusyMap[provider.id] ? '测试中...' : '测试模型连通性'}
                  </button>
                  <button
                    style={{
                      ...copyBtnStyle,
                      ...(copyPressedMap[provider.id] ? copyBtnPressedStyle : null),
                      ...(copyDoneMap[provider.id] ? copyBtnDoneStyle : null)
                    }}
                    disabled={!provider.selectedModel}
                    onMouseDown={() => setCopyPressedMap(prev => ({ ...prev, [provider.id]: true }))}
                    onMouseUp={() => setCopyPressedMap(prev => ({ ...prev, [provider.id]: false }))}
                    onMouseLeave={() => setCopyPressedMap(prev => ({ ...prev, [provider.id]: false }))}
                    onTouchStart={() => setCopyPressedMap(prev => ({ ...prev, [provider.id]: true }))}
                    onTouchEnd={() => setCopyPressedMap(prev => ({ ...prev, [provider.id]: false }))}
                    onClick={() => copyText(provider.id, provider.selectedModel)}
                  >
                    {copyDoneMap[provider.id] ? '已复制' : '复制当前模型'}
                  </button>
                </div>
                {providerResult && (
                  <div style={providerResult.type === 'success' ? inlineOkStyle : inlineErrorStyle}>
                    {providerResult.text}
                  </div>
                )}
                {providerCopyResult && (
                  <div style={providerCopyResult.type === 'success' ? inlineInfoStyle : inlineErrorStyle}>
                    {providerCopyResult.text}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>Prompt 管理</h3>
            <p style={sectionHintStyle}>支持多个纪要 Prompt，按默认或任务指定使用。</p>
          </div>
          <button style={ghostBtnStyle} onClick={addPrompt}>新增 Prompt</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {promptList.map(prompt => (
            <div key={prompt.id} style={subCardStyle}>
              <div style={providerHeadStyle}>
                <strong>{prompt.name}</strong>
                <button style={dangerBtnStyle} onClick={() => removePrompt(prompt.id)}>删除</button>
              </div>
              <div style={fieldGridStyle}>
                <div>
                  <label style={labelStyle}>ID</label>
                  <input value={prompt.id} onChange={e => updatePrompt(prompt.id, { id: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>名称</label>
                  <input value={prompt.name} onChange={e => updatePrompt(prompt.id, { name: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      checked={prompt.enabled !== false}
                      onChange={e => updatePrompt(prompt.id, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <label style={checkLabelStyle}>
                    <input
                      type="radio"
                      name="default-prompt"
                      checked={config.prompts.defaultPromptId === prompt.id}
                      onChange={() => patchConfig(prev => ({ ...prev, prompts: { ...prev.prompts, defaultPromptId: prompt.id } }))}
                    />
                    设为默认
                  </label>
                </div>
              </div>
              <label style={labelStyle}>Prompt 内容（支持 `&#123;&#123;transcript&#125;&#125;` 占位符）</label>
              <textarea
                value={prompt.content}
                onChange={e => updatePrompt(prompt.id, { content: e.target.value })}
                rows={8}
                style={textareaStyle}
              />
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>阿里云服务配置</h3>
        <p style={sectionHintStyle}>OSS / ASR 可独立配置并分别测试。说话人分离通过 ASR 的 diarization_enabled 参数控制。</p>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={subCardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <strong>OSS 对象存储</strong>
                <p style={sectionHintStyle}>用于录音文件公网 URL 与对象存储能力。</p>
              </div>
              <button
                style={ghostBtnStyle}
                onClick={() => testAliyunService('oss')}
                disabled={aliyunTestBusyMap.oss}
              >
                {aliyunTestBusyMap.oss ? '测试中...' : '测试 OSS AK'}
              </button>
            </div>
            <div style={fieldGridStyle}>
              <div>
                <label style={labelStyle}>Provider</label>
                <input
                  value={config.aliyun.oss.provider || ''}
                  onChange={e => updateOssField('provider', e.target.value)}
                  style={getFieldInputStyle('provider')}
                />
                {renderFieldError('provider')}
              </div>
              <div>
                <label style={labelStyle}>Endpoint</label>
                <input
                  value={config.aliyun.oss.endpoint || ''}
                  onChange={e => updateOssField('endpoint', e.target.value)}
                  placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                  style={getFieldInputStyle('endpoint')}
                />
                {renderFieldError('endpoint')}
              </div>
              <div>
                <label style={labelStyle}>Region</label>
                <input
                  value={config.aliyun.oss.region || ''}
                  onChange={e => updateOssField('region', e.target.value)}
                  placeholder="oss-cn-hangzhou"
                  style={getFieldInputStyle('region')}
                />
                {renderFieldError('region')}
              </div>
              <div>
                <label style={labelStyle}>Bucket</label>
                <input
                  value={config.aliyun.oss.bucket || ''}
                  onChange={e => updateOssField('bucket', e.target.value)}
                  style={getFieldInputStyle('bucket')}
                />
                {renderFieldError('bucket')}
              </div>
              <div>
                <label style={labelStyle}>AccessKeyId</label>
                <input
                  value={config.aliyun.oss.accessKeyId || ''}
                  onChange={e => {
                    markSecretDirty('ossAccessKeyId')
                    updateOssField('accessKeyId', e.target.value)
                  }}
                  style={getFieldInputStyle('accessKeyId')}
                />
                {renderFieldError('accessKeyId')}
              </div>
              <div>
                <label style={labelStyle}>AccessKeySecret</label>
                <input
                  value={config.aliyun.oss.accessKeySecret || ''}
                  onChange={e => {
                    markSecretDirty('ossAccessKeySecret')
                    updateOssField('accessKeySecret', e.target.value)
                  }}
                  style={getFieldInputStyle('accessKeySecret')}
                />
                {renderFieldError('accessKeySecret')}
              </div>
              <div>
                <label style={labelStyle}>OSS Public Base URL</label>
                <input
                  value={config.aliyun.oss.publicBaseUrl || ''}
                  onChange={e => updateOssField('publicBaseUrl', e.target.value)}
                  placeholder="https://your-bucket.oss-cn-hangzhou.aliyuncs.com"
                  style={getFieldInputStyle('publicBaseUrl')}
                />
                {renderFieldError('publicBaseUrl')}
              </div>
              <div>
                <label style={labelStyle}>OSS Object Prefix</label>
                <input
                  value={config.aliyun.oss.objectPrefix || ''}
                  onChange={e => updateOssField('objectPrefix', e.target.value)}
                  placeholder="recordings"
                  style={getFieldInputStyle('objectPrefix')}
                />
                {renderFieldError('objectPrefix')}
              </div>
            </div>
            {aliyunTestResultMap.oss && (
              <div style={aliyunTestResultMap.oss.type === 'success' ? inlineOkStyle : inlineErrorStyle}>
                {aliyunTestResultMap.oss.text}
              </div>
            )}
          </div>

          <div style={subCardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <strong>ASR 转写服务</strong>
                <p style={sectionHintStyle}>用于提交音频转写任务与轮询结果。</p>
              </div>
              <button
                style={ghostBtnStyle}
                onClick={() => testAliyunService('asr')}
                disabled={aliyunTestBusyMap.asr}
              >
                {aliyunTestBusyMap.asr ? '测试中...' : '测试 ASR AK'}
              </button>
            </div>
            <div style={fieldGridStyle}>
              <div>
                <label style={labelStyle}>Provider</label>
                <input
                  value={config.aliyun.asr.provider || ''}
                  onChange={e => updateAliyunSection('asr', { provider: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>ASR Base URL</label>
                <input
                  value={config.aliyun.asr.baseUrl || ''}
                  onChange={e => updateAliyunSection('asr', { baseUrl: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>ASR API Key</label>
                <input
                  value={config.aliyun.asr.apiKey || ''}
                  onChange={e => {
                    markSecretDirty('asrApiKey')
                    updateAliyunSection('asr', { apiKey: e.target.value })
                  }}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>ASR Model</label>
                <input
                  value={config.aliyun.asr.model || ''}
                  onChange={e => updateAliyunSection('asr', { model: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>ASR Test File URL</label>
                <input
                  value={config.aliyun.asr.testFileUrl || ''}
                  onChange={e => updateAliyunSection('asr', { testFileUrl: e.target.value })}
                  placeholder="https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Submit Path</label>
                <input
                  value={config.aliyun.asr.submitPath || ''}
                  onChange={e => updateAliyunSection('asr', { submitPath: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Query Path Template</label>
                <input
                  value={config.aliyun.asr.queryPathTemplate || ''}
                  onChange={e => updateAliyunSection('asr', { queryPathTemplate: e.target.value })}
                  placeholder="/tasks/{task_id}"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Language Hints (逗号分隔)</label>
                <input
                  value={languageHintsText}
                  onChange={e => setLanguageHintsText(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Polling Interval (ms)</label>
                <input
                  value={String(config.aliyun.asr.pollingIntervalMs)}
                  onChange={e => updateAliyunSection('asr', { pollingIntervalMs: Number(e.target.value || 0) })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Polling Timeout (ms)</label>
                <input
                  value={String(config.aliyun.asr.pollingTimeoutMs)}
                  onChange={e => updateAliyunSection('asr', { pollingTimeoutMs: Number(e.target.value || 0) })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Speaker Count（可选 2-100）</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  step={1}
                  value={config.aliyun.asr.speakerCount == null ? '' : String(config.aliyun.asr.speakerCount)}
                  onChange={e => {
                    const raw = String(e.target.value || '').trim()
                    const parsed = raw ? Number.parseInt(raw, 10) : NaN
                    updateAliyunSection('asr', { speakerCount: Number.isInteger(parsed) ? parsed : null })
                  }}
                  placeholder="留空表示自动判断"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={config.aliyun.asr.diarizationEnabled !== false}
                    onChange={e => updateAliyunSection('asr', { diarizationEnabled: e.target.checked })}
                  />
                  启用说话人分离（diarization_enabled）
                </label>
              </div>
            </div>
            <label style={labelStyle}>ASR requestExtraParams (JSON)</label>
            <textarea
              value={asrExtraText}
              onChange={e => setAsrExtraText(e.target.value)}
              rows={5}
              style={textareaStyle}
            />
            {aliyunTestResultMap.asr && (
              <div style={aliyunTestResultMap.asr.type === 'success' ? inlineOkStyle : inlineErrorStyle}>
                {aliyunTestResultMap.asr.text}
              </div>
            )}
          </div>
        </div>
      </section>
      </div>
    </div>
  )
}

const loadingStyle = {
  textAlign: 'center',
  padding: 40,
  color: 'rgba(255,255,255,0.72)'
}

const topBarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)'
}

const linkStyle = {
  color: '#c5adff',
  fontWeight: 700,
  textDecoration: 'none'
}

const cardStyle = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 16,
  background: 'linear-gradient(145deg, rgba(23,20,34,0.95), rgba(17,15,28,0.96))',
  padding: 14,
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)'
}

const subCardStyle = {
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  padding: 12,
  background: 'rgba(255,255,255,0.04)'
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
  flexWrap: 'wrap'
}

const providerHeadStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10
}

const sectionTitleStyle = {
  margin: 0,
  fontSize: 16,
  color: '#f0f2ff',
  fontWeight: 800
}

const sectionHintStyle = {
  margin: '5px 0 10px',
  color: 'rgba(255,255,255,0.66)',
  fontSize: 13
}

const fieldGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10
}

const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  color: 'rgba(255,255,255,0.8)',
  fontWeight: 700
}

const checkLabelStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontSize: 13,
  color: 'rgba(255,255,255,0.8)',
  fontWeight: 700
}

const inputStyle = {
  width: '100%',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 10,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 13,
  color: '#f1f3ff',
  background: 'rgba(255,255,255,0.05)'
}

const inputErrorStyle = {
  border: '1px solid rgba(255, 77, 79, 0.72)',
  background: 'rgba(255, 77, 79, 0.14)'
}

const fieldErrorStyle = {
  marginTop: 6,
  fontSize: 12,
  color: '#ffb8ba',
  fontWeight: 700
}

const textareaStyle = {
  ...inputStyle,
  minHeight: 140,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
}

const primaryBtnStyle = {
  border: '1px solid rgba(170, 138, 255, 0.58)',
  borderRadius: 999,
  minHeight: 44,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 700,
  color: '#ffffff',
  background: 'linear-gradient(135deg, #6300ff, #7a3dff)',
  cursor: 'pointer'
}

const ghostBtnStyle = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 999,
  minHeight: 40,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: 'rgba(255,255,255,0.88)',
  background: 'rgba(255,255,255,0.06)',
  cursor: 'pointer'
}

const dangerBtnStyle = {
  ...ghostBtnStyle,
  border: '1px solid rgba(255, 77, 79, 0.4)',
  color: '#ffd3d4',
  background: 'rgba(255, 77, 79, 0.18)'
}

const okStyle = {
  padding: '10px 12px',
  border: '1px solid rgba(25, 195, 125, 0.48)',
  borderRadius: 10,
  color: '#98ffd0',
  background: 'rgba(25, 195, 125, 0.14)'
}

const errorStyle = {
  padding: '10px 12px',
  border: '1px solid rgba(255, 77, 79, 0.48)',
  borderRadius: 10,
  color: '#ffc6c8',
  background: 'rgba(255, 77, 79, 0.14)'
}

const readonlyBannerStyle = {
  border: '1px solid rgba(245, 165, 36, 0.42)',
  borderRadius: 12,
  background: 'rgba(245, 165, 36, 0.16)',
  color: '#ffd79c',
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.5,
  padding: '10px 12px'
}

const readonlyWrapStyle = {
  display: 'grid',
  gap: 14,
  opacity: 0.62,
  filter: 'grayscale(0.22)',
  pointerEvents: 'none',
  userSelect: 'none'
}

const inlineOkStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(25, 195, 125, 0.48)',
  borderRadius: 10,
  color: '#98ffd0',
  background: 'rgba(25, 195, 125, 0.14)',
  fontSize: 12
}

const inlineInfoStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(130, 154, 255, 0.45)',
  borderRadius: 10,
  color: '#d6ddff',
  background: 'rgba(130, 154, 255, 0.14)',
  fontSize: 12
}

const inlineErrorStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(255, 77, 79, 0.48)',
  borderRadius: 10,
  color: '#ffc6c8',
  background: 'rgba(255, 77, 79, 0.14)',
  fontSize: 12
}

const copyBtnStyle = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 999,
  minHeight: 40,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#e6dcff',
  background: 'linear-gradient(135deg, rgba(99,0,255,0.42), rgba(122,61,255,0.34))',
  cursor: 'pointer',
  flex: '0 0 auto',
  transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease'
}

const copyBtnPressedStyle = {
  transform: 'translateY(1px) scale(0.98)',
  boxShadow: 'inset 0 1px 2px rgba(22, 16, 41, 0.48)',
  background: 'linear-gradient(135deg, rgba(82,0,212,0.5), rgba(110,49,238,0.4))'
}

const copyBtnDoneStyle = {
  border: '1px solid rgba(25, 195, 125, 0.48)',
  color: '#98ffd0',
  background: 'linear-gradient(135deg, rgba(25,195,125,0.25), rgba(29,160,111,0.21))'
}
