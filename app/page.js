import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import FileManagerClientNoSSR from './FileManagerClientNoSSR'

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
    if (res.status === 401) {
      redirect('/login?next=%2F')
    }
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
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>录音文件管理</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          在此查看、播放、下载、删除录音，并发起会议纪要。
        </p>
      </section>
      <section className="panel">
        <FileManagerClientNoSSR origin={origin} initialFiles={files} />
      </section>
    </main>
  )
}
