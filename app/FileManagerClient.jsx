'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function isPlayableExt(ext) {
  const e = String(ext || '').toLowerCase()
  return e === '.mp3' || e === '.wav' || e === '.ogg' || e === '.webm'
}

export default function FileManagerClient({ origin, initialFiles }) {
  const [files, setFiles] = useState(Array.isArray(initialFiles) ? initialFiles : [])
  const [activeTab, setActiveTab] = useState('recording')
  const [loading, setLoading] = useState(false)
  const [busyMap, setBusyMap] = useState({})
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

  async function convertToWav(fileName) {
    if (!fileName) return
    setBusy(fileName, true)
    setMessage('')
    try {
      const res = await fetch('/api/convert-wav', {
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

  function renderActions(file, busy) {
    const fileUrl = `/api/files/${encodeURIComponent(file.name)}`
    const isOpus = file.ext === '.opus'
    const isWav = file.ext === '.wav'

    return (
      <>
        {isOpus ? (
          <>
            <a href={fileUrl} download style={linkStyle} className="file-action-link">下载OPUS</a>
            <button
              style={actionBtnStyle}
              className="file-action-btn"
              onClick={() => convertToWav(file.name)}
              disabled={busy}
            >
              {busy ? '转换中...' : '转换到WAV'}
            </button>
            <span style={disabledHintStyle} className="file-disabled-hint">归档兜底文件（仅恢复使用）</span>
          </>
        ) : isWav ? (
          <a href={fileUrl} download style={linkStyle} className="file-action-link">
            下载WAV
          </a>
        ) : (
          <a href={fileUrl} download style={linkStyle} className="file-action-link">下载</a>
        )}
        {isPlayableExt(file.ext) && (
          <button style={actionBtnStyle} className="file-action-btn" onClick={() => play(fileUrl, file.name)}>播放</button>
        )}
        <button
          style={deleteBtnStyle}
          className="file-delete-btn"
          onClick={() => deleteFile(file.name)}
          disabled={busy}
        >
          删除
        </button>
      </>
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
                return (
                  <tr key={file.name} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={fileNameCellStyle}>{file.name}</td>
                    <td style={cellStyle}>{file.sizeFormatted}</td>
                    <td style={cellStyle}>{formatDate(file.createdAt)}</td>
                    <td style={cellStyle}>
                      <div style={desktopActionsWrapStyle} className="file-actions">
                        {renderActions(file, busy)}
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
