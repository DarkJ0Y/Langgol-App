import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'

export default async function NotFound() {
  const t = createTranslator(await getLocale())
  return (
    <Card>
      <h1 className="lg-title">{t.t('errors.notFound')}</h1>
      <LinkButton href="/" variant="secondary">
        {t.t('common.back')}
      </LinkButton>
    </Card>
  )
}
