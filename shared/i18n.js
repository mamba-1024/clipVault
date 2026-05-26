/** @typedef {'auto' | 'en' | 'zh_CN'} LocaleSetting */

const SUPPORTED = ['en', 'zh_CN'];
let bundle = null;
let activeLocale = 'en';

function normalizeLocale(uiLang) {
  const lang = (uiLang || 'en').toLowerCase();
  if (lang.startsWith('zh')) return 'zh_CN';
  return 'en';
}

async function loadBundle(locale) {
  const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
  const raw = await fetch(url).then((r) => r.json());
  bundle = Object.fromEntries(
    Object.entries(raw).map(([key, val]) => [key, val.message || ''])
  );
  activeLocale = locale;
}

/**
 * @param {LocaleSetting} languageSetting
 */
export async function initI18n(languageSetting = 'auto') {
  if (languageSetting === 'auto') {
    bundle = null;
    activeLocale = normalizeLocale(chrome.i18n.getUILanguage());
    return activeLocale;
  }
  const locale = SUPPORTED.includes(languageSetting) ? languageSetting : 'en';
  await loadBundle(locale);
  return locale;
}

export function getActiveLocale() {
  return activeLocale;
}

/**
 * @param {string} key
 * @param {string|string[]} [substitutions]
 */
export function t(key, substitutions) {
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];

  if (bundle && bundle[key] !== undefined) {
    let msg = bundle[key];
    subs.forEach((s, i) => {
      msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), String(s));
    });
    return msg;
  }

  const msg = chrome.i18n.getMessage(key, subs);
  return msg || key;
}

/**
 * 将 data-i18n / data-i18n-placeholder / data-i18n-title 应用到 DOM
 * @param {ParentNode} [root]
 */
export function applyI18nToDOM(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const text = t(key);
    if (el instanceof HTMLOptionElement || el instanceof HTMLButtonElement) {
      el.textContent = text;
    } else if (el instanceof HTMLInputElement && el.type !== 'button') {
      el.value = text;
    } else {
      el.textContent = text;
    }
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && el instanceof HTMLElement) el.setAttribute('placeholder', t(key));
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key && el instanceof HTMLElement) el.setAttribute('title', t(key));
  });

  root.querySelectorAll('select[data-i18n-options]').forEach((select) => {
    const keys = select.getAttribute('data-i18n-options')?.split(',') || [];
    Array.from(select.options).forEach((opt, i) => {
      if (keys[i]) opt.textContent = t(keys[i].trim());
    });
  });

  const titleKey = root instanceof Document ? document.querySelector('[data-i18n-document-title]') : null;
  if (titleKey) {
    document.title = t(titleKey.getAttribute('data-i18n-document-title'));
  }
}
