import { useTranslation } from 'react-i18next';
import { Icon } from '../components/icons';
import { useTheme } from './theme';
import { getAppLang, setAppLang } from '../../i18n';
import type { AppLang } from '../../i18n';

/** Nút chuyển theme sáng/tối + chuyển ngôn ngữ VI/EN cho topbar. */
export function ThemeLangSwitch() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const lang = getAppLang();

  const switchLang = (lng: AppLang) => {
    // setAppLang đã gọi i18n.changeLanguage bên trong (đủ để re-render).
    setAppLang(lng);
  };

  return (
    <div className="theme-lang-switch">
      <div className="lang-seg" role="group" aria-label={t('lang.label')}>
        {(['vi', 'en'] as AppLang[]).map((l) => (
          <button
            key={l}
            type="button"
            className={`lang-seg-btn${lang === l ? ' active' : ''}`}
            onClick={() => switchLang(l)}
            aria-pressed={lang === l}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        onClick={toggle}
        aria-label={t('theme.toggle')}
        title={t('theme.toggle')}
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} />
      </button>
    </div>
  );
}
