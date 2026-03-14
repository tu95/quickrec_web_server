import '../globals.css'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { routing } from '../../i18n/routing'
import HomeAuthActions from '../home-auth-actions'

export async function generateMetadata({ params }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })
  return { title: t('title') }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1
}

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }))
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params
  const messages = await getMessages()

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <div className="global-top-nav-wrap">
            <div className="global-top-nav">
              <HomeAuthActions />
            </div>
          </div>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
