import type { ComponentChildren } from 'preact';
import logoDarkUrl from '../assets/logo-dark.svg';
import logoUrl from '../assets/logo.svg';
import { useI18n } from '../i18n/i18n.tsx';
import { LanguageSwitch } from './language-switch.tsx';
import { SiteFooter, type Page } from './site-footer.tsx';

export function PageShell({ page, children }: { page: Page; children?: ComponentChildren }) {
	const { lang, t } = useI18n();

	return (
		<div class="page">
			<header class="site-header">
				<div class="site-brand">
					<a class="site-brand__link" href={`${page === 'about' ? '../' : './'}#lang=${lang}`}>
						<picture>
							<source srcset={logoDarkUrl} media="(prefers-color-scheme: dark)" />
							<img class="site-brand__logo" src={logoUrl} alt={t('site.name')} />
						</picture>
					</a>
					<p class="site-brand__tagline">{t('site.tagline')}</p>
				</div>
				<LanguageSwitch />
			</header>
			<main>{children}</main>
			<SiteFooter page={page} />
		</div>
	);
}
