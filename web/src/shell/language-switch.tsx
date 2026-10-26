import { withLang } from '../fragment.ts';
import { LANGS, useI18n } from '../i18n/i18n.tsx';

export function LanguageSwitch() {
	const { lang: active, hash, t, setLang } = useI18n();

	return (
		<nav aria-label={t('lang.nav_label')}>
			<ul class="lang-switch">
				{LANGS.map((code) => (
					<li key={code} class="lang-switch__item">
						<a
							class="lang-switch__link"
							href={withLang(hash, code)}
							lang={code}
							hreflang={code}
							aria-label={t(`lang.${code}.name`)}
							aria-current={code === active ? 'true' : undefined}
							onClick={(event) => {
								// Leave modified and non-primary clicks (new tab, new window) to the browser.
								if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
								event.preventDefault();
								setLang(code);
							}}
						>
							{t(`lang.${code}.code`)}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
