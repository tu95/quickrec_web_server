'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { validateOssConfig } from '../lib/aliyun-validators'

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
    name: '新 Prompt',
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
  'objectPrefixMp3',
  'objectPrefixOpus'
]

const OSS_PROVIDER_OPTIONS = [
  { value: 's3_compatible', zh: '通用 S3', en: 'Generic S3' },
  { value: 'cloudflare_r2', zh: 'Cloudflare R2', en: 'Cloudflare R2' },
  { value: 'aliyun_oss', zh: '阿里云 OSS（S3 API）', en: 'Aliyun OSS (S3 API)' },
  { value: 'aws_s3', zh: 'AWS S3', en: 'AWS S3' }
]

function buildSecretDirtyState(config) {
  const providerApiKeys = {}
  const providers = Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  for (const provider of providers) {
    providerApiKeys[String(provider?.id || '')] = false
  }
  return {
    asrApiKey: false,
    ossAccessKeyId: false,
    ossAccessKeySecret: false,
    providerApiKeys
  }
}

export default function ConfigEditorForm({
  config,
  setConfig,
  onSave,
  saveBusy = false,
  readOnly = false,
  allowTesting = false,
  testApiScope = 'admin',
  profileId = '',
  profileScope = 'user',
  saveLabel = '保存配置',
  activeTab: initialActiveTab = 'oss',
  hideSaveButton = false
}) {
  const locale = useLocale()
  const isEn = String(locale || '').toLowerCase().startsWith('en')
  const [activeTab, setActiveTab] = useState(initialActiveTab)
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
  const [secretDirty, setSecretDirty] = useState(() => buildSecretDirtyState(config))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 当 initialActiveTab 变化时更新 activeTab
  useEffect(() => {
    if (initialActiveTab && initialActiveTab !== activeTab) {
      setActiveTab(initialActiveTab)
    }
  }, [initialActiveTab])

  useEffect(() => {
    setLanguageHintsText((config?.aliyun?.asr?.languageHints || ['zh']).join(', '))
    setAsrExtraText(JSON.stringify(config?.aliyun?.asr?.requestExtraParams || {}, null, 2))
    setSecretDirty(buildSecretDirtyState(config))
    setOssFieldErrors({})
    setOssTouchedMap({})
    setMessage('')
    setError('')
  }, [config])

  const providerList = useMemo(() => {
    return Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  }, [config])

  const promptList = useMemo(() => {
    return Array.isArray(config?.prompts?.items) ? config.prompts.items : []
  }, [config])

  const testApiBase = testApiScope === 'user' ? '/api/user' : '/api/admin'

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

  function applyOssProviderPreset(provider) {
    const current = config?.aliyun?.oss || {}
    const nextPatch = { provider }
    if (provider === 'cloudflare_r2') {
      nextPatch.region = 'auto'
    } else if (provider === 'aws_s3') {
      if (!String(current.region || '').trim()) nextPatch.region = 'us-east-1'
    } else if (provider === 'aliyun_oss') {
      if (!String(current.region || '').trim()) nextPatch.region = 'oss-cn-hangzhou'
    }
    const nextOss = { ...current, ...nextPatch }
    validateCurrentOss(nextOss, false)
    updateAliyunSection('oss', nextPatch)
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
    const newProvider = buildDefaultProvider()
    patchConfig(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: [...prev.llm.providers, newProvider]
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
    if (!allowTesting) return
    setModelsBusyMap(prev => ({ ...prev, [providerId]: true }))
    setError('')
    try {
      const provider = providerList.find(item => item.id === providerId)
      const res = await fetch(`${testApiBase}/llm/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          provider: provider || undefined,
          profileId,
          profileScope
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `模型拉取失败: HTTP ${res.status}`)
      }
      const modelIds = (data.models || []).map(item => item.id).filter(Boolean)
      setModelsMap(prev => ({ ...prev, [providerId]: modelIds }))
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'success', text: `已拉取 ${modelIds.length} 个模型` }
      }))
    } catch (err) {
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'error', text: String(err?.message || err) }
      }))
    } finally {
      setModelsBusyMap(prev => ({ ...prev, [providerId]: false }))
    }
  }

  async function testProvider(providerId) {
    if (!allowTesting) return
    const provider = providerList.find(item => item.id === providerId)
    if (!provider) return
    setTestBusyMap(prev => ({ ...prev, [providerId]: true }))
    setError('')
    try {
      const res = await fetch(`${testApiBase}/llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          provider,
          model: provider.selectedModel,
          profileId,
          profileScope
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `连通性测试失败: HTTP ${res.status}`)
      }
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'success', text: `测试成功: ${String(data.text || '').slice(0, 120)}` }
      }))
    } catch (err) {
      setProviderResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'error', text: String(err?.message || err) }
      }))
    } finally {
      setTestBusyMap(prev => ({ ...prev, [providerId]: false }))
    }
  }

  async function copyText(providerId, text) {
    const value = String(text || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopyDoneMap(prev => ({ ...prev, [providerId]: true }))
      setProviderCopyResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'success', text: `已复制模型名: ${value}` }
      }))
      window.setTimeout(() => {
        setCopyDoneMap(prev => ({ ...prev, [providerId]: false }))
      }, 1200)
    } catch (err) {
      setProviderCopyResultMap(prev => ({
        ...prev,
        [providerId]: { type: 'error', text: String(err?.message || err) }
      }))
    }
  }

  async function testAliyunService(serviceKey) {
    if (!allowTesting || !config) return
    const endpointMap = {
      oss: `${testApiBase}/aliyun/oss/test`,
      asr: `${testApiBase}/aliyun/asr/test`
    }
    const endpoint = endpointMap[serviceKey]
    if (!endpoint) return

    let aliyunPayload = config.aliyun
    if (serviceKey === 'oss') {
      aliyunPayload = {
        ...config.aliyun,
        oss: { ...(config.aliyun?.oss || {}) }
      }
      if (!secretDirty.ossAccessKeyId) delete aliyunPayload.oss.accessKeyId
      if (!secretDirty.ossAccessKeySecret) delete aliyunPayload.oss.accessKeySecret
    }
    if (serviceKey === 'asr') {
      let parsedAsrExtra = {}
      try {
        parsedAsrExtra = JSON.parse(asrExtraText || '{}')
      } catch {
        setAliyunTestResultMap(prev => ({
          ...prev,
          [serviceKey]: { type: 'error', text: 'ASR requestExtraParams 不是合法 JSON' }
        }))
        return
      }
      aliyunPayload = {
        ...config.aliyun,
        asr: {
          ...config.aliyun.asr,
          languageHints: languageHintsText.split(',').map(item => item.trim()).filter(Boolean),
          requestExtraParams: parsedAsrExtra
        }
      }
      if (!secretDirty.asrApiKey) delete aliyunPayload.asr.apiKey
    }

    setAliyunTestBusyMap(prev => ({ ...prev, [serviceKey]: true }))
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliyun: aliyunPayload, profileId, profileScope })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (serviceKey === 'oss' && data?.fields) {
          setOssFieldErrors(data.fields)
          setOssTouchedMap(buildAllOssTouched())
        }
        throw new Error(data?.error || `测试失败: HTTP ${res.status}`)
      }
      setAliyunTestResultMap(prev => ({
        ...prev,
        [serviceKey]: { type: 'success', text: String(data?.message || '测试成功') }
      }))
    } catch (err) {
      setAliyunTestResultMap(prev => ({
        ...prev,
        [serviceKey]: { type: 'error', text: String(err?.message || err) }
      }))
    } finally {
      setAliyunTestBusyMap(prev => ({ ...prev, [serviceKey]: false }))
    }
  }

  async function saveConfig() {
    if (!config || readOnly) return
    setMessage('')
    setError('')
    try {
      const parsedAsrExtra = JSON.parse(asrExtraText || '{}')
      const nextConfig = {
        ...config,
        aliyun: {
          ...config.aliyun,
          oss: { ...config.aliyun.oss },
          asr: {
            ...config.aliyun.asr,
            languageHints: languageHintsText.split(',').map(item => item.trim()).filter(Boolean),
            requestExtraParams: parsedAsrExtra
          }
        }
      }
      const payloadConfig = JSON.parse(JSON.stringify(nextConfig))
      if (payloadConfig.aliyun?.asr && !secretDirty.asrApiKey) delete payloadConfig.aliyun.asr.apiKey
      if (payloadConfig.aliyun?.oss && !secretDirty.ossAccessKeyId) delete payloadConfig.aliyun.oss.accessKeyId
      if (payloadConfig.aliyun?.oss && !secretDirty.ossAccessKeySecret) delete payloadConfig.aliyun.oss.accessKeySecret
      if (Array.isArray(payloadConfig?.llm?.providers)) {
        payloadConfig.llm.providers = payloadConfig.llm.providers.map(provider => {
          const id = String(provider?.id || '')
          if (secretDirty.providerApiKeys[id]) return provider
          const nextProvider = { ...provider }
          delete nextProvider.apiKey
          return nextProvider
        })
      }
      const savedConfig = await onSave(payloadConfig)
      if (savedConfig) {
        setConfig(savedConfig)
      }
      setMessage('配置已保存')
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  if (!config) {
    return <div style={errorStyle}>配置不可用</div>
  }

  // 子配置标签页
  const tabs = [
    { key: 'oss', label: isEn ? 'Object Storage' : '对象存储', icon: '📦' },
    { key: 'asr', label: 'ASR 语音识别', icon: '🎙️' },
    { key: 'llm', label: 'LLM 大模型', icon: '🤖' }
  ]

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {!readOnly && !hideSaveButton && (
        <div style={topBarStyle}>
          <button style={primaryBtnStyle} onClick={saveConfig} disabled={saveBusy}>
            {saveBusy ? '保存中...' : saveLabel}
          </button>
        </div>
      )}

      {message && <div style={okStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {readOnly && <div style={readonlyBannerStyle}>当前为只读状态，无法修改。</div>}

      {/* 只显示当前服务类型的配置，不显示标签页导航 */}

      <fieldset disabled={readOnly} style={fieldsetStyle}>
        {/* OSS 配置 */}
        {activeTab === 'oss' && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h3 style={sectionTitleStyle}>{isEn ? 'Object Storage (S3 Compatible)' : '对象存储（S3 Compatible）'}</h3>
                <p style={sectionHintStyle}>{isEn ? 'Recording upload and signed playback rely on this config.' : '录音文件上传和签名播放依赖这组配置。'}</p>
              </div>
              {allowTesting ? (
                <div style={testActionRowStyle}>
                  {aliyunTestResultMap.oss ? (
                    <span style={aliyunTestResultMap.oss.type === 'success' ? testResultOkTextStyle : testResultErrorTextStyle}>
                      {aliyunTestResultMap.oss.text}
                    </span>
                  ) : null}
                  <button style={ghostBtnStyle} onClick={() => testAliyunService('oss')} disabled={aliyunTestBusyMap.oss}>
                    {aliyunTestBusyMap.oss ? (isEn ? 'Testing...' : '测试中...') : (isEn ? 'Test Storage' : '测试对象存储')}
                  </button>
                </div>
              ) : null}
            </div>
            <div style={fieldGridStyle}>
              <div>
                <label style={labelStyle}>Provider</label>
                <select
                  value={config.aliyun.oss.provider || 's3_compatible'}
                  onChange={e => applyOssProviderPreset(e.target.value)}
                  style={getFieldInputStyle('provider')}
                >
                  {OSS_PROVIDER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {isEn ? option.en : option.zh}
                    </option>
                  ))}
                </select>
                {renderFieldError('provider')}
              </div>
              <div>
                <label style={labelStyle}>Endpoint</label>
                <input value={config.aliyun.oss.endpoint || ''} onChange={e => updateOssField('endpoint', e.target.value)} style={getFieldInputStyle('endpoint')} />
                {renderFieldError('endpoint')}
              </div>
              <div>
                <label style={labelStyle}>Region</label>
                <input value={config.aliyun.oss.region || ''} onChange={e => updateOssField('region', e.target.value)} style={getFieldInputStyle('region')} />
                {renderFieldError('region')}
              </div>
              <div>
                <label style={labelStyle}>Bucket</label>
                <input value={config.aliyun.oss.bucket || ''} onChange={e => updateOssField('bucket', e.target.value)} style={getFieldInputStyle('bucket')} />
                {renderFieldError('bucket')}
              </div>
              <div>
                <label style={labelStyle}>AccessKeyId</label>
                <input value={config.aliyun.oss.accessKeyId || ''} onChange={e => { markSecretDirty('ossAccessKeyId'); updateOssField('accessKeyId', e.target.value) }} style={getFieldInputStyle('accessKeyId')} />
                {renderFieldError('accessKeyId')}
              </div>
              <div>
                <label style={labelStyle}>AccessKeySecret</label>
                <input value={config.aliyun.oss.accessKeySecret || ''} onChange={e => { markSecretDirty('ossAccessKeySecret'); updateOssField('accessKeySecret', e.target.value) }} style={getFieldInputStyle('accessKeySecret')} />
                {renderFieldError('accessKeySecret')}
              </div>
              <div>
                <label style={labelStyle}>{isEn ? 'Object Storage Public Base URL' : '对象存储 Public Base URL'}</label>
                <input value={config.aliyun.oss.publicBaseUrl || ''} onChange={e => updateOssField('publicBaseUrl', e.target.value)} style={getFieldInputStyle('publicBaseUrl')} />
                {renderFieldError('publicBaseUrl')}
              </div>
              <div>
                <label style={labelStyle}>{isEn ? 'Object Storage MP3 Prefix' : '对象存储 MP3 Prefix'}</label>
                <input
                  value={config.aliyun.oss.objectPrefixMp3 || ''}
                  onChange={e => updateOssField('objectPrefixMp3', e.target.value)}
                  style={getFieldInputStyle('objectPrefixMp3')}
                />
                {renderFieldError('objectPrefixMp3')}
              </div>
              <div>
                <label style={labelStyle}>{isEn ? 'Object Storage OPUS Prefix' : '对象存储 OPUS Prefix'}</label>
                <input
                  value={config.aliyun.oss.objectPrefixOpus || ''}
                  onChange={e => updateOssField('objectPrefixOpus', e.target.value)}
                  style={getFieldInputStyle('objectPrefixOpus')}
                />
                {renderFieldError('objectPrefixOpus')}
              </div>
            </div>
          </section>
        )}

        {/* ASR 配置 */}
        {activeTab === 'asr' && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h3 style={sectionTitleStyle}>ASR 转写服务</h3>
                <p style={sectionHintStyle}>用于提交音频转写任务与轮询结果。</p>
              </div>
              {allowTesting ? (
                <div style={testActionRowStyle}>
                  {aliyunTestResultMap.asr ? (
                    <span style={aliyunTestResultMap.asr.type === 'success' ? testResultOkTextStyle : testResultErrorTextStyle}>
                      {aliyunTestResultMap.asr.text}
                    </span>
                  ) : null}
                  <button style={ghostBtnStyle} onClick={() => testAliyunService('asr')} disabled={aliyunTestBusyMap.asr}>
                    {aliyunTestBusyMap.asr ? '测试中...' : '测试 ASR'}
                  </button>
                </div>
              ) : null}
            </div>
            <div style={fieldGridStyle}>
              <div>
                <label style={labelStyle}>Provider</label>
                <input value={config.aliyun.asr.provider || ''} onChange={e => updateAliyunSection('asr', { provider: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ASR Base URL</label>
                <input value={config.aliyun.asr.baseUrl || ''} onChange={e => updateAliyunSection('asr', { baseUrl: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ASR API Key</label>
                <input value={config.aliyun.asr.apiKey || ''} onChange={e => { markSecretDirty('asrApiKey'); updateAliyunSection('asr', { apiKey: e.target.value }) }} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ASR Model</label>
                <input value={config.aliyun.asr.model || ''} onChange={e => updateAliyunSection('asr', { model: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ASR Test File URL</label>
                <input value={config.aliyun.asr.testFileUrl || ''} onChange={e => updateAliyunSection('asr', { testFileUrl: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Submit Path</label>
                <input value={config.aliyun.asr.submitPath || ''} onChange={e => updateAliyunSection('asr', { submitPath: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Query Path Template</label>
                <input value={config.aliyun.asr.queryPathTemplate || ''} onChange={e => updateAliyunSection('asr', { queryPathTemplate: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Language Hints</label>
                <input value={languageHintsText} onChange={e => setLanguageHintsText(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Polling Interval (ms)</label>
                <input value={String(config.aliyun.asr.pollingIntervalMs)} onChange={e => updateAliyunSection('asr', { pollingIntervalMs: Number(e.target.value || 0) })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Polling Timeout (ms)</label>
                <input value={String(config.aliyun.asr.pollingTimeoutMs)} onChange={e => updateAliyunSection('asr', { pollingTimeoutMs: Number(e.target.value || 0) })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Speaker Count</label>
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
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <label style={checkLabelStyle}>
                  <input type="checkbox" checked={config.aliyun.asr.diarizationEnabled !== false} onChange={e => updateAliyunSection('asr', { diarizationEnabled: e.target.checked })} />
                  启用说话人分离
                </label>
              </div>
            </div>
            <label style={labelStyle}>ASR requestExtraParams (JSON)</label>
            <textarea value={asrExtraText} onChange={e => setAsrExtraText(e.target.value)} rows={5} style={textareaStyle} />
          </section>
        )}

        {/* LLM 配置 */}
        {activeTab === 'llm' && (
          <>
            <section style={cardStyle}>
              <div style={sectionHeaderStyle}>
                <div>
                  <h3 style={sectionTitleStyle}>LLM 提供商与模型</h3>
                  <p style={sectionHintStyle}>支持多提供商和多模型。</p>
                </div>
                <button style={ghostBtnStyle} onClick={addProvider} disabled={readOnly}>新增提供商</button>
              </div>

              <div style={fieldGridStyle}>
                <div>
                  <label style={labelStyle}>默认 Provider</label>
                  <input
                    value={config.llm.defaultProviderId}
                    onChange={e => patchConfig(prev => ({ ...prev, llm: { ...prev.llm, defaultProviderId: e.target.value } }))}
                    style={inputStyle}
                    placeholder="请输入默认 Provider ID"
                  />
                </div>
                <div>
                  <label style={labelStyle}>默认 Model</label>
                  <input
                    value={config.llm.defaultModel || ''}
                    onChange={e => patchConfig(prev => ({ ...prev, llm: { ...prev.llm, defaultModel: e.target.value } }))}
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
                        <div style={providerHeadActionsStyle}>
                          {allowTesting ? (
                            <div style={testActionRowStyle}>
                              {providerResult ? (
                                <span style={providerResult.type === 'success' ? testResultOkTextStyle : testResultErrorTextStyle}>
                                  {providerResult.text}
                                </span>
                              ) : null}
                              <button style={ghostBtnStyle} onClick={() => testProvider(provider.id)} disabled={testBusyMap[provider.id]}>
                                {testBusyMap[provider.id] ? '测试中...' : '测试连通性'}
                              </button>
                            </div>
                          ) : null}
                          <button style={dangerBtnStyle} onClick={() => removeProvider(provider.id)} disabled={readOnly}>删除</button>
                        </div>
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
                          <input value={provider.baseUrl} onChange={e => updateProvider(provider.id, { baseUrl: e.target.value })} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>API Key</label>
                          <input
                            value={provider.apiKey}
                            onChange={e => {
                              markProviderApiKeyDirty(provider.id)
                              updateProvider(provider.id, { apiKey: e.target.value })
                            }}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>模型</label>
                          <select value={provider.selectedModel || ''} onChange={e => updateProvider(provider.id, { selectedModel: e.target.value })} style={inputStyle}>
                            <option value="">请选择模型</option>
                            {modelOptions.map(modelId => (
                              <option key={modelId} value={modelId}>{modelId}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'end' }}>
                          <label style={checkLabelStyle}>
                            <input type="checkbox" checked={provider.enabled !== false} onChange={e => updateProvider(provider.id, { enabled: e.target.checked })} />
                            启用
                          </label>
                        </div>
                      </div>
                      {allowTesting && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <button style={ghostBtnStyle} onClick={() => fetchProviderModels(provider.id)} disabled={modelsBusyMap[provider.id]}>
                            {modelsBusyMap[provider.id] ? '拉取中...' : '获取模型列表'}
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
                            onClick={() => copyText(provider.id, provider.selectedModel)}
                          >
                            {copyDoneMap[provider.id] ? '已复制' : '复制当前模型'}
                          </button>
                        </div>
                      )}
                      {providerCopyResult && <div style={providerCopyResult.type === 'success' ? inlineInfoStyle : inlineErrorStyle}>{providerCopyResult.text}</div>}
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {/* Prompt 配置 */}
        {activeTab === 'prompt' && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h3 style={sectionTitleStyle}>会议纪要 Prompt</h3>
                <p style={sectionHintStyle}>多 Prompt 管理，单选默认项。</p>
              </div>
              <button style={ghostBtnStyle} onClick={addPrompt} disabled={readOnly}>新增 Prompt</button>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {promptList.map(prompt => (
                <div key={prompt.id} style={subCardStyle}>
                  <div style={providerHeadStyle}>
                    <strong>{prompt.name}</strong>
                    <button style={dangerBtnStyle} onClick={() => removePrompt(prompt.id)} disabled={readOnly}>删除</button>
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
                        <input type="checkbox" checked={prompt.enabled !== false} onChange={e => updatePrompt(prompt.id, { enabled: e.target.checked })} />
                        启用
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <label style={checkLabelStyle}>
                        <input type="radio" name="default-prompt" checked={config.prompts.defaultPromptId === prompt.id} onChange={() => patchConfig(prev => ({ ...prev, prompts: { ...prev.prompts, defaultPromptId: prompt.id } }))} />
                        设为默认
                      </label>
                    </div>
                  </div>
                  <label style={labelStyle}>Prompt 内容</label>
                  <textarea value={prompt.content} onChange={e => updatePrompt(prompt.id, { content: e.target.value })} rows={8} style={textareaStyle} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Meeting 配置 */}
        {activeTab === 'meeting' && (
          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>用户配置</h3>
            <p style={sectionHintStyle}>控制会议纪要生成行为。</p>
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
              上传 MP3 后自动生成纪要
            </label>
          </section>
        )}

      </fieldset>
    </div>
  )
}

const fieldsetStyle = {
  display: 'grid',
  gap: 14,
  border: 'none',
  padding: 0,
  margin: 0,
  minWidth: 0
}

const topBarStyle = {
  display: 'flex',
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)'
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

const providerHeadActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const testActionRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap'
}

const testResultOkTextStyle = {
  color: '#b2ffdc',
  fontSize: 12,
  fontWeight: 700,
  textAlign: 'right'
}

const testResultErrorTextStyle = {
  color: '#ffcbcf',
  fontSize: 12,
  fontWeight: 700,
  textAlign: 'right'
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
  color: '#13111b',
  background: 'linear-gradient(135deg, #e6dcff, #9dd4ff)',
  cursor: 'pointer'
}

const ghostBtnStyle = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 999,
  minHeight: 42,
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#edf1ff',
  background: 'rgba(255,255,255,0.06)',
  cursor: 'pointer'
}

const dangerBtnStyle = {
  ...ghostBtnStyle,
  color: '#ffb4b6',
  border: '1px solid rgba(255,120,120,0.24)'
}

const okStyle = {
  borderRadius: 12,
  padding: '10px 12px',
  color: '#b2ffdc',
  background: 'rgba(36, 133, 92, 0.18)',
  border: '1px solid rgba(79, 216, 144, 0.34)'
}

const errorStyle = {
  borderRadius: 12,
  padding: '10px 12px',
  color: '#ffcbcf',
  background: 'rgba(156, 54, 70, 0.22)',
  border: '1px solid rgba(255, 104, 130, 0.3)'
}

const inlineOkStyle = { ...okStyle, marginTop: 10, fontSize: 13 }
const inlineErrorStyle = { ...errorStyle, marginTop: 10, fontSize: 13 }
const inlineInfoStyle = {
  marginTop: 10,
  borderRadius: 12,
  padding: '10px 12px',
  color: '#d4e6ff',
  background: 'rgba(66, 111, 174, 0.2)',
  border: '1px solid rgba(107, 166, 255, 0.3)'
}

const readonlyBannerStyle = {
  borderRadius: 12,
  padding: '10px 12px',
  color: '#ffd9a6',
  background: 'rgba(177, 114, 35, 0.18)',
  border: '1px solid rgba(255, 187, 94, 0.28)'
}

const copyBtnStyle = {
  ...ghostBtnStyle,
  minWidth: 132
}

const copyBtnPressedStyle = {
  transform: 'translateY(1px)',
  background: 'rgba(255,255,255,0.12)'
}

const copyBtnDoneStyle = {
  color: '#b2ffdc',
  border: '1px solid rgba(79, 216, 144, 0.34)'
}

const tabNavStyle = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap'
}

const tabStyle = {
  flex: 1,
  minWidth: 100,
  padding: '10px 16px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  transition: 'all 0.2s ease'
}

const tabActiveStyle = {
  ...tabStyle,
  border: '1px solid rgba(122, 61, 255, 0.6)',
  background: 'linear-gradient(135deg, rgba(99, 0, 255, 0.3), rgba(122, 61, 255, 0.2))',
  color: '#fff'
}

const tabIconStyle = {
  fontSize: 14
}
