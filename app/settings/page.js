import { notFound } from 'next/navigation'
import { getAdminSettingsToken } from '../_lib/admin-settings-route'
import SettingsPageContent from './settings-page-content'

export const metadata = {
  title: 'AI 设置中心'
}

export default async function SettingsPage() {
  // 若配置了随机私有路径，公开 /settings 直接返回 404，降低路径被遍历概率。
  if (getAdminSettingsToken()) notFound()
  return <SettingsPageContent />
}
