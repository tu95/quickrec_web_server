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

function normalizedText(item) {
  return [
    item?.model,
    item?.target,
    item?.resolvedTarget,
  ].join(' ').toLowerCase()
}

export default function PreviewPackageClient({ initialPayload }) {
  const payload = initialPayload && typeof initialPayload === 'object'
    ? initialPayload
    : { generatedAt: '', totalCount: 0, successCount: 0, failureCount: 0, entries: [], error: '' }
  const [keyword, setKeyword] = useState('')
  const [copiedUrl, setCopiedUrl] = useState('')

  const filteredEntries = useMemo(() => {
    const list = asArray(payload.entries)
    const q = keyword.trim().toLowerCase()
    if (!q) return list
    return list.filter(item => normalizedText(item).includes(q))
  }, [payload.entries, keyword])

  async function copyLink(url) {
    const value = String(url || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedUrl(value)
      setTimeout(() => {
        setCopiedUrl(current => (current === value ? '' : current))
      }, 1400)
    } catch (error) {
      alert(`复制失败: ${String(error?.message || error)}`)
    }
  }

  return (
    <>
      <section className={styles.summaryRow}>
        <div className={styles.pill}>更新时间: <strong>{formatDateTime(payload.generatedAt)}</strong></div>
        <div className={styles.pill}>成功: <strong>{Number(payload.successCount || 0)}</strong></div>
        <div className={styles.pill}>失败: <strong>{Number(payload.failureCount || 0)}</strong></div>
        <div className={styles.pill}>总数: <strong>{Number(payload.totalCount || 0)}</strong></div>
      </section>

      <section className={styles.searchWrap}>
        <input
          className={styles.searchInput}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜索机型 / target"
        />
      </section>

      {payload.error ? (
        <section className={styles.errorCard}>
          读取 preview-packages.json 失败: {payload.error}
        </section>
      ) : null}

      {filteredEntries.length === 0 ? (
        <section className={styles.emptyCard}>暂无结果。先在本地执行 `npm run preview:packages` 生成数据。</section>
      ) : (
        <section className={styles.grid}>
          {filteredEntries.map((item, index) => {
            const key = `${safeText(item.model, 'model')}-${safeText(item.target, 'target')}-${index}`
            const success = String(item.status || '').toLowerCase() === 'success'
            const logSnippet = asArray(item.logSnippet)
            const resolveNote = safeText(item.resolveNote, '')
            const suggested = asArray(item.suggestedTargets)

            return (
              <article key={key} className={styles.card}>
                <header className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>{safeText(item.model, '未知机型')}</h3>
                  <div className={styles.cardSub}>target: {safeText(item.target)}</div>
                  {item.resolvedTarget ? (
                    <div className={styles.cardSub}>resolved: {safeText(item.resolvedTarget)}</div>
                  ) : null}
                  <span className={success ? styles.okBadge : styles.failBadge}>
                    {success ? '可安装' : '生成失败'}
                  </span>
                </header>

                <div className={styles.cardBody}>
                  {resolveNote ? (
                    <div className={styles.resolveHint}>解析: {resolveNote}</div>
                  ) : null}

                  {success && item.qrCodePath ? (
                    <div className={styles.qrWrap}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={String(item.qrCodePath)} alt={`QR for ${safeText(item.model, 'device')}`} className={styles.qrImage} />
                    </div>
                  ) : null}

                  <div className={styles.actions}>
                    {success && item.installUrl ? (
                      <>
                        <a
                          className={styles.primaryBtn}
                          href={String(item.installUrl)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开安装链接
                        </a>
                        <button
                          type="button"
                          className={copiedUrl === item.installUrl ? styles.copyBtnDone : styles.copyBtn}
                          onClick={() => copyLink(item.installUrl)}
                        >
                          {copiedUrl === item.installUrl ? '已复制' : '复制链接'}
                        </button>
                      </>
                    ) : null}
                    {!success && item.logFile ? (
                      <a className={styles.logBtn} href={String(item.logFile)} target="_blank" rel="noreferrer">
                        查看完整日志
                      </a>
                    ) : null}
                  </div>

                  {!success && item.error ? (
                    <div className={styles.errorText}>错误: {safeText(item.error)}</div>
                  ) : null}
                  {!success && suggested.length > 0 ? (
                    <div className={styles.suggestText}>建议 target: {suggested.join(' | ')}</div>
                  ) : null}
                  {!success && logSnippet.length > 0 ? (
                    <pre className={styles.logPre}>{logSnippet.join('\n')}</pre>
                  ) : null}
                </div>
              </article>
            )
          })}
        </section>
      )}
    </>
  )
}
