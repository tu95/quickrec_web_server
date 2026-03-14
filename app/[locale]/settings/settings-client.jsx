'use client'

import { useTranslations } from 'next-intl'
import ConfigProfilesManager from '../../config-profiles-manager'

export default function SettingsClient({ cacheUserId = '' }) {
  const t = useTranslations('settings')
  return (
    <ConfigProfilesManager
      mode="admin"
      title={t('adminTitle')}
      subtitle={t('adminSubtitle')}
      cacheUserId={cacheUserId}
      hideAccess={false}
      allowTesting={true}
      hideHeader={false}
    />
  )
}
