import type { ComponentChildren } from 'preact';
import { LanguageSwitch } from './language-switch.tsx';
import { SiteFooter, type Page } from './site-footer.tsx';

export function PageShell({ page, children }: { page: Page; children?: ComponentChildren }) {
	return (
		<div class="page">
			<header class="site-header">
				<LanguageSwitch />
			</header>
			<main>{children}</main>
			<SiteFooter page={page} />
		</div>
	);
}
