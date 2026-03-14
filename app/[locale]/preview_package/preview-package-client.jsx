'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import styles from './preview-package.module.css'

function formatDateTime(value, locale) {
  const text = String(value || '').trim()
  if (!text) return '-'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

function asArray(input) {
  return Array.isArray(input) ? input : []
}

function safeText(input, fallback = '-') {
  const value = String(input ?? '').trim()
  return value || fallback
}

export default function PreviewPackageClient({ initialPayload }) {
  const t = useTranslations('previewPackage')
  const locale = useLocale()
  const payload = initialPayload && typeof initialPayload === 'object'
    ? initialPayload
    : { version: '', generatedAt: '', totalCount: 0, successCount: 0, failureCount: 0, entries: [], error: '' }
  const [selectedDevice, setSelectedDevice] = useState('')

  const deviceOptions = useMemo(() => {
    const map = new Map()
    asArray(payload.entries).forEach(item => {
      const model = safeText(item.model)
      if (model && model !== '-') {
        map.set(model, item)
      }
    })
    return Array.from(map.values()).sort((a, b) =>
      safeText(a.model).localeCompare(safeText(b.model))
    )
  }, [payload.entries])

  const selectedEntry = useMemo(() => {
    if (!selectedDevice) return null
    return deviceOptions.find(item => safeText(item.model) === selectedDevice) || null
  }, [selectedDevice, deviceOptions])

  return (
    <>
      <section className={styles.summaryMetaRow}>
        <div className={styles.pill}>{t('version')} <strong>{safeText(payload.version)}</strong></div>
        <div className={styles.pill}>{t('updatedAt')} <strong>{formatDateTime(payload.generatedAt, locale)}</strong></div>
      </section>

      <section className={styles.summaryCountRow}>
        <div className={styles.pill}>{t('success')} <strong>{Number(payload.successCount || 0)}</strong></div>
        <div className={styles.pill}>{t('failure')} <strong>{Number(payload.failureCount || 0)}</strong></div>
        <div className={styles.pill}>{t('total')} <strong>{Number(payload.totalCount || 0)}</strong></div>
      </section>

      <section className={styles.searchWrap}>
        <select
          className={styles.searchInput}
          value={selectedDevice}
          onChange={e => setSelectedDevice(e.target.value)}
        >
          <option value="">{t('selectDevice')}</option>
          {deviceOptions.map(item => (
            <option key={safeText(item.model)} value={safeText(item.model)}>
              {safeText(item.model)} ({safeText(item.target)})
            </option>
          ))}
        </select>
      </section>

      {payload.error ? (
        <section className={styles.errorCard}>
          {t('readError', { error: payload.error })}
        </section>
      ) : null}

      {!payload.error && !selectedDevice && deviceOptions.length > 0 ? (
        <section className={styles.emptyCard}>{t('selectHint')}</section>
      ) : null}

      {selectedEntry && (
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{safeText(selectedEntry.model, t('unknownModel'))}</h3>
            <div className={styles.cardSub}>target: {safeText(selectedEntry.target)}</div>
            {selectedEntry.resolvedTarget ? (
              <div className={styles.cardSub}>resolved: {safeText(selectedEntry.resolvedTarget)}</div>
            ) : null}
            <span className={styles.okBadge}>{t('installable')}</span>
          </header>

          <div className={styles.cardBody}>
            <div className={styles.scanHint}>{t('scanToInstall')}</div>
            {selectedEntry.qrCodePath ? (
              <div className={styles.qrWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={String(selectedEntry.qrCodePath)} alt={`QR for ${safeText(selectedEntry.model, 'device')}`} className={styles.qrImage} />
              </div>
            ) : (
              <div className={styles.errorText}>{t('qrUnavailable')}</div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
