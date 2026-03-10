'use client'

import { useEffect, useState } from 'react'
import ConfigEditorForm from './config-editor-form'

const USER_SYSTEM_DEFAULT_ID = '__system_default__'

// 服务类型
const SERVICE_TYPES = [
  { key: 'oss', label: 'OSS 存储', icon: '📦' },
  { key: 'asr', label: 'ASR 语音识别', icon: '🎙️' },
  { key: 'llm', label: 'LLM 大模型', icon: '🤖' },
  { key: 'prompt', label: '会议纪要 Prompt', icon: '📝' }
]

export default function ConfigProfilesManager({
  mode = 'user',
  title,
  subtitle,
  hideAccess = false,
  allowTesting = false,
  hideHeader = false
}) {
  const [loading, setLoading] = useState(true)
  const [busyMap, setBusyMap] = useState({})
  const [saveBusy, setSaveBusy] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [systemDefaultProfile, setSystemDefaultProfile] = useState(null)
  const [selectedService, setSelectedService] = useState('oss') // oss, asr, llm
  const [selectedId, setSelectedId] = useState('') // 当前选中的配置 ID
  const [selectedName, setSelectedName] = useState('')
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void loadProfiles()
  }, [mode])

  function redirectToLogin() {
    if (typeof window === 'undefined') return
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search || ''}`)
    window.location.href = `/login?next=${next}`
  }

  function handleAuthFailure(status) {
    if (Number(status) !== 401) return false
    redirectToLogin()
    return true
  }

  function isAdminMode() {
    return mode === 'admin'
  }

  function getListEndpoint() {
    return isAdminMode() ? '/api/admin/config-profiles' : '/api/user/config-profiles'
  }

  function getCreateEndpoint() {
    return getListEndpoint()
  }

  function getItemEndpoint(id) {
    return `${getListEndpoint()}/${encodeURIComponent(String(id || '').trim())}`
  }

  function getActivateEndpoint(id) {
    return `${getItemEndpoint(id)}/activate`
  }

  function getActiveProfileId(nextProfiles, nextSystemDefaultProfile, payload = null) {
    if (isAdminMode()) {
      return String(payload?.defaultProfileId || nextProfiles.find(item => item.isDefault)?.id || nextProfiles[0]?.id || '')
    }
    return String(payload?.activeProfileId || nextProfiles.find(item => item.isActive)?.id || (nextSystemDefaultProfile ? USER_SYSTEM_DEFAULT_ID : ''))
  }

  function applyProfiles(payload) {
    const nextProfiles = Array.isArray(payload?.profiles) ? payload.profiles : []
    const nextSystemDefaultProfile = payload?.systemDefaultProfile || null
    const activeProfileId = getActiveProfileId(nextProfiles, nextSystemDefaultProfile, payload)
    setProfiles(nextProfiles)
    setSystemDefaultProfile(nextSystemDefaultProfile)
    setSelectedId(activeProfileId)

    if (activeProfileId === USER_SYSTEM_DEFAULT_ID) {
      setSelectedName(String(nextSystemDefaultProfile?.name || '系统默认服务'))
      setSelectedConfig(nextSystemDefaultProfile?.config || null)
      return
    }

    const target = nextProfiles.find(item => item.id === activeProfileId) || nextProfiles[0] || null
    setSelectedName(String(target?.name || '').trim())
    setSelectedConfig(target?.config || null)
  }

  async function loadProfiles() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(getListEndpoint(), { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (handleAuthFailure(res.status)) return
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `加载失败: HTTP ${res.status}`)
      }
      applyProfiles(data)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  function syncSelectedProfile(nextProfile) {
    const safeProfile = nextProfile && typeof nextProfile === 'object' ? nextProfile : null
    if (!safeProfile) return
    setProfiles(prev => prev.map(item => (item.id === safeProfile.id ? safeProfile : item)))
    setSelectedId(String(safeProfile.id || ''))
    setSelectedName(String(safeProfile.name || '').trim())
    setSelectedConfig(safeProfile.config || null)
  }

  async function createProfile() {
    setBusyMap(prev => ({ ...prev, create: true }))
    setError('')
    setMessage('')
    try {
      const res = await fetch(getCreateEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' })
      })
      const data = await res.json().catch(() => null)
      if (handleAuthFailure(res.status)) return
      if (!res.ok || !data?.success || !data?.profile) {
        throw new Error(data?.error || `创建失败: HTTP ${res.status}`)
      }
      await loadProfiles()
      syncSelectedProfile(data.profile)
      setMessage('已新增自定义配置')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusyMap(prev => ({ ...prev, create: false }))
    }
  }

  async function activateProfile(nextId) {
    const id = String(nextId || '').trim()
    setBusyMap(prev => ({ ...prev, activate: true }))
    setError('')
    setMessage('')
    try {
      if (!isAdminMode() && id === USER_SYSTEM_DEFAULT_ID) {
        const res = await fetch('/api/user/config-profiles/activate-default', { method: 'POST' })
        const data = await res.json().catch(() => null)
        if (handleAuthFailure(res.status)) return
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `切换失败: HTTP ${res.status}`)
        }
        await loadProfiles()
        setSelectedId(USER_SYSTEM_DEFAULT_ID)
        setSelectedName(String(systemDefaultProfile?.name || '系统默认服务'))
        setSelectedConfig(systemDefaultProfile?.config || null)
        setMessage('已切换到系统默认服务')
        return
      }

      const res = await fetch(getActivateEndpoint(id), { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (handleAuthFailure(res.status)) return
      if (!res.ok || !data?.success || !data?.profile) {
        throw new Error(data?.error || `切换失败: HTTP ${res.status}`)
      }
      await loadProfiles()
      syncSelectedProfile(data.profile)
      setMessage(isAdminMode() ? '系统默认配置已切换' : '当前生效配置已切换')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusyMap(prev => ({ ...prev, activate: false }))
    }
  }

  async function saveSelectedProfile(nextPayloadConfig) {
    const id = String(selectedId || '').trim()
    if (!id || id === USER_SYSTEM_DEFAULT_ID) {
      throw new Error('请先选择一条可编辑配置')
    }
    setSaveBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(getItemEndpoint(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedName,
          config: nextPayloadConfig
        })
      })
      const data = await res.json().catch(() => null)
      if (handleAuthFailure(res.status)) {
        throw new Error('登录已失效，请重新登录')
      }
      if (!res.ok || !data?.success || !data?.profile) {
        throw new Error(data?.error || `保存失败: HTTP ${res.status}`)
      }
      syncSelectedProfile(data.profile)
      await loadProfiles()
      return data.profile.config
    } finally {
      setSaveBusy(false)
    }
  }

  async function deleteSelectedProfile() {
    const id = String(selectedId || '').trim()
    if (!id || id === USER_SYSTEM_DEFAULT_ID) return
    setBusyMap(prev => ({ ...prev, delete: true }))
    setError('')
    setMessage('')
    try {
      const res = await fetch(getItemEndpoint(id), { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (handleAuthFailure(res.status)) return
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `删除失败: HTTP ${res.status}`)
      }
      // 重置选中状态
      setSelectedId('')
      setSelectedName('')
      setSelectedConfig(null)
      await loadProfiles()
      setMessage('配置已删除')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusyMap(prev => ({ ...prev, delete: false }))
    }
  }

  function selectForEditing(profile) {
    if (!profile) return
    setSelectedId(String(profile.id || ''))
    setSelectedName(String(profile.name || '').trim())
    setSelectedConfig(profile.config || null)
  }

  // 选择服务类型 + 配置
  function selectServiceAndProfile(serviceKey, profileId) {
    setSelectedService(serviceKey)
    if (profileId === USER_SYSTEM_DEFAULT_ID) {
      setSelectedId(USER_SYSTEM_DEFAULT_ID)
      setSelectedName('系统默认')
      setSelectedConfig(systemDefaultProfile?.config || null)
    } else {
      const profile = profiles.find(p => p.id === profileId)
      if (profile) {
        setSelectedId(profileId)
        setSelectedName(String(profile.name || '').trim())
        setSelectedConfig(profile.config || null)
      }
    }
  }

  // 获取当前选中配置的摘要信息
  function getProfileSummary(profile, serviceKey) {
    if (!profile?.config) return {}
    const cfg = profile.config
    if (serviceKey === 'oss') {
      return { text: cfg?.aliyun?.oss?.bucket || '-' }
    }
    if (serviceKey === 'asr') {
      return { text: cfg?.aliyun?.asr?.model || '-' }
    }
    if (serviceKey === 'llm') {
      const providers = cfg?.llm?.providers || []
      const enabled = providers.filter(p => p.enabled !== false).length
      return { text: `${enabled}/${providers.length} 提供商` }
    }
    if (serviceKey === 'prompt') {
      const prompts = cfg?.prompts?.items || []
      const enabled = prompts.filter(p => p.enabled !== false).length
      return { text: `${enabled}/${prompts.length} Prompt` }
    }
    return {}
  }

  if (loading) {
    return <div className="ui-notice">配置加载中...</div>
  }

  const selectedIsSystemDefault = selectedId === USER_SYSTEM_DEFAULT_ID
  const selectedReadonly = !isAdminMode() && selectedIsSystemDefault
  const selectedProfile = profiles.find(item => item.id === selectedId) || null

  // 当前服务类型的活跃配置
  const activeProfileForService = selectedIsSystemDefault
    ? systemDefaultProfile
    : selectedProfile

  return (
    <section>
      {!hideHeader ? (
        <div style={headStyle}>
          <div>
            <h3 style={titleStyle}>{title}</h3>
            {subtitle ? <p style={subtitleStyle}>{subtitle}</p> : null}
          </div>
        </div>
      ) : null}

      {message && <div className="ui-notice ui-notice-success">{message}</div>}
      {error && <div className="ui-notice ui-notice-error">{error}</div>}

      <div className="config-profiles-layout" style={layoutStyle}>
        <aside className="config-profiles-sidebar" style={sidebarStyle}>
          <div style={sidebarTopStyle}>
            <div style={sidebarTitleWrapStyle}>
              <div style={sidebarEyebrowStyle}>Service Config</div>
              <div style={sidebarTitleStyle}>服务配置</div>
            </div>
          </div>

          {/* 服务类型分组 */}
          {SERVICE_TYPES.map(service => {
            const serviceKey = service.key
            const isServiceSelected = selectedService === serviceKey
            return (
              <div key={serviceKey} style={serviceGroupStyle}>
                <button
                  type="button"
                  style={isServiceSelected ? serviceGroupHeaderActiveStyle : serviceGroupHeaderStyle}
                  onClick={() => selectServiceAndProfile(serviceKey, USER_SYSTEM_DEFAULT_ID)}
                >
                  <span style={serviceIconStyle}>{service.icon}</span>
                  <span style={serviceLabelStyle}>{service.label}</span>
                </button>

                {isServiceSelected && (
                  <div style={serviceItemsStyle}>
                    {/* 默认配置（只读） */}
                    {!isAdminMode() && systemDefaultProfile && (
                      <button
                        type="button"
                        style={selectedId === USER_SYSTEM_DEFAULT_ID ? serviceItemActiveStyle : serviceItemStyle}
                        onClick={() => selectServiceAndProfile(serviceKey, USER_SYSTEM_DEFAULT_ID)}
                      >
                        <span style={radioDotStyle(selectedId === USER_SYSTEM_DEFAULT_ID)}></span>
                        <span style={itemLabelStyle}>默认配置</span>
                        <span style={readonlyPillStyle}>只读</span>
                      </button>
                    )}

                    {/* 个人配置列表 */}
                    {profiles.map(profile => {
                      const summary = getProfileSummary(profile, serviceKey)
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          style={selectedId === profile.id ? serviceItemActiveStyle : serviceItemStyle}
                          onClick={() => selectServiceAndProfile(serviceKey, profile.id)}
                        >
                          <span style={radioDotStyle(selectedId === profile.id)}></span>
                          <span style={itemLabelStyle}>{profile.name}</span>
                          <span style={itemMetaStyle}>{summary.text}</span>
                        </button>
                      )
                    })}

                    {/* 新增配置按钮 */}
                    <button
                      type="button"
                      style={addBtnStyle}
                      onClick={createProfile}
                      disabled={busyMap.create}
                    >
                      + 新增配置
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </aside>

        <div className="config-profiles-editor" style={editorWrapStyle}>
          <div style={editorHeadStyle}>
            <div>
              <div style={editorEyebrowStyle}>{selectedReadonly ? '只读' : '自定义配置'}</div>
              <h4 style={editorTitleStyle}>
                {selectedName || (selectedReadonly ? '默认配置' : '请选择配置或新增')}
              </h4>
              <p style={editorDescStyle}>
                {selectedReadonly
                  ? '系统默认配置，仅可查看。'
                  : '自定义配置，保存后生效。'}
              </p>
            </div>
          </div>

          {selectedReadonly ? (
            <>
              {systemDefaultProfile && (
                <div style={readonlyCardStyle}>
                  <div style={readonlyBadgeStyle}>系统默认</div>
                  <div style={readonlyTextStyle}>
                    {selectedService === 'oss' && 'OSS 存储使用系统默认配置。'}
                    {selectedService === 'asr' && 'ASR 转写使用系统默认配置。'}
                    {selectedService === 'llm' && 'LLM 大模型使用系统默认配置。'}
                    {selectedService === 'prompt' && '会议纪要 Prompt 使用系统默认配置。'}
                  </div>
                </div>
              )}
              <ConfigEditorForm
                config={selectedConfig}
                setConfig={setSelectedConfig}
                onSave={saveSelectedProfile}
                saveBusy={saveBusy}
                readOnly={true}
                hideAccess={hideAccess}
                allowTesting={allowTesting}
                testApiScope={isAdminMode() ? 'admin' : 'user'}
                profileId=""
                profileScope={isAdminMode() ? 'system' : 'user'}
                activeTab={selectedService}
              />
            </>
          ) : selectedProfile ? (
            <>
              <label className="ui-label" htmlFor={`${mode}-profile-name`}>自定义配置名称</label>
              <input
                id={`${mode}-profile-name`}
                className="ui-input"
                value={selectedName}
                onChange={e => setSelectedName(e.target.value)}
                placeholder="请输入自定义配置名称"
              />
              <div style={actionRowStyle}>
                <button type="button" className="ui-btn ui-btn-danger" onClick={deleteSelectedProfile} disabled={busyMap.delete || !selectedId}>
                  {busyMap.delete ? '删除中...' : '删除配置'}
                </button>
                <button type="button" className="ui-btn ui-btn-primary" onClick={() => saveSelectedProfile(selectedConfig)} disabled={saveBusy}>
                  {saveBusy ? '保存中...' : '保存配置'}
                </button>
              </div>
              <ConfigEditorForm
                config={selectedConfig}
                setConfig={setSelectedConfig}
                onSave={saveSelectedProfile}
                saveBusy={saveBusy}
                readOnly={false}
                hideAccess={hideAccess}
                allowTesting={allowTesting}
                testApiScope={isAdminMode() ? 'admin' : 'user'}
                profileId={selectedProfile?.id || ''}
                profileScope={isAdminMode() ? 'system' : 'user'}
                saveLabel="保存配置"
                activeTab={selectedService}
                hideSaveButton={true}
              />
            </>
          ) : (
            <div style={emptyStateStyle}>
              <div style={emptyStateTitleStyle}>请选择配置</div>
              <div style={emptyStateTextStyle}>从左侧选择服务类型，然后选择或新增配置。</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

const headStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 14
}

const titleStyle = {
  margin: 0,
  color: '#f2f0ff',
  fontSize: 20,
  fontWeight: 800
}

const subtitleStyle = {
  margin: '6px 0 0',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 13
}

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: '320px minmax(0, 1fr)',
  gap: 18,
  alignItems: 'start'
}

const sidebarStyle = {
  display: 'grid',
  gap: 10,
  alignContent: 'start',
  padding: 14,
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
  border: '1px solid rgba(255,255,255,0.1)',
  position: 'sticky',
  top: 16
}

const sidebarTopStyle = {
  display: 'grid',
  gap: 12,
  marginBottom: 6
}

const sidebarTitleWrapStyle = {
  display: 'grid',
  gap: 4
}

const sidebarEyebrowStyle = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(160,196,255,0.72)'
}

const sidebarTitleStyle = {
  color: '#f6f3ff',
  fontSize: 18,
  fontWeight: 800
}

const editorWrapStyle = {
  display: 'grid',
  gap: 12,
  minWidth: 0,
  padding: 18,
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))',
  border: '1px solid rgba(255,255,255,0.1)'
}

const itemStyle = {
  textAlign: 'left',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 14,
  padding: 14,
  background: 'rgba(255,255,255,0.04)',
  color: '#f0f2ff',
  cursor: 'pointer',
  width: '100%'
}

const activeItemStyle = {
  ...itemStyle,
  border: '1px solid rgba(154, 197, 255, 0.42)',
  background: 'linear-gradient(135deg, rgba(83,116,214,0.26), rgba(45,21,77,0.42))'
}

const itemRadioRowStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 8
}

const itemLabelStyle = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const itemMetaStyle = {
  fontSize: 12,
  color: 'rgba(255,255,255,0.64)',
  lineHeight: 1.5
}

const readonlyPillStyle = {
  fontSize: 11,
  color: '#d9e8ff',
  border: '1px solid rgba(154, 197, 255, 0.28)',
  background: 'rgba(88, 124, 214, 0.18)',
  padding: '3px 8px',
  borderRadius: 999
}

const editorHeadStyle = {
  display: 'grid',
  gap: 4
}

const editorEyebrowStyle = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(160,196,255,0.72)'
}

const editorTitleStyle = {
  margin: 0,
  color: '#f5f2ff',
  fontSize: 22,
  fontWeight: 800
}

const editorDescStyle = {
  margin: '4px 0 0',
  color: 'rgba(255,255,255,0.68)',
  fontSize: 13,
  lineHeight: 1.6
}

const readonlyCardStyle = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 16,
  padding: 16,
  background: 'linear-gradient(135deg, rgba(83,116,214,0.14), rgba(45,21,77,0.28))',
  color: '#f0f2ff'
}

const readonlyBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(88, 124, 214, 0.2)',
  border: '1px solid rgba(154, 197, 255, 0.28)',
  color: '#dbe8ff',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 10
}

const readonlyTextStyle = {
  color: 'rgba(255,255,255,0.76)',
  lineHeight: 1.7,
  fontSize: 14
}

const emptyStateStyle = {
  minHeight: 220,
  borderRadius: 18,
  border: '1px dashed rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.02)',
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  padding: 24
}

const emptyStateTitleStyle = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f4f1ff',
  marginBottom: 6
}

const emptyStateTextStyle = {
  color: 'rgba(255,255,255,0.68)',
  lineHeight: 1.6,
  maxWidth: 420
}

// 服务分组样式
const serviceGroupStyle = {
  marginBottom: 8
}

const serviceGroupHeaderStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.8)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'left'
}

const serviceGroupHeaderActiveStyle = {
  ...serviceGroupHeaderStyle,
  border: '1px solid rgba(122, 61, 255, 0.4)',
  background: 'linear-gradient(135deg, rgba(99, 0, 255, 0.2), rgba(122, 61, 255, 0.1))',
  color: '#fff'
}

const serviceIconStyle = {
  fontSize: 16
}

const serviceLabelStyle = {
  flex: 1
}

const serviceItemsStyle = {
  display: 'grid',
  gap: 4,
  marginTop: 6,
  marginLeft: 24
}

const serviceItemStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(255,255,255,0.02)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left'
}

const serviceItemActiveStyle = {
  ...serviceItemStyle,
  border: '1px solid rgba(154, 197, 255, 0.4)',
  background: 'linear-gradient(135deg, rgba(83,116,214,0.2), rgba(45,21,77,0.2))',
  color: '#fff'
}

function radioDotStyle(selected) {
  return {
    width: 10,
    height: 10,
    borderRadius: '50%',
    border: selected ? '3px solid #7a3dff' : '2px solid rgba(255,255,255,0.4)',
    background: selected ? '#7a3dff' : 'transparent',
    flexShrink: 0
  }
}

const addBtnStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px dashed rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.02)',
  color: 'rgba(255,255,255,0.5)',
  fontSize: 13,
  cursor: 'pointer',
  marginTop: 4
}

// 服务标签页样式
const serviceTabsStyle = {
  display: 'flex',
  gap: 8,
  marginBottom: 16,
  flexWrap: 'wrap'
}

const serviceTabStyle = {
  flex: 1,
  minWidth: 80,
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.6)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'center'
}

const serviceTabActiveStyle = {
  ...serviceTabStyle,
  border: '1px solid rgba(122, 61, 255, 0.5)',
  background: 'linear-gradient(135deg, rgba(99, 0, 255, 0.25), rgba(122, 61, 255, 0.15))',
  color: '#fff'
}

const actionRowStyle = {
  display: 'flex',
  gap: 12,
  justifyContent: 'flex-end'
}
