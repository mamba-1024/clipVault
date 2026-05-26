export function getSelectedText() {
  const selection = window.getSelection().toString().trim();
  if (selection) return selection;

  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (start !== end) {
      return active.value.substring(start, end).trim();
    }
  }
  return '';
}

export function sendClipboardUpdate(text, sendFn) {
  if (!text) return;

  const payload = {
    type: 'CLIPBOARD_UPDATE',
    text,
    source: location.href,
    sourceTitle: document.title
  };

  sendFn(payload, (response) => {
    if (chrome.runtime.lastError) {
      const pending = JSON.parse(localStorage.getItem('_cv_pending') || '[]');
      pending.push({ ...payload, retryAt: Date.now() + 2000 });
      localStorage.setItem('_cv_pending', JSON.stringify(pending.slice(-10)));
    }
  });
}

export function flushPendingMessages(sendFn) {
  const pending = JSON.parse(localStorage.getItem('_cv_pending') || '[]');
  if (pending.length === 0) return;
  pending.forEach((p) => sendFn(p));
  localStorage.removeItem('_cv_pending');
}
