import SettingsClient from './settings-client'

export const metadata = {
  title: 'AI 设置中心'
}

export default function SettingsPage() {
  return (
    <main className="page-root">
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>会议纪要设置中心</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          管理访问密钥、LLM 提供商、模型、Prompt 与语音识别参数。
        </p>
      </section>
      <section className="panel panel-dark">
        <SettingsClient />
      </section>
    </main>
  )
}
