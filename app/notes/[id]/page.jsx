import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AsrArchivePanel from './asr-archive-panel'
import styles from './note-viewer.module.css'

export const dynamic = 'force-dynamic'

function formatDateTime(input) {
  const value = Number(input || 0)
  if (!Number.isFinite(value) || value <= 0) return '未知'
  return new Date(value).toLocaleString('zh-CN')
}

function safeText(input, fallback) {
  const text = String(input || '').trim()
  return text || fallback
}

function buildOrigin(headerStore) {
  const forwardedHost = headerStore.get('x-forwarded-host')
  const forwardedProto = headerStore.get('x-forwarded-proto')
  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`
  }
  const host = headerStore.get('host') || 'localhost:3000'
  return `${forwardedProto || 'http'}://${host}`
}

export default async function NoteViewerPage({ params }) {
  const routeParams = await params
  const noteId = String(routeParams?.id || '').trim()
  if (!noteId) notFound()

  const headerStore = await headers()
  const cookie = String(headerStore.get('cookie') || '')
  if (!cookie) {
    redirect(`/login?next=${encodeURIComponent(`/notes/${noteId}`)}`)
  }
  const origin = buildOrigin(headerStore)
  let note = null
  try {
    const res = await fetch(`${origin}/api/meeting-notes/${encodeURIComponent(noteId)}?format=json`, {
      cache: 'no-store',
      headers: { cookie }
    })
    if (res.status === 401) {
      redirect(`/login?next=${encodeURIComponent(`/notes/${noteId}`)}`)
    }
    if (res.status === 404) {
      notFound()
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json().catch(() => null)
    note = data?.success ? data.note : null
  } catch (error) {
    console.error('[notes-page] load note failed', {
      noteId,
      error: String(error?.message || error)
    })
    notFound()
  }
  if (!note) notFound()

  const markdown = String(note.markdown || '').trim()
  const metadata = note.metadata && typeof note.metadata === 'object' ? note.metadata : {}
  const sourceFileName = safeText(metadata.fileName, '未知文件')
  const providerName = safeText(metadata.providerName, '未知提供商')
  const modelName = safeText(metadata.model, '未知模型')
  const promptName = safeText(metadata.promptName, '默认提示词')
  const createdAtText = formatDateTime(metadata.createdAt)
  const transcriptChars = Number(metadata.transcriptChars || 0)
  const transcriptCharsText = Number.isFinite(transcriptChars) && transcriptChars > 0
    ? `${transcriptChars.toLocaleString('zh-CN')} 字`
    : '未知'
  const rawMarkdownUrl = `/api/meeting-notes/${encodeURIComponent(noteId)}`
  const hasAsrArchive = note.hasAsrArchive || metadata.hasAsrArchive === true
  const asrArchiveUrl = safeText(note.asrArchiveUrl || metadata.asrArchiveUrl, '')

  return (
    <main className={styles.pageRoot}>
      <section className={styles.heroCard}>
        <div className={styles.heroTop}>
          <Link href="/" className={styles.backLink}>返回录音列表</Link>
          <a href={rawMarkdownUrl} target="_blank" rel="noreferrer" className={styles.rawLink}>查看原始 Markdown</a>
        </div>
        <h1 className={styles.title}>智能纪要与记录总结</h1>
        <p className={styles.subtitle}>
          页面会根据转写内容呈现“会议纪要”或“口头记录总结”结构。
        </p>
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>源文件</div>
            <div className={styles.metaValue}>{sourceFileName}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>生成时间</div>
            <div className={styles.metaValue}>{createdAtText}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>模型</div>
            <div className={styles.metaValue}>{providerName} / {modelName}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>Prompt</div>
            <div className={styles.metaValue}>{promptName}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>转写长度</div>
            <div className={styles.metaValue}>{transcriptCharsText}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>纪要 ID</div>
            <div className={styles.metaValue}>{noteId}</div>
          </div>
        </div>
      </section>

      <AsrArchivePanel
        noteId={noteId}
        hasAsrArchive={hasAsrArchive}
        asrArchiveUrl={asrArchiveUrl}
      />

      <article className={styles.markdownCard}>
        <div className={styles.markdownBody}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {markdown}
          </ReactMarkdown>
        </div>
      </article>
    </main>
  )
}
