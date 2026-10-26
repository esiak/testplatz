import { I18nProvider, useI18n, type Catalogues } from './i18n/i18n.tsx';
import { PageShell } from './shell/page-shell.tsx';

function SearchPage() {
	const { t } = useI18n();
	return <h1>{t('search.heading')}</h1>;
}

export function App({ catalogues }: { catalogues?: Catalogues }) {
	return (
		<I18nProvider titleKey="search.title" catalogues={catalogues}>
			<PageShell page="search">
				<SearchPage />
			</PageShell>
		</I18nProvider>
	);
}
