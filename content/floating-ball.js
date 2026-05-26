(function () {
  if (window.__clipVaultFB) return;
  if (!/^https?:$/i.test(location.protocol)) return;
  window.__clipVaultFB = true;

  const HOSTNAME = location.hostname;
  const SESSION_HIDE_KEY = '_cv_fb_hide_visit';
  const DRAG_THRESHOLD = 8;
  const VIEWPORT_MARGIN = 12;
  const PANEL_WIDTH = 300;
  const PANEL_MAX_HEIGHT = 400;
  const BALL_ICON_SVG = `<svg class="ball-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="cvFbCGrad" x1="24" y1="20" x2="104" y2="108" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#00d4ff"/>
        <stop offset="0.5" stop-color="#5b8dff"/>
        <stop offset="1" stop-color="#7c5cff"/>
      </linearGradient>
      <linearGradient id="cvFbRingGrad" x1="0" y1="64" x2="128" y2="64" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#00d4ff"/>
        <stop offset="0.35" stop-color="#7c5cff"/>
        <stop offset="0.7" stop-color="#00d4ff"/>
        <stop offset="1" stop-color="#7c5cff"/>
      </linearGradient>
    </defs>
    <circle cx="64" cy="64" r="54" stroke="url(#cvFbRingGrad)" stroke-width="10"/>
    <circle cx="64" cy="64" r="40" fill="#0a0e1a"/>
    <text x="64" y="78" text-anchor="middle" font-family="system-ui,sans-serif" font-size="52" font-weight="700" fill="url(#cvFbCGrad)">C</text>
  </svg>`;

  function msg(key, ...subs) {
    return chrome.i18n.getMessage(key, subs) || key;
  }

  function resolveAppearance(preference) {
    if (preference === 'light' || preference === 'dark') return preference;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyAppearance(preference) {
    if (!root) return;
    root.setAttribute('data-theme', resolveAppearance(preference));
  }

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(res || {});
      });
    });
  }

  async function loadFbSettings() {
    const res = await send('GET_SETTINGS');
    const fb = res.settings?.floatingBall || {};
    return {
      enabled: fb.enabled !== false,
      shrunk: !!fb.shrunk,
      permanentlyDisabled: !!fb.permanentlyDisabled,
      disabledSites: fb.disabledSites || []
    };
  }

  async function saveFbSettings(partial) {
    return send('SAVE_FLOATING_BALL', { floatingBall: partial });
  }

  async function shouldShow() {
    if (sessionStorage.getItem(SESSION_HIDE_KEY)) return false;
    const fb = await loadFbSettings();
    if (!fb.enabled) return false;
    if (fb.permanentlyDisabled) return false;
    if (fb.disabledSites.some((s) => HOSTNAME.includes(s))) return false;
    return true;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  const styles = `
    :host, * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    .wrap {
      position: fixed;
      z-index: 2147483646;
      right: 20px;
      bottom: 100px;
    }
    .anchor {
      position: relative;
    }
    .ball-row {
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
    }
    .ball-wrap { position: relative; }
    .ball {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: 2px solid rgba(0, 212, 255, 0.5);
      background: linear-gradient(145deg, #0a0e1a, #141a2e);
      box-shadow: 0 4px 20px rgba(0, 212, 255, 0.35), 0 0 0 1px rgba(124, 92, 255, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, width 0.2s, height 0.2s;
      user-select: none;
      touch-action: none;
    }
    .ball.shrunk { width: 40px; height: 40px; }
    .ball.shrunk .ball-icon { width: 22px; height: 22px; }
    .ball:hover { transform: scale(1.05); }
    .ball.dragging { cursor: grabbing; transform: none; }
    .ball-icon {
      width: 28px;
      height: 28px;
      display: block;
      pointer-events: none;
      flex-shrink: 0;
    }
    .close-btn {
      position: absolute;
      left: -8px;
      top: -8px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid rgba(255, 92, 122, 0.6);
      background: #1a1020;
      color: #ff8fa3;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      z-index: 1;
    }
    .ball-wrap:hover .close-btn { display: flex; }
    .panel, .settings-panel {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      width: ${PANEL_WIDTH}px;
      max-height: ${PANEL_MAX_HEIGHT}px;
      background: rgba(10, 14, 26, 0.96);
      border: 1px solid rgba(120, 160, 255, 0.2);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(12px);
      overflow: hidden;
      display: none;
      flex-direction: column;
      z-index: 2;
    }
    .panel.place-below, .settings-panel.place-below {
      bottom: auto;
      top: calc(100% + 8px);
    }
    .panel.place-left, .settings-panel.place-left {
      right: auto;
      left: 0;
    }
    .panel.open, .settings-panel.open { display: flex; }
    .panel-hd {
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #00d4ff;
      border-bottom: 1px solid rgba(120, 160, 255, 0.15);
    }
    .panel-list {
      overflow-y: auto;
      max-height: 340px;
      padding: 6px;
    }
    .hist-item {
      padding: 8px 10px;
      margin-bottom: 4px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s;
    }
    .hist-item:hover {
      background: rgba(0, 212, 255, 0.1);
      border-color: rgba(0, 212, 255, 0.25);
    }
    .hist-text {
      font-size: 12px;
      color: #e8ecf4;
      line-height: 1.4;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hist-meta { font-size: 10px; color: #7b8aa8; margin-top: 4px; }
    .empty { padding: 24px; text-align: center; color: #7b8aa8; font-size: 12px; }
    .settings-body { padding: 12px; }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 13px;
      color: #e8ecf4;
    }
    .switch { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute;
      inset: 0;
      background: #2d3139;
      border-radius: 22px;
      cursor: pointer;
      transition: 0.2s;
    }
    .slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .switch input:checked + .slider { background: linear-gradient(135deg, #00d4ff, #7c5cff); }
    .switch input:checked + .slider::before { transform: translateX(18px); }
    .hide-options {
      margin: 8px 0 12px;
      padding: 10px;
      background: rgba(0,0,0,0.25);
      border-radius: 8px;
      display: none;
    }
    .hide-options.visible { display: block; }
    .hide-options label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: #a8b4cc;
      margin-bottom: 8px;
      cursor: pointer;
      line-height: 1.4;
    }
    .hide-options label:last-child { margin-bottom: 0; }
    .hide-options input { margin-top: 2px; accent-color: #00d4ff; }
    .settings-actions { display: flex; gap: 8px; padding: 0 12px 12px; }
    .btn {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-primary { background: linear-gradient(135deg, #00d4ff, #7c5cff); color: #fff; }
    .btn-ghost {
      background: transparent;
      border: 1px solid rgba(120, 160, 255, 0.3);
      color: #a8b4cc;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: rgba(10, 14, 26, 0.95);
      border: 1px solid rgba(0, 212, 255, 0.4);
      color: #e8ecf4;
      font-size: 12px;
      border-radius: 20px;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; }
    :host([data-theme='light']) .ball {
      background: linear-gradient(145deg, #f5f7fc, #e8ecf4);
      border-color: rgba(0, 153, 204, 0.45);
      box-shadow: 0 4px 16px rgba(80, 120, 200, 0.2);
    }
    :host([data-theme='light']) .panel,
    :host([data-theme='light']) .settings-panel {
      background: rgba(255, 255, 255, 0.98);
      border-color: rgba(80, 100, 180, 0.22);
      box-shadow: 0 12px 32px rgba(80, 120, 200, 0.18);
    }
    :host([data-theme='light']) .panel-hd { color: #0099cc; border-bottom-color: rgba(80, 100, 180, 0.15); }
    :host([data-theme='light']) .hist-text,
    :host([data-theme='light']) .hist-meta { color: #0f1528; }
    :host([data-theme='light']) .hist-meta { color: #5a6478; }
    :host([data-theme='light']) .hist-item:hover {
      background: rgba(0, 153, 204, 0.08);
      border-color: rgba(0, 153, 204, 0.2);
    }
    :host([data-theme='light']) .row span { color: #0f1528; }
    :host([data-theme='light']) .btn-ghost {
      border-color: rgba(80, 100, 180, 0.35);
      color: #5a6478;
    }
    :host([data-theme='light']) .toast {
      background: rgba(255, 255, 255, 0.98);
      color: #0f1528;
      border-color: rgba(0, 153, 204, 0.35);
    }
  `;

  let root;
  let shadow;
  let wrap;
  let ball;
  let historyPanel;
  let settingsPanel;
  let histList;
  let swShrink;
  let swHide;
  let hideOptions;
  let toast;

  let fbSettings = { shrunk: false, disabledSites: [] };
  let appearancePreference = 'system';
  let historyOpen = false;
  let settingsOpen = false;
  let cachedHistory = [];

  let pointerId = null;
  let pointerStart = null;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function applyShrunkClass() {
    ball.classList.toggle('shrunk', fbSettings.shrunk);
    if (swShrink) swShrink.checked = fbSettings.shrunk;
  }

  function closeHistory() {
    historyOpen = false;
    historyPanel.classList.remove('open');
    resetPanelLayout();
  }

  function closeSettings() {
    settingsOpen = false;
    settingsPanel.classList.remove('open');
    resetPanelLayout();
  }

  function resetPanelLayout() {
    if (historyOpen || settingsOpen) return;
    [historyPanel, settingsPanel].forEach((panel) => {
      if (!panel) return;
      panel.classList.remove('place-below', 'place-left');
      panel.style.maxHeight = '';
      panel.style.transform = '';
      const list = panel.querySelector('.panel-list');
      if (list) list.style.maxHeight = '';
      const body = panel.querySelector('.settings-body');
      if (body) {
        body.style.maxHeight = '';
        body.style.overflowY = '';
      }
    });
  }

  function getWrapDimensions() {
    const w = wrap?.offsetWidth || PANEL_WIDTH;
    const h = wrap?.offsetHeight || (ball?.offsetHeight || 52);
    return { w, h };
  }

  function clampDragPosition(left, top) {
    const { w, h } = getWrapDimensions();
    return {
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(window.innerWidth - w - VIEWPORT_MARGIN, left)
      ),
      top: Math.max(
        VIEWPORT_MARGIN,
        Math.min(window.innerHeight - h - VIEWPORT_MARGIN, top)
      )
    };
  }

  function clampWrapToViewport() {
    if (!wrap || historyOpen || settingsOpen) return;
    const rect = wrap.getBoundingClientRect();
    let newLeft = rect.left;
    let newTop = rect.top;

    if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      newLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    }
    if (newLeft < VIEWPORT_MARGIN) newLeft = VIEWPORT_MARGIN;
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      newTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    }
    if (newTop < VIEWPORT_MARGIN) newTop = VIEWPORT_MARGIN;

    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    wrap.style.left = `${newLeft}px`;
    wrap.style.top = `${newTop}px`;
  }

  function fitPanelInViewport(openPanel, ballRect) {
    const gap = 8;
    const spaceAbove = ballRect.top - VIEWPORT_MARGIN;
    const spaceBelow = window.innerHeight - ballRect.bottom - VIEWPORT_MARGIN;

    openPanel.classList.remove('place-below', 'place-left');
    openPanel.style.transform = '';

    const headerH = openPanel.querySelector('.panel-hd')?.offsetHeight || 40;
    const actionsH = openPanel.querySelector('.settings-actions')?.offsetHeight || 0;
    const listEl = openPanel.querySelector('.panel-list');
    const bodyEl = openPanel.querySelector('.settings-body');
    const contentH = listEl
      ? listEl.scrollHeight
      : (bodyEl?.scrollHeight || 0) + actionsH;
    const naturalH = Math.min(PANEL_MAX_HEIGHT, headerH + contentH + 16);

    let placeBelow = !(spaceAbove >= naturalH + gap || spaceAbove >= spaceBelow);
    if (placeBelow) {
      openPanel.classList.add('place-below');
    }

    let maxPanelH = placeBelow
      ? Math.min(PANEL_MAX_HEIGHT, spaceBelow - gap)
      : Math.min(PANEL_MAX_HEIGHT, spaceAbove - gap);
    maxPanelH = Math.max(120, maxPanelH);

    openPanel.style.maxHeight = `${maxPanelH}px`;
    if (listEl) {
      listEl.style.maxHeight = `${Math.max(60, maxPanelH - headerH - 12)}px`;
    }
    if (bodyEl && settingsOpen) {
      bodyEl.style.maxHeight = `${Math.max(80, maxPanelH - headerH - actionsH - 8)}px`;
      bodyEl.style.overflowY = 'auto';
    }

    let panelRect = openPanel.getBoundingClientRect();
    if (!placeBelow && panelRect.top < VIEWPORT_MARGIN && spaceBelow > spaceAbove) {
      openPanel.classList.add('place-below');
      placeBelow = true;
      maxPanelH = Math.min(PANEL_MAX_HEIGHT, spaceBelow - gap);
      maxPanelH = Math.max(120, maxPanelH);
      openPanel.style.maxHeight = `${maxPanelH}px`;
      if (listEl) {
        listEl.style.maxHeight = `${Math.max(60, maxPanelH - headerH - 12)}px`;
      }
      panelRect = openPanel.getBoundingClientRect();
    }

    if (panelRect.right > window.innerWidth - VIEWPORT_MARGIN) {
      openPanel.classList.add('place-left');
      panelRect = openPanel.getBoundingClientRect();
    }

    let shiftX = 0;
    panelRect = openPanel.getBoundingClientRect();
    if (panelRect.right > window.innerWidth - VIEWPORT_MARGIN) {
      shiftX = window.innerWidth - VIEWPORT_MARGIN - panelRect.right;
    }
    if (panelRect.left + shiftX < VIEWPORT_MARGIN) {
      shiftX = VIEWPORT_MARGIN - panelRect.left;
    }
    openPanel.style.transform = shiftX ? `translateX(${shiftX}px)` : '';
  }

  function updatePanelLayout() {
    if (!wrap || (!historyOpen && !settingsOpen)) return;

    const openPanel = historyOpen ? historyPanel : settingsPanel;
    const ballRow = shadow.getElementById('ballRow');
    if (!openPanel || !ballRow) return;

    const ballRect = ballRow.getBoundingClientRect();
    fitPanelInViewport(openPanel, ballRect);
  }

  function scheduleLayoutUpdate() {
    requestAnimationFrame(() => {
      updatePanelLayout();
      requestAnimationFrame(updatePanelLayout);
    });
  }

  async function renderHistory() {
    const res = await send('GET_HISTORY', { limit: 12, sort: 'time_desc' });
    const items = res.items || [];
    if (!items.length) {
      histList.innerHTML = `<div class="empty">${escapeHtml(msg('fbEmpty'))}</div>`;
      if (historyOpen) scheduleLayoutUpdate();
      return;
    }
    cachedHistory = items;
    histList.innerHTML = items
      .map(
        (item, idx) => `
      <div class="hist-item" data-idx="${idx}">
        <div class="hist-text">${escapeHtml(item.text.slice(0, 120))}</div>
        <div class="hist-meta">${escapeHtml((item.sourceTitle || item.source || '').slice(0, 40))}</div>
      </div>`
      )
      .join('');

    histList.querySelectorAll('.hist-item').forEach((el) => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const text = cachedHistory[parseInt(el.dataset.idx, 10)]?.text || '';
        if (!text) return;
        await send('IGNORE_CLIPBOARD_CAPTURE', { text, ttlMs: 8000 });
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          await send('COPY_TO_CLIPBOARD', { text });
        }
        showToast(msg('fbCopied'));
      });
    });
    if (historyOpen) scheduleLayoutUpdate();
  }

  async function openHistoryPanel() {
    if (settingsOpen) closeSettings();
    historyOpen = true;
    historyPanel.classList.add('open');
    await renderHistory();
    scheduleLayoutUpdate();
  }

  async function toggleHistoryPanel() {
    if (historyOpen) {
      closeHistory();
      return;
    }
    await openHistoryPanel();
  }

  function openSettingsPanel() {
    closeHistory();
    settingsOpen = true;
    settingsPanel.classList.add('open');
    swShrink.checked = fbSettings.shrunk;
    swHide.checked = false;
    hideOptions.classList.remove('visible');
    shadow.querySelectorAll('input[name="hideMode"]').forEach((r) => {
      r.checked = false;
    });
    scheduleLayoutUpdate();
  }

  function removeOrphanHosts() {
    document.querySelectorAll('#clipvault-fb-host').forEach((el) => el.remove());
  }

  function mountUI() {
    removeOrphanHosts();
    root = document.createElement('div');
    root.id = 'clipvault-fb-host';
    shadow = root.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>${styles}</style>
      <div class="wrap" id="wrap">
        <div class="anchor" id="anchor">
          <div class="panel" id="historyPanel">
            <div class="panel-hd">${escapeHtml(msg('fbHistoryTitle'))}</div>
            <div class="panel-list" id="histList"></div>
          </div>
          <div class="settings-panel" id="settingsPanel">
            <div class="panel-hd">${escapeHtml(msg('fbSettingsTitle'))}</div>
            <div class="settings-body">
              <div class="row">
                <span>${escapeHtml(msg('fbShrink'))}</span>
                <label class="switch"><input type="checkbox" id="swShrink" /><span class="slider"></span></label>
              </div>
              <div class="row">
                <span>${escapeHtml(msg('fbHide'))}</span>
                <label class="switch"><input type="checkbox" id="swHide" /><span class="slider"></span></label>
              </div>
              <div class="hide-options" id="hideOptions">
                <label><input type="radio" name="hideMode" value="session" /> ${escapeHtml(msg('fbHideSession'))}</label>
                <label><input type="radio" name="hideMode" value="permanent" /> ${escapeHtml(msg('fbHidePermanent'))}</label>
                <label><input type="radio" name="hideMode" value="site" /> ${escapeHtml(msg('fbHideSite'))}</label>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-ghost" id="btnCancel">${escapeHtml(msg('fbCancel'))}</button>
              <button type="button" class="btn btn-primary" id="btnApply">${escapeHtml(msg('fbApply'))}</button>
            </div>
          </div>
          <div class="ball-row" id="ballRow">
            <div class="ball-wrap" id="ballWrap">
              <button type="button" class="close-btn" id="closeBtn" title="${escapeHtml(msg('fbCloseBtn'))}">×</button>
              <div class="ball" id="ball" title="${escapeHtml(msg('fbHistoryTitle'))}">
                ${BALL_ICON_SVG}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
    `;

    document.documentElement.appendChild(root);

    wrap = shadow.getElementById('wrap');
    ball = shadow.getElementById('ball');
    historyPanel = shadow.getElementById('historyPanel');
    settingsPanel = shadow.getElementById('settingsPanel');
    histList = shadow.getElementById('histList');
    swShrink = shadow.getElementById('swShrink');
    swHide = shadow.getElementById('swHide');
    hideOptions = shadow.getElementById('hideOptions');
    toast = shadow.getElementById('toast');

    bindEvents();
    applyShrunkClass();
    applyAppearance(appearancePreference);
  }

  function bindEvents() {
    swHide.addEventListener('change', () => {
      hideOptions.classList.toggle('visible', swHide.checked);
      if (swHide.checked) {
        const sessionRadio = shadow.querySelector('input[name="hideMode"][value="session"]');
        if (sessionRadio) sessionRadio.checked = true;
      }
    });

    shadow.getElementById('btnCancel').addEventListener('click', closeSettings);

    shadow.getElementById('btnApply').addEventListener('click', async () => {
      const shrunk = swShrink.checked;
      await saveFbSettings({ shrunk });
      fbSettings.shrunk = shrunk;
      applyShrunkClass();

      if (swHide.checked) {
        const mode = shadow.querySelector('input[name="hideMode"]:checked')?.value;
        if (!mode) return;
        if (mode === 'session') {
          sessionStorage.setItem(SESSION_HIDE_KEY, '1');
          destroy();
          return;
        }
        if (mode === 'permanent') {
          await saveFbSettings({ permanentlyDisabled: true });
          destroy();
          return;
        }
        if (mode === 'site') {
          const sites = [...(fbSettings.disabledSites || [])];
          if (!sites.includes(HOSTNAME)) sites.push(HOSTNAME);
          await saveFbSettings({ disabledSites: sites });
          destroy();
          return;
        }
      }

      closeSettings();
    });

    shadow.getElementById('closeBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openSettingsPanel();
    });

    ball.addEventListener('pointerdown', onBallPointerDown);
    ball.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('pointermove', onDocumentPointerMove);
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);

    document.addEventListener(
      'click',
      (e) => {
        if (!root?.isConnected) return;
        const path = e.composedPath();
        if (!path.includes(root)) {
          closeHistory();
          closeSettings();
        }
      },
      true
    );

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (appearancePreference === 'system') applyAppearance('system');
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.settings?.newValue) return;
      const next = changes.settings.newValue;
      if (next.theme !== undefined) {
        appearancePreference = next.theme;
        applyAppearance(appearancePreference);
      }
      const fb = next.floatingBall;
      if (!fb) return;
      if (
        fb.enabled === false ||
        fb.permanentlyDisabled ||
        fb.disabledSites?.some((s) => HOSTNAME.includes(s))
      ) {
        destroy();
        return;
      }
      if (fb.shrunk !== undefined) {
        fbSettings.shrunk = fb.shrunk;
        applyShrunkClass();
      }
    });

    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === 'HISTORY_UPDATED' && historyOpen) renderHistory();
    });

    window.addEventListener('resize', () => {
      if (historyOpen || settingsOpen) scheduleLayoutUpdate();
    });
  }

  function onBallPointerDown(e) {
    if (e.button !== 0) return;
    pointerId = e.pointerId;
    pointerStart = { x: e.clientX, y: e.clientY };
    isDragging = false;
    const rect = wrap.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    ball.setPointerCapture(e.pointerId);
  }

  function onDocumentPointerMove(e) {
    if (pointerId === null || e.pointerId !== pointerId || !pointerStart) return;
    const dist = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
    if (!isDragging && dist > DRAG_THRESHOLD) {
      isDragging = true;
      ball.classList.add('dragging');
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      const rect = wrap.getBoundingClientRect();
      wrap.style.left = `${rect.left}px`;
      wrap.style.top = `${rect.top}px`;
    }
    if (!isDragging) return;
    const pos = clampDragPosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
    wrap.style.left = `${pos.left}px`;
    wrap.style.top = `${pos.top}px`;
  }

  function onDocumentPointerUp(e) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    try {
      ball.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!isDragging) {
      toggleHistoryPanel();
    } else if (historyOpen || settingsOpen) {
      scheduleLayoutUpdate();
    } else {
      clampWrapToViewport();
    }
    pointerId = null;
    pointerStart = null;
    isDragging = false;
    ball.classList.remove('dragging');
  }

  function destroy() {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
    root?.remove();
    removeOrphanHosts();
    window.__clipVaultFB = 'hidden';
  }

  async function init() {
    if (window.__clipVaultFB === 'hidden') return;
    if (!(await shouldShow())) return;
    const settingsRes = await send('GET_SETTINGS');
    appearancePreference = settingsRes.settings?.theme || 'system';
    fbSettings = await loadFbSettings();
    fbSettings.disabledSites = fbSettings.disabledSites || [];
    mountUI();
  }

  init();
})();
