(function () {
  if (window.__clipVaultCS) return;
  window.__clipVaultCS = true;

  let cachedSelection = '';
  let lastSentText = '';
  let lastSentAt = 0;
  const SEND_DEBOUNCE_MS = 3000;
  let copyCaptureTimer = null;

  function getSelectedText() {
    const selection = window.getSelection()?.toString?.() || '';
    if (selection.trim()) return selection.trim();

    const active = document.activeElement;
    if (!active) return '';

    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      if (start !== end) {
        return active.value.substring(start, end).trim();
      }
      return '';
    }

    if (active.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        return sel.toString().trim();
      }
    }

    return '';
  }

  function cacheSelection() {
    const text = getSelectedText();
    if (text) cachedSelection = text;
  }

  function normalizeText(text) {
    return (text || '')
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ');
  }

  const memoryPending = [];
  let ignoreClipboardUntil = 0;
  let ignoreClipboardText = '';

  function markInternalClipboardWrite(text) {
    const norm = normalizeText(text);
    ignoreClipboardUntil = Date.now() + 8000;
    ignoreClipboardText = norm;
    try {
      chrome.runtime.sendMessage({ type: 'IGNORE_CLIPBOARD_CAPTURE', text: norm });
    } catch {
      /* 扩展未就绪 */
    }
  }

  function shouldIgnoreClipboardCapture(text) {
    const norm = normalizeText(text);
    if (!norm) return true;
    if (Date.now() < ignoreClipboardUntil) {
      if (!ignoreClipboardText || ignoreClipboardText === norm) return true;
    }
    return false;
  }

  function queuePending(payload) {
    try {
      const pending = JSON.parse(localStorage.getItem('_cv_pending') || '[]');
      pending.push({ ...payload, retryAt: Date.now() + 2000 });
      localStorage.setItem('_cv_pending', JSON.stringify(pending.slice(-10)));
    } catch {
      memoryPending.push(payload);
      if (memoryPending.length > 10) memoryPending.shift();
    }
  }

  function sendClipboardUpdate(text) {
    text = normalizeText(text);
    if (!text || shouldIgnoreClipboardCapture(text)) return;

    const now = Date.now();
    if (text === lastSentText && now - lastSentAt < SEND_DEBOUNCE_MS) return;
    lastSentText = text;
    lastSentAt = now;

    const payload = {
      type: 'CLIPBOARD_UPDATE',
      text,
      source: location.href,
      sourceTitle: document.title
    };

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          queuePending(payload);
          return;
        }
        if (response?.error) {
          console.warn('[ClipVault]', response.error);
        }
      });
    } catch {
      queuePending(payload);
    }
  }

  /** 一次复制只上报一次：优先读剪贴板（与系统一致），失败再用选区 */
  function scheduleClipboardCapture() {
    clearTimeout(copyCaptureTimer);
    copyCaptureTimer = setTimeout(async () => {
      let text = '';
      if (navigator.clipboard?.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          /* 无权限或页面限制 */
        }
      }
      text = normalizeText(text);
      if (!text) {
        text = normalizeText(getSelectedText() || cachedSelection);
      }
      if (text) sendClipboardUpdate(text);
    }, 100);
  }

  function flushPending() {
    let pending = [];
    try {
      pending = JSON.parse(localStorage.getItem('_cv_pending') || '[]');
      localStorage.removeItem('_cv_pending');
    } catch {
      /* ignore */
    }
    pending = pending.concat(memoryPending.splice(0));
    if (!pending.length) return;
    const seen = new Set();
    pending.forEach((p) => {
      const key = normalizeText(p.text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      try {
        chrome.runtime.sendMessage(p, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        queuePending(p);
      }
    });
  }

  document.addEventListener(
    'selectionchange',
    () => {
      cacheSelection();
    },
    true
  );

  document.addEventListener(
    'mouseup',
    () => {
      cacheSelection();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'x')) {
        cacheSelection();
      }
    },
    true
  );

  document.addEventListener(
    'copy',
    () => {
      cacheSelection();
      scheduleClipboardCapture();
    },
    true
  );

  document.addEventListener(
    'cut',
    () => {
      cacheSelection();
      scheduleClipboardCapture();
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SW_READY') {
      flushPending();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'COPY_TO_CLIPBOARD') {
      markInternalClipboardWrite(msg.text);
      navigator.clipboard.writeText(msg.text).then(
        () => sendResponse({ ok: true }),
        () => {
          const ta = document.createElement('textarea');
          ta.value = msg.text;
          ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          sendResponse({ ok: true });
        }
      );
      return true;
    }
  });

  try {
    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* 扩展尚未就绪 */
  }
})();
