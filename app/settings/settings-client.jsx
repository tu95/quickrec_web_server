'use client'

import ConfigProfilesManager from '../config-profiles-manager'

export default function SettingsClient({ cacheUserId = '' }) {
  return (
    <ConfigProfilesManager
      mode="admin"
      title="系统服务配置池"
      subtitle="仅管理员可见。这里维护全站默认服务，支持多条配置并切换当前默认项。"
      cacheUserId={cacheUserId}
      hideAccess={false}
      allowTesting={true}
    />
  )
}
