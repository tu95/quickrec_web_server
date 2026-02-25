'use client'

import { useState } from 'react'
import styles from './note-viewer.module.css'

function pickErrorText(data, status) {
  if (data && typeof data === 'object') {
    const text = String(data.error || data.message || '').trim()
    if (text) return text
  }
  return `HTTP ${status}`
}

export default function AsrArchivePanel({ noteId, asrArchiveUrl, hasAsrArchive }) {
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const [error, setError] = useState('')
  const [archive, setArchive] = useState(null)

  async function loadArchive() {
    if (!hasAsrArchive) {
      throw new Error('当前纪要没有 ASR 原文存档')
    }
    const url = String(asrArchiveUrl || '').trim() || `/api/meeting-notes/${encodeURIComponent(noteId)}/asr`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.success || !data?.asr) {
      throw new Error(pickErrorText(data, res.status))
    }
    const next = data.asr && typeof data.asr === 'object' ? data.asr : {}
    setArchive(next)
    return next
  }

  async function toggleOpen() {
    if (open) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (!archive) {
        await loadArchive()
      }
      setOpen(true)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function copyArchive() {
    setCopyBusy(true)
    setCopyDone(false)
    setError('')
    try {
      const next = archive || await loadArchive()
      const transcript = String(next?.transcript || '')
      if (!transcript.trim()) {
        throw new Error('ASR 原文为空，无法复制')
      }
      if (!navigator?.clipboard?.writeText) {
        throw new Error('当前浏览器不支持剪贴板 API')
      }
      await navigator.clipboard.writeText(transcript)
      setCopyDone(true)
      window.setTimeout(() => setCopyDone(false), 1200)
      setOpen(true)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setCopyBusy(false)
    }
  }

  const transcript = String(archive?.transcript || '')
  const transcriptChars = Number(archive?.transcriptChars || transcript.length || 0)
  const transcriptCharsText = Number.isFinite(transcriptChars) && transcriptChars > 0
    ? `${transcriptChars.toLocaleString('zh-CN')} 字`
    : '未知'

  return (
    <section className={styles.asrCard}>
      <div className={styles.asrHeader}>
        <div className={styles.asrTitleWrap}>
          <h2 className={styles.asrTitle}>ASR 原文存档</h2>
          <p className={styles.asrHint}>保留模型总结前的原始转写结果，可直接复制。</p>
        </div>
        <div className={styles.asrActions}>
          <button
            type="button"
            className={styles.asrActionBtn}
            onClick={toggleOpen}
            disabled={busy || copyBusy || !hasAsrArchive}
          >
            {busy ? '加载中...' : (open ? '收起 ASR 原文' : '查看 ASR 原文')}
          </button>
          <button
            type="button"
            className={`${styles.asrActionBtn} ${copyDone ? styles.asrActionBtnDone : ''}`}
            onClick={copyArchive}
            disabled={busy || copyBusy || !hasAsrArchive}
          >
            {copyBusy ? '复制中...' : (copyDone ? '已复制' : '复制 ASR 原文')}
          </button>
        </div>
      </div>
      {open && (
        <div className={styles.asrBody}>
          <div className={styles.asrMeta}>转写长度: {transcriptCharsText}</div>
          <pre className={styles.asrText}>{transcript || '无可用原文'}</pre>
        </div>
      )}
      {error && (
        <pre className={styles.asrError}>{error}</pre>
      )}
    </section>
  )
}
