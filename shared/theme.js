/** @typedef {'system'|'light'|'dark'} ThemePreference */
/** @typedef {'light'|'dark'} ResolvedTheme */

const COLOR_SCHEME_MQ = '(prefers-color-scheme: dark)';

/** 解析外观偏好（system 跟随 Chrome / 系统 prefers-color-scheme） */
export function resolveTheme(preference = 'system') {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia(COLOR_SCHEME_MQ).matches ? 'dark' : 'light';
}

/** 将解析后的主题应用到页面根节点 */
export function applyThemePreference(preference = 'system', root = document.documentElement) {
  const resolved = resolveTheme(preference);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

/**
 * 监听系统/Chrome 配色变化与设置保存，保持界面同步
 * @param {() => ThemePreference} getPreference
 * @param {object} [options]
 * @param {HTMLElement} [options.root]
 */
export function createThemeController(getPreference, options = {}) {
  const root = options.root ?? document.documentElement;

  const apply = () => applyThemePreference(getPreference(), root);

  const onSystemChange = () => {
    if (getPreference() === 'system') apply();
  };

  const install = () => {
    apply();
    window.matchMedia(COLOR_SCHEME_MQ).addEventListener('change', onSystemChange);
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings?.newValue?.theme !== undefined) {
          apply();
        }
      });
    }
  };

  return { apply, install };
}
