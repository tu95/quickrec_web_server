'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import styles from './note-viewer.module.css'

function pickErrorText(data, status) {
  if (data && typeof data === 'object') {
    const text = String(data.error || data.message || '').trim()
    if (text) return text
  }
  return `HTTP ${status}`
}

export default function AsrArchivePanel({ noteId, asrArchiveUrl, hasAsrArchive }) {
  const t = useTranslations('notes')
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const [error, setError] = useState('')
  const [archive, setArchive] = useState(null)

  async function loadArchive() {
    if (!hasAsrArchive) {
      throw new Error(t('asrNoArchive'))
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
        throw new Error(t('asrEmpty'))
      }
      if (!navigator?.clipboard?.writeText) {
        throw new Error(t('asrClipboardUnsupported'))
      }
      await navigator.clipboard.writeText(transcript)
      setCopyDone(true)
      window.setTimeout(() => setCopyDone(false), 1200)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setCopyBusy(false)
    }
  }

  const transcript = String(archive?.transcript || '')
  const transcriptChars = Number(archive?.transcriptChars || transcript.length || 0)
  const transcriptCharsText = Number.isFinite(transcriptChars) && transcriptChars > 0
    ? t('charCount', { count: transcriptChars.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') })
    : t('unknown')

  return (
    <section className={styles.asrCard}>
      <div className={styles.asrHeader}>
        <div className={styles.asrTitleWrap}>
          <h2 className={styles.asrTitle}>{t('asrTitle')}</h2>
          <p className={styles.asrHint}>{t('asrHint')}</p>
        </div>
        <div className={styles.asrActions}>
          <button
            type="button"
            className={styles.asrActionBtn}
            onClick={toggleOpen}
            disabled={busy || copyBusy || !hasAsrArchive}
          >
            {busy ? t('asrLoading') : (open ? t('asrCollapse') : t('asrExpand'))}
          </button>
          <button
            type="button"
            className={`${styles.asrActionBtn} ${copyDone ? styles.asrActionBtnDone : ''}`}
            onClick={copyArchive}
            disabled={busy || copyBusy || !hasAsrArchive}
          >
            {copyBusy ? t('asrCopying') : (copyDone ? t('asrCopied') : t('asrCopy'))}
          </button>
        </div>
      </div>
      {open && (
        <div className={styles.asrBody}>
          <div className={styles.asrMeta}>{t('asrLengthLabel')} {transcriptCharsText}</div>
          <pre className={styles.asrText}>{transcript || t('asrNoText')}</pre>
        </div>
      )}
      {error && (
        <pre className={styles.asrError}>{error}</pre>
      )}
    </section>
  )
}
