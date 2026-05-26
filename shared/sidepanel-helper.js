import { t } from './i18n.js';

const SIDE_PANEL_PATH = 'sidepanel/sidepanel.html';

export function isSidePanelSupported() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.open === 'function');
}

/**
 * 必须在 Popup/页面内的 click 回调中直接调用（不可经 sendMessage 转 SW），
 * 否则 Chrome 会丢弃 user gesture，sidePanel.open() 静默失败。
 */
export async function openSidePanelFromPopup() {
  if (!isSidePanelSupported()) {
    throw new Error(t('sidepanelNeedChrome116'));
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (tab?.id) {
    chrome.sidePanel.setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH, enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    return;
  }

  chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  const win = await chrome.windows.getLastFocused({ populate: false });
  if (win?.id) {
    await chrome.sidePanel.open({ windowId: win.id });
    return;
  }

  throw new Error(t('sidepanelNoWindow'));
}

export function enableSidePanelGlobally() {
  if (!chrome.sidePanel?.setOptions) return;
  chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
}
