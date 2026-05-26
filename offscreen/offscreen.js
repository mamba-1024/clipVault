// Offscreen document: 运行在 chrome-extension:// 上下文中，
// 但可以访问网页端受限的 Web API（如 window.ai）
// 通过 chrome.runtime.sendMessage 与 Service Worker 通信

import { Prompts } from '../shared/ai-prompts.js';

const MAX_INPUT_CHARS = 12000;

function truncateInput(text) {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

function parseJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

function getAI() {
  if (typeof globalThis !== 'undefined' && globalThis.ai?.languageModel) return globalThis.ai;
  if (typeof window !== 'undefined' && window.ai?.languageModel) return window.ai;
  if (typeof navigator !== 'undefined' && navigator.ai?.languageModel) return navigator.ai;
  return null;
}

let _session = null;

async function ensureSession() {
  if (_session) return;
  const ai = getAI();
  if (!ai) throw new Error('Chrome AI not available in offscreen context');
  _session = await ai.languageModel.createSession();
}

async function prompt(systemPrompt, userText) {
  await ensureSession();
  const input = truncateInput(userText);
  try {
    return await _session.prompt(`${systemPrompt}\n\n${input}`);
  } catch (e) {
    _session = null;
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg.type?.startsWith('OFFSCREEN_AI_')) return false;

  const handle = async () => {
    switch (msg.type) {
      case 'OFFSCREEN_AI_PROBE': {
        const ai = getAI();
        if (!ai) return { available: false, reason: 'not_found' };
        const caps = await ai.languageModel.capabilities();
        if (caps.available === 'readily') return { available: true };
        if (caps.available === 'after-download') return { available: false, reason: 'after-download' };
        return { available: false, reason: caps.available || 'not_ready' };
      }

      case 'OFFSCREEN_AI_TAG': {
        const hintSuffix = msg.hints?.contentType ? `\nContent type: ${msg.hints.contentType}` : '';
        const raw = await prompt(Prompts.tag.system + hintSuffix, msg.text);
        const parsed = parseJSON(raw);
        return {
          tags: parsed?.tags || [],
          category: parsed?.category || null,
          language: parsed?.language || null
        };
      }

      case 'OFFSCREEN_AI_SUMMARIZE': {
        const result = await prompt(Prompts.summarize.system, msg.text);
        return { summary: (result || '').trim().slice(0, 200) };
      }

      case 'OFFSCREEN_AI_TRANSLATE': {
        const systemPrompt = Prompts.translate.system(msg.targetLang);
        const result = await prompt(systemPrompt, msg.text);
        return { translatedText: (result || '').trim() };
      }

      case 'OFFSCREEN_AI_REWRITE': {
        const systemPrompt = Prompts.rewrite.system(msg.style);
        const result = await prompt(systemPrompt, msg.text);
        return { rewrittenText: (result || '').trim() };
      }

      case 'OFFSCREEN_AI_EXPAND_KEYWORDS': {
        const raw = await prompt(Prompts.semanticSearchQuery.system, msg.query);
        const parsed = parseJSON(raw);
        return { keywords: parsed?.keywords || [msg.query] };
      }

      case 'OFFSCREEN_AI_DISPOSE': {
        if (_session?.destroy) _session.destroy();
        _session = null;
        return { ok: true };
      }

      default:
        return null;
    }
  };

  handle()
    .then((result) => sendResponse(result ?? { error: 'unknown_offscreen_action' }))
    .catch((err) => sendResponse({ error: err?.message || String(err) }));

  return true;
});
