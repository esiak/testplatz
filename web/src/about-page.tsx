import { I18nProvider, useI18n, type Catalogues } from './i18n/i18n.tsx';
import { PageShell } from './shell/page-shell.tsx';

function AboutContent() {
	const { t } = useI18n();
	return <h1>{t('about.heading')}</h1>;
}

export function AboutPage({ catalogues }: { catalogues?: Catalogues }) {
	return (
		<I18nProvider titleKey="about.title" catalogues={catalogues}>
			<PageShell page="about">
				<AboutContent />
			</PageShell>
		</I18nProvider>
	);
}
