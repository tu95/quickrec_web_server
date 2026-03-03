export const metadata = {
  title: '使用教程'
}

export default function TutorialPage() {
  return (
    <main className="page-root" style={{ maxWidth: 760 }}>
      <section className="hero">
        <p className="hero-kicker">QuickRec Tutorial</p>
        <h1 className="hero-title">快速上手教程</h1>
        <p className="hero-subtitle">按下面的顺序操作，一次就能完成设备绑定与上传验证。</p>
      </section>

      <section className="panel panel-dark">
        <div className="pair-steps">
          <div className="pair-step-card">
            <strong>步骤 1：</strong>在手表端进入设置，获取 6 位配对码。
          </div>
          <div className="pair-step-card">
            <strong>步骤 2：</strong>网页打开“绑定设备”，输入配对码完成绑定。
          </div>
          <div className="pair-step-card">
            <strong>步骤 3：</strong>绑定成功后回到手表上传录音，网页首页可看到文件与状态。
          </div>
          <div className="pair-step-card">
            <strong>步骤 4：</strong>如果提示会话失效，重新获取配对码并再次绑定即可。
          </div>
        </div>
      </section>
    </main>
  )
}
