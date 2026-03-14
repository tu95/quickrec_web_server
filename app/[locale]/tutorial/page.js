import { getTranslations } from 'next-intl/server'

export async function generateMetadata({ params }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tutorial' })
  return { title: t('metaTitle') }
}

export default async function TutorialPage() {
  const t = await getTranslations('tutorial')
  return (
    <main className="page-root" style={{ maxWidth: 760 }}>
      <section className="panel panel-dark" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>{t('title')}</h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {t('description')}
        </p>
      </section>

      <section className="panel panel-dark">
        <div className="pair-steps">
          <div className="pair-step-card">
            <strong>{t('stepLabel', { n: 1 })}</strong>{t('step1')}
          </div>
          <div className="pair-step-card">
            <strong>{t('stepLabel', { n: 2 })}</strong>{t('step2')}
          </div>
          <div className="pair-step-card">
            <strong>{t('stepLabel', { n: 3 })}</strong>{t('step3')}
          </div>
          <div className="pair-step-card">
            <strong>{t('stepLabel', { n: 4 })}</strong>{t('step4')}
          </div>
        </div>
      </section>
    </main>
  )
}
