'use client'

import ConfigProfilesManager from '../config-profiles-manager'

export default function ServiceConfigPage() {
  return (
    <main className="page-root">
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>AI服务配置</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          左侧管理你的配置列表，右侧查看或填写配置详情。默认使用系统提供的服务。
        </p>
      </section>

      <section className="panel panel-dark">
        <ConfigProfilesManager
          mode="user"
          title="我的用户配置"
          subtitle="可新增、编辑、删除并测试个人配置。未启用个人配置时，系统自动回退到默认服务。"
          hideAccess={true}
          allowTesting={true}
          hideHeader={true}
        />
      </section>
    </main>
  )
}
