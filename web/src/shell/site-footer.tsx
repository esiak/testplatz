import { useI18n } from '../i18n/i18n.tsx';

export type Page = 'search' | 'about';

export function SiteFooter({ page }: { page: Page }) {
	const { lang, t } = useI18n();
	const onAbout = page === 'about';

	// Impressum and Privacy links stay hidden during the private beta.
	return (
		<footer class="site-footer">
			<ul class="site-footer__links">
				<li>
					<a class="site-footer__link" href={`${onAbout ? './' : 'about/'}#lang=${lang}`} aria-current={onAbout ? 'page' : undefined}>
						{t('footer.about')}
					</a>
				</li>
			</ul>
			<p class="site-footer__attribution">{t('footer.attribution')}</p>
		</footer>
	);
}
