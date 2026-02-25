'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function isPlayableExt(ext) {
  const e = String(ext || '').toLowerCase()
  return e === '.mp3' || e === '.ogg' || e === '.webm'
}

function isMeetingJobRunning(job) {
  if (!job || typeof job !== 'object') return false
  const status = String(job.status || '').toLowerCase()
  return status === 'queued' || status === 'running'
}

function normalizeNoteViewUrl(rawUrl) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  const apiPrefix = '/api/meeting-notes/'
  if (value.startsWith(apiPrefix)) {
    const noteId = value.slice(apiPrefix.length).split('?')[0]
    if (noteId) return `/notes/${encodeURIComponent(noteId)}`
  }
  return value
}

export default function FileManagerClient({ origin, initialFiles }) {
  const router = useRouter()
  const [files, setFiles] = useState(Array.isArray(initialFiles) ? initialFiles : [])
  const [activeTab, setActiveTab] = useState('recording')
  const [loading, setLoading] = useState(false)
  const [busyMap, setBusyMap] = useState({})
  const [noteBusyMap, setNoteBusyMap] = useState({})
  const [noteJobMap, setNoteJobMap] = useState({})
  const [noteErrorLog, setNoteErrorLog] = useState('')
  const [message, setMessage] = useState('')
  const [player, setPlayer] = useState({ url: '', label: '', token: 0 })
  const audioRef = useRef(null)

  const grouped = useMemo(() => {
    const recording = []
    const test = []
    const opusArchive = []
    for (const item of files) {
      if (item && item.ext === '.opus') {
        opusArchive.push(item)
        continue
      }
      if (item && item.category === 'test') {
        test.push(item)
      } else {
        recording.push(item)
      }
    }
    return { recording, test, opusArchive }
  }, [files])

  async function refreshFiles() {
    setLoading(true)
    try {
      const res = await fetch('/api/files', { cache: 'no-store' })
      const data = await res.json()
      if (data && data.success && Array.isArray(data.files)) {
        setFiles(data.files)
      }
    } finally {
      setLoading(false)
    }
  }

  function setBusy(name, value) {
    setBusyMap(prev => ({ ...prev, [name]: value }))
  }

  function setNoteBusy(name, value) {
    setNoteBusyMap(prev => ({ ...prev, [name]: value }))
  }

  function setNoteJob(name, value) {
    setNoteJobMap(prev => ({ ...prev, [name]: value }))
  }

  async function deleteFile(fileName) {
    if (!fileName) return
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`确认删除文件: ${fileName} ?`)
      if (!ok) return
    }
    setBusy(fileName, true)
    setMessage('')
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(fileName)}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (!res.ok || !data || data.success !== true) {
        throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`)
      }
      const deletedText = Array.isArray(data.deleted) ? data.deleted.join(', ') : fileName
      setMessage(`已删除: ${deletedText}`)
      await refreshFiles()
    } catch (error) {
      setMessage(`删除失败: ${String(error.message || error)}`)
    } finally {
      setBusy(fileName, false)
    }
  }

  async function generateMeetingNote(fileName) {
    if (!fileName) return
    setNoteBusy(fileName, true)
    setNoteErrorLog('')
    setMessage('')
    try {
      const createRes = await fetch('/api/meeting-notes/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileName })
      })
      const createData = await createRes.json().catch(() => null)
      if (!createRes.ok || !createData || !createData.success || !createData.job) {
        throw new Error((createData && createData.error) ? createData.error : `HTTP ${createRes.status}`)
      }
      const jobId = createData.job.id
      setNoteJob(fileName, createData.job)

      for (let i = 0; i < 120; i += 1) {
        if (!jobId) break
        await new Promise(resolve => setTimeout(resolve, 2500))
        const statusRes = await fetch(`/api/meeting-notes/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const statusData = await statusRes.json().catch(() => null)
        if (!statusRes.ok || !statusData || !statusData.success || !statusData.job) {
          throw new Error((statusData && statusData.error) ? statusData.error : `HTTP ${statusRes.status}`)
        }
        const job = statusData.job
        setNoteJob(fileName, job)
        if (job.status === 'completed') {
          setMessage('会议纪要已生成')
          openMeetingNote(job)
          return
        }
        if (job.status === 'failed') {
          throw new Error(job.error || '纪要生成失败')
        }
      }
      throw new Error('纪要生成超时，请稍后重试')
    } catch (error) {
      const text = String(error && error.message ? error.message : error)
      setMessage(`纪要生成失败: ${text}`)
      setNoteErrorLog(text)
    } finally {
      setNoteBusy(fileName, false)
    }
  }

  function openMeetingNote(job) {
    const noteUrl = job && job.result && job.result.noteUrl ? String(job.result.noteUrl) : ''
    openMeetingNoteByUrl(noteUrl)
  }

  function openMeetingNoteByUrl(noteUrl) {
    const normalizedUrl = normalizeNoteViewUrl(noteUrl)
    if (!normalizedUrl) {
      setMessage('纪要已完成，但未找到查看链接')
      return
    }
    if (/^https?:\/\//i.test(normalizedUrl)) {
      if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
        window.location.assign(normalizedUrl)
      }
      return
    }
    router.push(normalizedUrl)
  }

  async function convertToMp3(fileName) {
    if (!fileName) return
    setBusy(fileName, true)
    setMessage('')
    try {
      const res = await fetch('/api/convert-mp3', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: fileName,
          overwrite: true
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.success !== true) {
        const errorText = data && data.error ? String(data.error) : `HTTP ${res.status}`
        throw new Error(errorText)
      }
      const outputName = data && data.filename ? data.filename : ''
      setMessage(outputName ? `转换完成: ${outputName}` : '转换完成')
      await refreshFiles()
    } catch (error) {
      const errorText = String(error && error.message ? error.message : error)
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(errorText)
      }
    } finally {
      setBusy(fileName, false)
    }
  }

  function play(url, label) {
    if (!url) return
    setPlayer({ url, label, token: Date.now() })
  }

  useEffect(() => {
    if (!player.url) return
    const audioEl = audioRef.current
    if (!audioEl || typeof audioEl.play !== 'function') return
    const playPromise = audioEl.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {})
    }
  }, [player.url, player.token])

  function renderActions(file, busy, noteBusy, noteJob) {
    const fileUrl = `/api/files/${encodeURIComponent(file.name)}`
    const isOpus = file.ext === '.opus'
    const canGenerateNote = isPlayableExt(file.ext) || isOpus
    const inMemoryNoteUrl = noteJob && noteJob.result && noteJob.result.noteUrl ? String(noteJob.result.noteUrl) : ''
    const persistedNoteUrl = file && file.latestNoteUrl ? String(file.latestNoteUrl) : ''
    const noteViewUrl = normalizeNoteViewUrl(inMemoryNoteUrl || persistedNoteUrl)

    return (
      <div style={actionBlockStyle}>
        <div style={actionPrimaryRowStyle}>
        {isOpus ? (
          <>
            <a href={fileUrl} download style={linkStyle} className="file-action-link">下载OPUS</a>
            <button
              style={actionBtnStyle}
              className="file-action-btn"
              onClick={() => convertToMp3(file.name)}
              disabled={busy}
            >
              {busy ? '转换中...' : '转换到MP3'}
            </button>
            <span style={disabledHintStyle} className="file-disabled-hint">归档兜底文件（仅恢复使用）</span>
          </>
        ) : (
          <a href={fileUrl} download style={linkStyle} className="file-action-link">下载</a>
        )}
        {isPlayableExt(file.ext) && (
          <button style={actionBtnStyle} className="file-action-btn" onClick={() => play(fileUrl, file.name)}>播放</button>
        )}
        {canGenerateNote && (
          <button
            style={noteBtnStyle}
            className="file-action-btn"
            onClick={() => generateMeetingNote(file.name)}
            disabled={noteBusy}
          >
            {noteBusy ? '纪要生成中...' : '一键生成会议纪要'}
          </button>
        )}
        {canGenerateNote && noteViewUrl && (
          <button
            style={noteBtnStyle}
            className="file-action-btn"
            onClick={() => openMeetingNoteByUrl(noteViewUrl)}
          >
            查看会议纪要
          </button>
        )}
        <button
          style={deleteBtnStyle}
          className="file-delete-btn"
          onClick={() => deleteFile(file.name)}
          disabled={busy}
        >
          删除
        </button>
        </div>
        {noteJob && (
          <div style={statusRowStyle}>
            <span style={statusBadgeStyle}>
              {noteJob.status === 'completed'
                ? '纪要已完成'
                : noteJob.status === 'failed'
                  ? `失败: ${noteJob.error || '未知错误'}`
                  : `处理中: ${noteJob.stage || noteJob.status}`}
            </span>
          </div>
        )}
      </div>
    )
  }

  const list = activeTab === 'test'
    ? grouped.test
    : (activeTab === 'opus_archive' ? grouped.opusArchive : grouped.recording)

  return (
    <>
      <div className="file-toolbar" style={{ marginBottom: 14, color: '#35575d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>共 {files.length} 个文件</div>
        <button onClick={refreshFiles} style={refreshBtnStyle} className="file-refresh-btn" disabled={loading}>
          {loading ? '刷新中...' : '刷新列表'}
        </button>
      </div>

      <div className="file-tab-row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveTab('recording')}
          style={activeTab === 'recording' ? tabActiveStyle : tabStyle}
          className="file-tab-btn"
        >
          录音文件 ({grouped.recording.length})
        </button>
        <button
          onClick={() => setActiveTab('test')}
          style={activeTab === 'test' ? tabActiveStyle : tabStyle}
          className="file-tab-btn"
        >
          测试文件 ({grouped.test.length})
        </button>
        <button
          onClick={() => setActiveTab('opus_archive')}
          style={activeTab === 'opus_archive' ? tabActiveStyle : tabStyle}
          className="file-tab-btn"
        >
          OPUS归档 ({grouped.opusArchive.length})
        </button>
      </div>

      {player.url && (
        <div style={playerCardStyle}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#444' }}>正在播放: {player.label}</div>
          <audio
            key={`${player.url}#${player.token}`}
            ref={audioRef}
            controls
            autoPlay
            preload="metadata"
            src={player.url}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {message && (
        <div style={messageStyle}>{message}</div>
      )}
      {noteErrorLog && (
        <div style={errorLogCardStyle}>
          <div style={errorLogTitleStyle}>纪要生成错误日志</div>
          <pre style={errorLogPreStyle}>{noteErrorLog}</pre>
        </div>
      )}

      {list.length === 0 ? (
        <div style={emptyStyle}>
          当前 Tab 暂无文件
        </div>
      ) : (
        <div className="responsive-table-wrap" style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={headerStyle}>文件名</th>
                <th style={headerStyle}>大小</th>
                <th style={headerStyle}>上传时间</th>
                <th style={headerStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((file) => {
                const busy = !!busyMap[file.name]
                const inMemoryNoteJob = noteJobMap[file.name] || null
                const persistedNoteJob = file && file.latestMeetingJob && typeof file.latestMeetingJob === 'object'
                  ? file.latestMeetingJob
                  : null
                const noteJob = inMemoryNoteJob || persistedNoteJob
                const noteBusy = !!noteBusyMap[file.name] || isMeetingJobRunning(noteJob)
                return (
                  <tr key={file.name} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={fileNameCellStyle}>{file.name}</td>
                    <td style={cellStyle}>{file.sizeFormatted}</td>
                    <td style={cellStyle}>{formatDate(file.createdAt)}</td>
                    <td style={cellStyle}>
                      <div style={desktopActionsWrapStyle} className="file-actions">
                        {renderActions(file, busy, noteBusy, noteJob)}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 18, color: '#60797f', fontSize: 12 }}>
        当前服务地址: {origin}
      </div>
    </>
  )
}

const actionBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  width: '100%'
}

const actionPrimaryRowStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8
}

const statusRowStyle = {
  width: '100%'
}

const tableStyle = {
  width: '100%',
  minWidth: 640,
  borderCollapse: 'collapse',
  background: 'rgba(255,255,255,0.82)',
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 10px 24px rgba(28, 52, 58, 0.09)',
  border: '1px solid rgba(35, 74, 79, 0.11)'
}

const tableWrapStyle = {
  width: '100%',
  overflowX: 'auto',
  borderRadius: 14
}

const headerStyle = {
  padding: '12px 14px',
  textAlign: 'left',
  fontSize: 11,
  color: '#4c6b70',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
}

const cellStyle = {
  padding: '12px 14px',
  fontSize: 14,
  color: '#223c42'
}

const fileNameCellStyle = {
  ...cellStyle,
  maxWidth: 360,
  wordBreak: 'break-all'
}

const linkStyle = {
  color: '#0e6f8a',
  textDecoration: 'none',
  marginRight: 8,
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 0',
  minHeight: 44
}

const disabledHintStyle = {
  marginRight: 8,
  fontSize: 12,
  color: '#8d8f92',
  background: '#f3f3f1',
  border: '1px dashed #d2d2ce',
  borderRadius: 999,
  padding: '7px 10px'
}

const actionBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(23, 88, 97, 0.35)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3fbfd 100%)',
  color: '#1f6674',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  cursor: 'pointer',
  fontWeight: 700
}

const deleteBtnStyle = {
  fontSize: 13,
  border: '1px solid #f3adad',
  background: 'linear-gradient(180deg, #fff6f5 0%, #ffe9e7 100%)',
  color: '#ad3232',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  cursor: 'pointer',
  fontWeight: 700
}

const noteBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(88, 84, 201, 0.34)',
  background: 'linear-gradient(135deg, rgba(126, 214, 255, 0.25), rgba(255, 188, 138, 0.26))',
  color: '#2f436f',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  cursor: 'pointer',
  fontWeight: 700
}

const statusBadgeStyle = {
  fontSize: 12,
  color: '#3a5660',
  border: '1px solid rgba(45, 94, 103, 0.2)',
  background: 'rgba(255,255,255,0.8)',
  borderRadius: 999,
  padding: '7px 10px',
  maxWidth: '100%',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  lineHeight: 1.45
}

const tabStyle = {
  border: '1px solid rgba(39, 74, 80, 0.18)',
  background: 'rgba(255,255,255,0.72)',
  color: '#25464d',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer'
}

const tabActiveStyle = {
  ...tabStyle,
  border: '1px solid rgba(9, 107, 103, 0.5)',
  background: 'linear-gradient(135deg, rgba(8, 142, 135, 0.19), rgba(246, 178, 84, 0.2))',
  color: '#194f55',
  boxShadow: '0 4px 12px rgba(30, 79, 83, 0.12)'
}

const emptyStyle = {
  textAlign: 'center',
  padding: 60,
  color: '#6f8488',
  background: 'rgba(255,255,255,0.62)',
  borderRadius: 14,
  border: '1px solid rgba(35, 71, 77, 0.12)'
}

const playerCardStyle = {
  background: 'linear-gradient(132deg, rgba(10, 138, 132, 0.15), rgba(255,255,255,0.9))',
  border: '1px solid rgba(10, 134, 126, 0.33)',
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
  boxShadow: '0 8px 20px rgba(28, 74, 78, 0.11)'
}

const messageStyle = {
  background: 'linear-gradient(180deg, #fffdf5 0%, #fff7db 100%)',
  border: '1px solid #f0d889',
  borderRadius: 12,
  padding: 10,
  marginBottom: 12,
  color: '#866020',
  fontSize: 13
}

const errorLogCardStyle = {
  width: '100%',
  background: 'linear-gradient(180deg, #fff5f5 0%, #ffecec 100%)',
  border: '1px solid #efb4b4',
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
  color: '#7e2b2b',
  boxSizing: 'border-box'
}

const errorLogTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 8
}

const errorLogPreStyle = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 260,
  overflowY: 'auto'
}

const refreshBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(22, 83, 89, 0.27)',
  background: 'linear-gradient(180deg, #ffffff 0%, #eef7f9 100%)',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  cursor: 'pointer',
  color: '#244f57',
  fontWeight: 700
}

const desktopActionsWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8
}
