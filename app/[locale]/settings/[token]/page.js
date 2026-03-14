import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isValidAdminSettingsToken } from '../../../_lib/admin-settings-route'
import SettingsPageContent from '../settings-page-content'

export async function generateMetadata({ params }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'settings' })
  return { title: t('metaTitle') }
}

export default async function SettingsPrivatePage({ params }) {
  const resolved = await params
  const token = String(resolved?.token || '').trim()
  if (!isValidAdminSettingsToken(token)) {
    notFound()
  }
  return <SettingsPageContent />
}
