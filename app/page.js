import { headers } from 'next/headers'
import FileManagerClient from './FileManagerClient'

function getRequestOrigin() {
  const headerStore = headers()
  const forwardedProto = headerStore.get('x-forwarded-proto')
  const forwardedHost = headerStore.get('x-forwarded-host')
  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`
  }

  const host = headerStore.get('host') || 'localhost:3000'
  return `${forwardedProto || 'http'}://${host}`
}

async function getFiles(origin) {
  try {
    const res = await fetch(`${origin}/api/files`, { cache: 'no-store' })
    const data = await res.json()
    return data.success ? data.files : []
  } catch {
    return []
  }
}

export default async function Home() {
  const origin = getRequestOrigin()
  const files = await getFiles(origin)

  return (
    <main className="page-root">
      <section className="hero">
        <p className="hero-kicker">Zepp Recorder</p>
        <h1 className="hero-title">录音文件控制台</h1>
        <p className="hero-subtitle">上传后自动转 WAV，录音与归档分区管理，移动端可直接操作。</p>
        <div className="server-pill">
          <span>服务器地址</span>
          <code>{origin}</code>
        </div>
      </section>

      <section className="panel">
        <FileManagerClient origin={origin} initialFiles={files} />
      </section>

      <section className="api-panel">
        <h3>API 说明</h3>
        <code>
          POST /api/upload - 上传文件 (multipart/form-data, field: file)<br />
          POST /api/upload-test - 测试上传接口 (JSON)<br />
          POST /api/upload-chunk - 分片上传接口 (JSON, 自动转WAV)<br />
          POST /api/convert-wav - Opus 转 WAV (JSON: name)<br />
          GET  /api/files - 获取文件列表(含分类字段)<br />
          GET  /api/files/&#123;name&#125; - 下载/播放文件<br />
          DELETE /api/files/&#123;name&#125; - 删除文件
        </code>
      </section>
    </main>
  )
}
