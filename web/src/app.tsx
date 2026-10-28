import { I18nProvider, type Catalogues } from './i18n/i18n.tsx';
import { SearchPage, type SearchServices } from './search/search-page.tsx';
import { PageShell } from './shell/page-shell.tsx';

export function App({ catalogues, services }: { catalogues?: Catalogues; services?: Partial<SearchServices> }) {
	return (
		<I18nProvider titleKey="search.title" catalogues={catalogues}>
			<PageShell page="search">
				<SearchPage services={services} />
			</PageShell>
		</I18nProvider>
	);
}
