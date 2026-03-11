import { notFound } from 'next/navigation'
import { isValidAdminSettingsToken } from '../../_lib/admin-settings-route'
import SettingsPageContent from '../settings-page-content'

export const metadata = {
  title: 'AI 设置中心'
}

export default async function SettingsPrivatePage({ params }) {
  const resolved = await params
  const token = String(resolved?.token || '').trim()
  if (!isValidAdminSettingsToken(token)) {
    notFound()
  }
  return <SettingsPageContent />
}

