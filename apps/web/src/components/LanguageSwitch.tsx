import { useI18n } from '../lib/i18n'

interface LanguageSwitchProps {
  className?: string
}

export function LanguageSwitch({ className }: LanguageSwitchProps) {
  const { language, setLanguage } = useI18n()

  return (
    <div className={`language-switch${className ? ` ${className}` : ''}`} aria-label="Language">
      <button
        type="button"
        className={language === 'zh' ? 'selected' : undefined}
        onClick={() => setLanguage('zh')}
        aria-pressed={language === 'zh'}
      >
        中
      </button>
      <button
        type="button"
        className={language === 'en' ? 'selected' : undefined}
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
      >
        EN
      </button>
    </div>
  )
}
