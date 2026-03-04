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
  const headerStore = headers()
  const cookie = headerStore.get('cookie') || ''
  try {
    const res = await fetch(`${origin}/api/files`, {
      cache: 'no-store',
      headers: {
        cookie
      }
    })
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
        <p className="hero-subtitle">
          先绑定设备，再上传录音。上传后自动转 MP3，并同步进入你的账号空间。
        </p>
        <div className="server-pill">
          <span>服务器地址</span>
          <code>{origin}</code>
        </div>
        <div className="pair-steps">
          <div className="pair-step-card">
            <strong>步骤 1：</strong>手表端获取配对码
          </div>
          <div className="pair-step-card">
            <strong>步骤 2：</strong>在网页绑定设备
          </div>
          <div className="pair-step-card">
            <strong>步骤 3：</strong>设备上传录音并自动入库
          </div>
        </div>
      </section>

      <section className="panel">
        <FileManagerClient origin={origin} initialFiles={files} />
      </section>
    </main>
  )
}
