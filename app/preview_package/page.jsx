import Link from 'next/link'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import PreviewPackageClient from './preview-package-client'
import styles from './preview-package.module.css'

export const dynamic = 'force-dynamic'

function fallbackPayload(errorMessage = '') {
  return {
    generatedAt: '',
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
    entries: [],
    error: errorMessage,
  }
}

async function loadPreviewPackages() {
  const dataFile = path.resolve(process.cwd(), 'public', 'preview_package', 'preview-packages.json')
  try {
    const raw = await fs.readFile(dataFile, 'utf8')
    const data = JSON.parse(raw)
    return {
      generatedAt: String(data?.generatedAt || ''),
      totalCount: Number(data?.totalCount || 0),
      successCount: Number(data?.successCount || 0),
      failureCount: Number(data?.failureCount || 0),
      entries: Array.isArray(data?.entries) ? data.entries : [],
      error: '',
    }
  } catch (error) {
    return fallbackPayload(String(error?.message || error))
  }
}

export default async function PreviewPackagePage() {
  const payload = await loadPreviewPackages()
  return (
    <main className={styles.pageRoot}>
      <section className={styles.heroCard}>
        <div className={styles.heroTop}>
          <Link href="/" className={styles.backLink}>返回录音首页</Link>
          <span className={styles.heroBadge}>本地脚本生成 · 服务端静态托管</span>
        </div>
        <h1 className={styles.title}>测试安装二维码</h1>
        <p className={styles.subtitle}>
          使用本地 `zeus preview` 批量生成安装链接和二维码。页面支持搜索、复制链接、查看失败日志。
        </p>
      </section>

      <PreviewPackageClient initialPayload={payload} />
    </main>
  )
}

