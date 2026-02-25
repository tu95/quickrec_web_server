import SettingsClient from './settings-client'

export const metadata = {
  title: 'AI 设置中心'
}

export default function SettingsPage() {
  return (
    <main className="page-root">
      <section className="hero">
        <p className="hero-kicker">AI Settings</p>
        <h1 className="hero-title">会议纪要设置中心</h1>
        <p className="hero-subtitle">管理访问密钥、LLM 提供商、模型、Prompt 与语音识别参数。</p>
      </section>
      <section className="panel">
        <SettingsClient />
      </section>
    </main>
  )
}

