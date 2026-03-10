'use client'

import { useMemo, useState } from 'react'
import styles from './preview-package.module.css'

function formatDateTime(value) {
  const text = String(value || '').trim()
  if (!text) return '-'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN')
}

function asArray(input) {
  return Array.isArray(input) ? input : []
}

function safeText(input, fallback = '-') {
  const value = String(input ?? '').trim()
  return value || fallback
}

export default function PreviewPackageClient({ initialPayload }) {
  const payload = initialPayload && typeof initialPayload === 'object'
    ? initialPayload
    : { version: '', generatedAt: '', totalCount: 0, successCount: 0, failureCount: 0, entries: [], error: '' }
  const [selectedDevice, setSelectedDevice] = useState('')

  // 获取所有可用设备列表（按 model 去重）
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

  // 当前选中的设备详情
  const selectedEntry = useMemo(() => {
    if (!selectedDevice) return null
    return deviceOptions.find(item => safeText(item.model) === selectedDevice) || null
  }, [selectedDevice, deviceOptions])

  return (
    <>
      <section className={styles.summaryMetaRow}>
        <div className={styles.pill}>安装包版本: <strong>{safeText(payload.version)}</strong></div>
        <div className={styles.pill}>更新时间: <strong>{formatDateTime(payload.generatedAt)}</strong></div>
      </section>

      <section className={styles.summaryCountRow}>
        <div className={styles.pill}>成功: <strong>{Number(payload.successCount || 0)}</strong></div>
        <div className={styles.pill}>失败: <strong>{Number(payload.failureCount || 0)}</strong></div>
        <div className={styles.pill}>总数: <strong>{Number(payload.totalCount || 0)}</strong></div>
      </section>

      <section className={styles.searchWrap}>
        <select
          className={styles.searchInput}
          value={selectedDevice}
          onChange={e => setSelectedDevice(e.target.value)}
        >
          <option value="">请选择设备型号</option>
          {deviceOptions.map(item => (
            <option key={safeText(item.model)} value={safeText(item.model)}>
              {safeText(item.model)} ({safeText(item.target)})
            </option>
          ))}
        </select>
      </section>

      {payload.error ? (
        <section className={styles.errorCard}>
          读取 preview-packages.json 失败: {payload.error}
        </section>
      ) : null}

      {!payload.error && !selectedDevice && deviceOptions.length > 0 ? (
        <section className={styles.emptyCard}>请从上方选择设备型号，查看安装二维码</section>
      ) : null}

      {selectedEntry && (
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{safeText(selectedEntry.model, '未知机型')}</h3>
            <div className={styles.cardSub}>target: {safeText(selectedEntry.target)}</div>
            {selectedEntry.resolvedTarget ? (
              <div className={styles.cardSub}>resolved: {safeText(selectedEntry.resolvedTarget)}</div>
            ) : null}
            <span className={styles.okBadge}>可安装</span>
          </header>

          <div className={styles.cardBody}>
            <div className={styles.scanHint}>扫码安装</div>
            {selectedEntry.qrCodePath ? (
              <div className={styles.qrWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={String(selectedEntry.qrCodePath)} alt={`QR for ${safeText(selectedEntry.model, 'device')}`} className={styles.qrImage} />
              </div>
            ) : (
              <div className={styles.errorText}>二维码暂不可用</div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
