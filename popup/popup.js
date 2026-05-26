import { PanelController } from '../shared/panel-controller.js';

/** Chrome 扩展 action popup 硬上限（宽 800 × 高 600） */
const POPUP_MAX_H = 600;
const POPUP_MIN_H = 400;
const POPUP_HEIGHT_RATIO = 0.85;

function clampPopupHeight(px) {
  return Math.min(POPUP_MAX_H, Math.max(POPUP_MIN_H, px));
}

function syncPopupViewport() {
  const inner = window.innerHeight;
  if (inner > 0) {
    document.documentElement.style.setProperty(
      '--popup-max-h',
      `${clampPopupHeight(inner)}px`
    );
  }
}

async function applyPopupHeight() {
  let windowHeight = window.screen.availHeight;

  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win?.height) windowHeight = win.height;
  } catch {
    /* 无 windows 权限 */
  }

  const target = clampPopupHeight(Math.floor(windowHeight * POPUP_HEIGHT_RATIO));
  document.documentElement.classList.add('popup');
  document.documentElement.style.setProperty('--popup-max-h', `${target}px`);
  syncPopupViewport();
}

await applyPopupHeight();

const app = new PanelController('popup');
await app.init();

syncPopupViewport();
requestAnimationFrame(syncPopupViewport);

window.addEventListener('resize', () => {
  applyPopupHeight();
});
