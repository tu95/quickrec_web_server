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

export default function SettingsClient() {
  const [config, setConfig] = useState(null)
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
        throw new Error(data?.error || `加载配置失败: HTTP ${res.status}`)
      }
      setConfig(data.config)
      setOssFieldErrors({})
      setOssTouchedMap({})
      setLanguageHintsText((data.config?.aliyun?.asr?.languageHints || ['zh']).join(', '))
      setAsrExtraText(JSON.stringify(data.config?.aliyun?.asr?.requestExtraParams || {}, null, 2))
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
  }

  function addProvider() {
    patchConfig(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: [...prev.llm.providers, buildDefaultProvider()]
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
      const validation = validateCurrentOss(config?.aliyun?.oss || {}, true)
      if (!validation.valid) {
        setAliyunTestResultMap(prev => ({
          ...prev,
          oss: {
            type: 'error',
            text: 'OSS 配置校验失败，请先修正红框字段'
          }
        }))
        return
      }
      aliyunPayload = {
        ...config.aliyun,
        oss: {
          ...(config.aliyun?.oss || {}),
          ...validation.normalized
        }
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
    if (!config) return
    setSaveBusy(true)
    setError('')
    setMessage('')
    try {
      const ossValidation = validateCurrentOss(config?.aliyun?.oss || {}, true)
      if (!ossValidation.valid) {
        throw new Error('OSS 配置校验失败，请修正红框字段后再保存')
      }
      const parsedAsrExtra = JSON.parse(asrExtraText || '{}')
      const diarizationEnabled = config?.aliyun?.asr?.diarizationEnabled !== false
      const nextConfig = {
        ...config,
        aliyun: {
          ...config.aliyun,
          oss: {
            ...config.aliyun.oss,
            ...ossValidation.normalized
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
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig })
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
          <button style={primaryBtnStyle} onClick={saveConfig} disabled={saveBusy}>
            {saveBusy ? '保存中...' : '保存全部配置'}
          </button>
        </div>
        <a href="/" style={linkStyle}>返回文件控制台</a>
      </div>

      {message && <div style={okStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>网站访问密码</h3>
        <p style={sectionHintStyle}>未登录时会统一跳转到 `/login`。修改后需使用新密码重新登录。</p>
        <label style={labelStyle}>sitePassword</label>
        <input
          type="text"
          value={config.access.sitePassword || ''}
          onChange={e => patchConfig(prev => ({ ...prev, access: { ...prev.access, sitePassword: e.target.value } }))}
          placeholder="输入网站访问密码"
          style={inputStyle}
        />
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
                    <input value={provider.apiKey} onChange={e => updateProvider(provider.id, { apiKey: e.target.value })} placeholder="sk-..." style={inputStyle} />
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
                  onChange={e => updateOssField('accessKeyId', e.target.value)}
                  style={getFieldInputStyle('accessKeyId')}
                />
                {renderFieldError('accessKeyId')}
              </div>
              <div>
                <label style={labelStyle}>AccessKeySecret</label>
                <input
                  value={config.aliyun.oss.accessKeySecret || ''}
                  onChange={e => updateOssField('accessKeySecret', e.target.value)}
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
                  onChange={e => updateAliyunSection('asr', { apiKey: e.target.value })}
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
  )
}

const loadingStyle = {
  textAlign: 'center',
  padding: 40,
  color: '#4b666b'
}

const topBarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(22, 76, 93, 0.16)',
  background: 'rgba(255,255,255,0.68)'
}

const linkStyle = {
  color: '#18626f',
  fontWeight: 700,
  textDecoration: 'none'
}

const cardStyle = {
  border: '1px solid rgba(24, 72, 83, 0.15)',
  borderRadius: 16,
  background: 'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(249, 255, 251, 0.83))',
  padding: 14,
  boxShadow: '0 8px 22px rgba(34, 64, 67, 0.09)'
}

const subCardStyle = {
  border: '1px solid rgba(36, 79, 91, 0.14)',
  borderRadius: 12,
  padding: 12,
  background: 'rgba(255,255,255,0.88)'
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
  color: '#1e4953',
  fontWeight: 800
}

const sectionHintStyle = {
  margin: '5px 0 10px',
  color: '#4f686e',
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
  color: '#32515a',
  fontWeight: 700
}

const checkLabelStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontSize: 13,
  color: '#2f5f65',
  fontWeight: 700
}

const inputStyle = {
  width: '100%',
  border: '1px solid rgba(33, 86, 97, 0.25)',
  borderRadius: 10,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 13,
  color: '#1f4249',
  background: 'rgba(255,255,255,0.95)'
}

const inputErrorStyle = {
  border: '1px solid rgba(185, 77, 77, 0.72)',
  background: 'rgba(255, 244, 244, 0.96)'
}

const fieldErrorStyle = {
  marginTop: 6,
  fontSize: 12,
  color: '#8e2c2c',
  fontWeight: 700
}

const textareaStyle = {
  ...inputStyle,
  minHeight: 140,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
}

const primaryBtnStyle = {
  border: '1px solid rgba(10, 126, 118, 0.45)',
  borderRadius: 999,
  minHeight: 44,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 700,
  color: '#114e55',
  background: 'linear-gradient(135deg, rgba(6,170,158,0.28), rgba(247,182,90,0.22))',
  cursor: 'pointer'
}

const ghostBtnStyle = {
  border: '1px solid rgba(33, 77, 86, 0.3)',
  borderRadius: 999,
  minHeight: 40,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#21545f',
  background: 'rgba(255,255,255,0.85)',
  cursor: 'pointer'
}

const dangerBtnStyle = {
  ...ghostBtnStyle,
  border: '1px solid rgba(177, 60, 60, 0.35)',
  color: '#9d3535',
  background: 'rgba(255, 243, 243, 0.95)'
}

const okStyle = {
  padding: '10px 12px',
  border: '1px solid rgba(26, 138, 109, 0.42)',
  borderRadius: 10,
  color: '#1c684f',
  background: 'rgba(235, 255, 245, 0.88)'
}

const errorStyle = {
  padding: '10px 12px',
  border: '1px solid rgba(185, 77, 77, 0.38)',
  borderRadius: 10,
  color: '#8e2c2c',
  background: 'rgba(255, 241, 241, 0.92)'
}

const inlineOkStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(26, 138, 109, 0.42)',
  borderRadius: 10,
  color: '#1c684f',
  background: 'rgba(235, 255, 245, 0.88)',
  fontSize: 12
}

const inlineInfoStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(55, 99, 170, 0.35)',
  borderRadius: 10,
  color: '#2b517e',
  background: 'rgba(239, 247, 255, 0.9)',
  fontSize: 12
}

const inlineErrorStyle = {
  marginTop: 8,
  padding: '8px 10px',
  border: '1px solid rgba(185, 77, 77, 0.38)',
  borderRadius: 10,
  color: '#8e2c2c',
  background: 'rgba(255, 241, 241, 0.92)',
  fontSize: 12
}

const copyBtnStyle = {
  border: '1px solid rgba(15, 118, 88, 0.3)',
  borderRadius: 999,
  minHeight: 40,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#0f5f52',
  background: 'linear-gradient(135deg, rgba(224,255,247,0.95), rgba(239,255,245,0.95))',
  cursor: 'pointer',
  flex: '0 0 auto',
  transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease'
}

const copyBtnPressedStyle = {
  transform: 'translateY(1px) scale(0.98)',
  boxShadow: 'inset 0 1px 2px rgba(7, 53, 45, 0.18)',
  background: 'linear-gradient(135deg, rgba(194,247,233,0.95), rgba(223,251,238,0.95))'
}

const copyBtnDoneStyle = {
  border: '1px solid rgba(23, 148, 93, 0.42)',
  color: '#0d6a4c',
  background: 'linear-gradient(135deg, rgba(209,255,235,0.95), rgba(226,255,240,0.95))'
}
