/** 翻译目标语言（ISO 风格代码，供 AI prompt 使用） */
export const TRANSLATE_TARGET_LANGS = [
  { code: 'auto', i18nKey: 'translateTargetAuto' },
  { code: 'en', i18nKey: 'translateLangEn' },
  { code: 'zh_CN', i18nKey: 'translateLangZh' },
  { code: 'zh_TW', i18nKey: 'translateLangZhTw' },
  { code: 'ja', i18nKey: 'translateLangJa' },
  { code: 'ko', i18nKey: 'translateLangKo' },
  { code: 'fr', i18nKey: 'translateLangFr' },
  { code: 'de', i18nKey: 'translateLangDe' },
  { code: 'es', i18nKey: 'translateLangEs' },
  { code: 'ru', i18nKey: 'translateLangRu' },
  { code: 'pt', i18nKey: 'translateLangPt' },
  { code: 'it', i18nKey: 'translateLangIt' },
  { code: 'ar', i18nKey: 'translateLangAr' },
  { code: 'vi', i18nKey: 'translateLangVi' },
  { code: 'th', i18nKey: 'translateLangTh' }
];

/** @type {Record<string, string>} */
export const TRANSLATE_LANG_ENGLISH_NAMES = {
  en: 'English',
  zh_CN: 'Chinese (Simplified)',
  zh_TW: 'Chinese (Traditional)',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
  vi: 'Vietnamese',
  th: 'Thai'
};

export function normalizeLangCode(code) {
  if (!code) return null;
  const raw = String(code).trim().toLowerCase().replace('-', '_');
  if (raw === 'zh' || raw === 'zh_cn' || raw === 'cn') return 'zh_CN';
  if (raw === 'zh_tw' || raw === 'zh_hk' || raw === 'tw') return 'zh_TW';
  if (raw.startsWith('zh')) return 'zh_CN';
  return raw.split('_')[0];
}

/**
 * @param {string} preference 设置中的 translateTargetLang（含 auto）
 * @param {{ sourceLang?: string|null, uiLocale?: string }} [ctx]
 */
export function resolveTranslateTargetLang(preference = 'auto', ctx = {}) {
  const pref = preference === 'auto' ? 'auto' : normalizeLangCode(preference) || 'en';
  if (pref !== 'auto') return pref;

  const src = normalizeLangCode(ctx.sourceLang);
  if (src === 'zh_CN' || src === 'zh_TW') return 'en';
  if (src === 'en') return 'zh_CN';
  if (src && src !== 'en') return 'en';

  const ui = ctx.uiLocale === 'zh_CN' ? 'zh_CN' : 'en';
  return ui === 'zh_CN' ? 'en' : 'zh_CN';
}

export function getTranslateLangEnglishName(code) {
  return TRANSLATE_LANG_ENGLISH_NAMES[code] || TRANSLATE_LANG_ENGLISH_NAMES[normalizeLangCode(code)] || code;
}
