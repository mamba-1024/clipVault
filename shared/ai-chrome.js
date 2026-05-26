// Chrome AI adapter — 通过 Offscreen Document 桥接
// 扩展页面无法直接访问 window.ai，需要离屏页面中转

let _offscreenReady = false;

async function ensureOffscreen() {
  if (_offscreenReady) return;
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run Chrome Built-in AI inference in a document context where window.ai is available'
    });
  }
  _offscreenReady = true;
}

function sendToOffscreen(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

export const ChromeAIAdapter = {
  _available: false,
  _reason: '',

  async init() {
    const result = await this.probe();
    this._available = result.available;
    this._reason = result.reason || '';
    return result;
  },

  async probe() {
    try {
      await ensureOffscreen();
      const res = await sendToOffscreen({ type: 'OFFSCREEN_AI_PROBE' });
      if (res?.error) return { available: false, reason: res.error };
      return res;
    } catch (e) {
      _offscreenReady = false;
      return { available: false, reason: e.message };
    }
  },

  async tag(text, hints) {
    return await sendToOffscreen({
      type: 'OFFSCREEN_AI_TAG',
      text,
      hints
    });
  },

  async summarize(text) {
    return await sendToOffscreen({
      type: 'OFFSCREEN_AI_SUMMARIZE',
      text
    });
  },

  async translate(text, targetLang) {
    return await sendToOffscreen({
      type: 'OFFSCREEN_AI_TRANSLATE',
      text,
      targetLang
    });
  },

  async rewrite(text, style) {
    return await sendToOffscreen({
      type: 'OFFSCREEN_AI_REWRITE',
      text,
      style
    });
  },

  async expandKeywords(query) {
    const res = await sendToOffscreen({
      type: 'OFFSCREEN_AI_EXPAND_KEYWORDS',
      query
    });
    return res?.keywords || [query];
  },

  async embed() {
    return { embedding: null };
  },

  async dispose() {
    try {
      await sendToOffscreen({ type: 'OFFSCREEN_AI_DISPOSE' });
    } catch {
      // ignore
    }
    _offscreenReady = false;
  }
};
