import { Storage, SnippetStorage, SettingsStorage, SearchStorage } from '../shared/storage.js';
import { ContentDetector } from '../shared/content-detector.js';
import { ErrorHandler } from '../shared/error-handler.js';
import { searchAcrossTabs, highlightAtPosition } from '../shared/search.js';
import { generateId } from '../shared/storage.js';
import { enableSidePanelGlobally } from '../shared/sidepanel-helper.js';
import { normalizeClipboardText } from '../shared/storage.js';
import { AIEngine } from '../shared/ai-engine.js';

let aiInitialized = false;

async function ensureAI() {
  if (aiInitialized) return AIEngine;
  aiInitialized = true;
  try {
    const settings = await SettingsStorage.getSettings();
    if (settings.ai?.enabled) {
      await AIEngine.init(settings);
    }
  } catch (err) {
    ErrorHandler.log('aiInit', err);
  }
  return AIEngine;
}

const RESTRICTED_PREFIXES = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'devtools:'];

/** 串行处理剪贴板消息，避免并发读写 storage 导致去重失效 */
let clipboardQueue = Promise.resolve();

/** 内存级快速去重（与 storage 去重窗口配合，挡住毫秒级双发） */
const recentClipboard = new Map();

function shouldSkipInMemory(text) {
  const key = normalizeClipboardText(text);
  if (!key) return true;
  const now = Date.now();
  const last = recentClipboard.get(key);
  if (last != null && now - last < 5000) return true;
  recentClipboard.set(key, now);
  if (recentClipboard.size > 200) {
    for (const [k, t] of recentClipboard) {
      if (now - t > 60000) recentClipboard.delete(k);
    }
  }
  return false;
}

function enqueueClipboardUpdate(message) {
  const normalized = normalizeClipboardText(message.text);
  if (!normalized) return Promise.resolve(null);
  const payload = { ...message, text: normalized };
  if (shouldSkipInMemory(normalized)) {
    return Promise.resolve(null);
  }
  clipboardQueue = clipboardQueue
    .then(() => handleClipboardUpdate(payload))
    .catch((err) => {
      ErrorHandler.log('clipboardQueue', err);
    });
  return clipboardQueue;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((p) => url.startsWith(p));
}

async function notifyViews() {
  chrome.runtime.sendMessage({ type: 'HISTORY_UPDATED' }).catch(() => {});
}

async function handleClipboardUpdate({ text, source, sourceTitle }) {
  try {
    const settings = await SettingsStorage.getSettings();
    if (!settings.enableAutoMonitor) return;

    if (settings.excludedSites?.length > 0 && source) {
      try {
        const domain = new URL(source).hostname;
        if (settings.excludedSites.some((site) => domain.includes(site))) return;
      } catch {
        /* ignore invalid URL */
      }
    }

    const normalizedText = normalizeClipboardText(text);
    if (!normalizedText) return;

    const detected = ContentDetector.detect(normalizedText);

    const item = {
      id: generateId(),
      text: normalizedText,
      source: source || '',
      sourceTitle: sourceTitle || '',
      type: 'history',
      contentType: detected.type,
      createdAt: Date.now(),
      isFavorite: false,
      snippetGroup: null,
      tags: [],
      charCount: normalizedText.length,
      isTruncated: false
    };

    const saved = await Storage.addHistoryItem(item);
    if (saved) await notifyViews();

    if (saved && settings.ai?.enabled && settings.ai?.features?.autoTag) {
      triggerAutoTag(saved.id, saved.text, detected.type);
    }
  } catch (err) {
    ErrorHandler.log('handleClipboardUpdate', err);
    throw err;
  }
}

async function autoCleanup() {
  try {
    const settings = await SettingsStorage.getSettings();
    const cutoff = Date.now() - settings.autoDeleteDays * 24 * 60 * 60 * 1000;
    const history = await Storage.getHistory(Infinity, 0, 'time_desc');
    const toDelete = history.filter((h) => !h.isFavorite && h.createdAt < cutoff);
    if (toDelete.length > 0) {
      await Storage.deleteHistoryItems(toDelete.map((h) => h.id));
      await notifyViews();
    }
  } catch (err) {
    ErrorHandler.log('autoCleanup', err);
  }
}

async function triggerAutoTag(itemId, text, contentType) {
  try {
    const engine = await ensureAI();
    if (!engine || !engine.getStatus().available) return;

    const result = await engine.tag(text, { contentType });
    const history = (await getLocal(KEYS.history)) || [];
    const item = history.find((h) => h.id === itemId);
    if (!item) return;

    item.aiTags = result.tags || [];
    item.aiCategory = result.category || null;
    item.aiLanguage = result.language || null;
    item.aiProcessedAt = Date.now();
    item.aiProcessing = false;

    await setLocal({ [KEYS.history]: history });
    await notifyViews();

    const settings = await SettingsStorage.getSettings();
    if (settings.ai?.features?.smartSearch && engine.getStatus().channel === 'openai') {
      const embedResult = await engine.embed(text);
      if (embedResult.embedding) {
        item.aiEmbedding = embedResult.embedding;
        await setLocal({ [KEYS.history]: history });
      }
    }
  } catch (err) {
    ErrorHandler.log('autoTag', err);
  }
}

async function getLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => resolve(data[key]));
  });
}

async function setLocal(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

const KEYS = { history: 'clipHistory', groups: 'snippetGroups', settings: 'settings' };

function broadcastSwReady() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && !isRestrictedUrl(tab.url)) {
        chrome.tabs.sendMessage(tab.id, { type: 'SW_READY' }).catch(() => {});
      }
    });
  });
}

async function injectContentScriptsIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url?.startsWith('http')) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
    } catch {
      /* 已注入或无法访问的页面 */
    }
    try {
      const [{ result: hasBall } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => !!window.__clipVaultFB
      });
      if (!hasBall) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/floating-ball.js']
        });
      }
    } catch {
      /* 无法访问的页面 */
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('keepalive', { periodInMinutes: 4.5 });
  chrome.alarms.create('autoCleanup', { periodInMinutes: 60 });

  const settings = await SettingsStorage.getSettings();
  if (!settings) {
    await SettingsStorage.saveSettings({});
  }

  enableSidePanelGlobally();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }

  await injectContentScriptsIntoOpenTabs();
  broadcastSwReady();
});

chrome.runtime.onStartup.addListener(async () => {
  enableSidePanelGlobally();
  await injectContentScriptsIntoOpenTabs();
  broadcastSwReady();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    chrome.tabs.sendMessage(tabId, { type: 'SW_READY' }).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    chrome.storage.local.get('settings');
    broadcastSwReady();
  }
  if (alarm.name === 'autoCleanup') {
    autoCleanup();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-sidebar' || !chrome.sidePanel?.open) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id) {
      chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel/sidepanel.html',
        enabled: true
      });
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Offscreen Document 的消息由 offscreen.js 自行处理，这里跳过
  if (message.type?.startsWith('OFFSCREEN_AI_')) return false;

  const handle = async () => {
    switch (message.type) {
      case 'CONTENT_SCRIPT_READY':
        return { ok: true };

      case 'CLIPBOARD_UPDATE':
        await enqueueClipboardUpdate(message);
        return { ok: true };

      case 'SEARCH_TABS': {
        const settings = await SettingsStorage.getSettings();
        const options = {
          caseSensitive: message.options?.caseSensitive ?? settings.searchCaseSensitive,
          useRegex: message.options?.useRegex ?? settings.searchUseRegex
        };
        const results = await searchAcrossTabs(message.query, options);
        return { type: 'SEARCH_RESULT', results };
      }

      case 'HIGHLIGHT_TAB': {
        const { tabId, position } = message;
        await chrome.tabs.update(tabId, { active: true });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: highlightAtPosition,
          args: [position]
        });
        return { ok: true };
      }

      case 'DELETE_ITEM':
        await Storage.deleteHistoryItem(message.id);
        await notifyViews();
        return { ok: true };

      case 'DELETE_ITEMS':
        await Storage.deleteHistoryItems(message.ids);
        await notifyViews();
        return { ok: true };

      case 'BATCH_FAVORITE':
        await Storage.batchFavorite(message.ids, message.isFavorite);
        await notifyViews();
        return { ok: true };

      case 'CLEAR_HISTORY':
        await Storage.clearHistory();
        await notifyViews();
        return { ok: true };

      case 'TOGGLE_FAVORITE': {
        const item = await Storage.toggleFavorite(message.id);
        await notifyViews();
        return { item };
      }

      case 'GET_HISTORY': {
        const settings = await SettingsStorage.getSettings();
        const sort = message.sort || settings.defaultSort;
        const items = message.query
          ? await SearchStorage.searchHistory(message.query)
          : await Storage.getHistory(message.limit ?? 100, 0, sort);
        return { items };
      }

      case 'GET_SNIPPETS': {
        const snippets = message.query
          ? await SearchStorage.searchSnippets(message.query)
          : await SnippetStorage.getSnippets(message.groupId ?? null);
        const groups = await SnippetStorage.getGroups();
        return { snippets, groups };
      }

      case 'SAVE_SNIPPET': {
        const snippet = await SnippetStorage.saveSnippet(message.snippet);
        await notifyViews();
        return { snippet };
      }

      case 'DELETE_SNIPPET':
        await SnippetStorage.deleteSnippet(message.id);
        await notifyViews();
        return { ok: true };

      case 'CREATE_GROUP': {
        const group = await SnippetStorage.createGroup(message.group);
        return { group };
      }

      case 'DELETE_GROUP':
        await SnippetStorage.deleteGroup(message.groupId);
        await notifyViews();
        return { ok: true };

      case 'GET_SETTINGS':
        return { settings: await SettingsStorage.getSettings() };

      case 'SAVE_SETTINGS':
        await SettingsStorage.saveSettings(message.settings);
        return { ok: true };

      case 'SAVE_FLOATING_BALL': {
        const current = await SettingsStorage.getSettings();
        await SettingsStorage.saveSettings({
          floatingBall: { ...current.floatingBall, ...message.floatingBall }
        });
        return { ok: true, floatingBall: (await SettingsStorage.getSettings()).floatingBall };
      }

      case 'TOGGLE_SIDEBAR':
        return {
          ok: false,
          error: chrome.i18n.getMessage('sidebarGestureError')
        };

      case 'AI_INIT': {
        await ensureAI();
        const settings = await SettingsStorage.getSettings();
        if (!settings.ai?.enabled) {
          return { channel: null, available: false, reason: 'AI features are disabled. Enable the toggle above.' };
        }
        await AIEngine.init(settings);
        return AIEngine.getStatus();
      }

      case 'AI_GET_STATUS': {
        if (!AIEngine) return { channel: null, available: false, reason: 'not_initialized' };
        return AIEngine.getStatus();
      }

      case 'AI_TAG_ITEM': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { ok: false, error: 'AI not available' };
        const history = (await getLocal(KEYS.history)) || [];
        const item = history.find((h) => h.id === message.id);
        if (!item) return { ok: false, error: 'Item not found' };
        const result = await engine.tag(item.text, { contentType: item.contentType });
        item.aiTags = result.tags || [];
        item.aiCategory = result.category || null;
        item.aiLanguage = result.language || null;
        item.aiProcessedAt = Date.now();
        await setLocal({ [KEYS.history]: history });
        await notifyViews();
        return { item };
      }

      case 'AI_SUMMARIZE': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { ok: false, error: 'AI not available' };
        const history = (await getLocal(KEYS.history)) || [];
        const item = history.find((h) => h.id === message.id);
        if (!item) return { ok: false, error: 'Item not found' };
        const result = await engine.summarize(item.text);
        item.aiSummary = result.summary;
        await setLocal({ [KEYS.history]: history });
        await notifyViews();
        return result;
      }

      case 'AI_TRANSLATE': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { ok: false, error: 'AI not available' };
        const history = (await getLocal(KEYS.history)) || [];
        const item = history.find((h) => h.id === message.id);
        if (!item) return { ok: false, error: 'Item not found' };
        const targetLang = message.targetLang || 'en';
        const result = await engine.translate(item.text, targetLang);
        if (result?.translatedText) {
          item.aiTranslation = result.translatedText;
          item.aiTranslationLang = targetLang;
          await setLocal({ [KEYS.history]: history });
          await notifyViews();
        }
        return result;
      }

      case 'AI_REWRITE': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { ok: false, error: 'AI not available' };
        const history = (await getLocal(KEYS.history)) || [];
        const item = history.find((h) => h.id === message.id);
        if (!item) return { ok: false, error: 'Item not found' };
        return await engine.rewrite(item.text, message.style || 'formal');
      }

      case 'AI_SEMANTIC_SEARCH': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { items: [] };
        const history = await Storage.getAllItems();
        const results = await engine.semanticSearch(
          message.query,
          history.filter((h) => h.type === 'history'),
          { topK: message.topK || 20 }
        );
        const idToScore = new Map(results.map((r) => [r.id, r.score]));
        const matched = history
          .filter((h) => idToScore.has(h.id))
          .sort((a, b) => (idToScore.get(b.id) || 0) - (idToScore.get(a.id) || 0));
        return { items: matched, scores: Object.fromEntries(idToScore) };
      }

      case 'AI_PROCESS_PENDING': {
        const engine = await ensureAI();
        if (!engine?.getStatus().available) return { processed: 0 };
        const history = (await getLocal(KEYS.history)) || [];
        const pending = history.filter((h) => h.type === 'history' && !h.aiProcessedAt);
        let processed = 0;
        for (const item of pending.slice(0, 20)) {
          try {
            const result = await engine.tag(item.text, { contentType: item.contentType });
            item.aiTags = result.tags || [];
            item.aiCategory = result.category || null;
            item.aiLanguage = result.language || null;
            item.aiProcessedAt = Date.now();
            processed++;
          } catch (err) {
            ErrorHandler.log('aiProcessPending', err);
            break;
          }
        }
        await setLocal({ [KEYS.history]: history });
        await notifyViews();
        return { processed };
      }

      default:
        return null;
    }
  };

  handle()
    .then((result) => {
      sendResponse(
        result != null ? result : { ok: false, error: `Unknown message: ${message.type}` }
      );
    })
    .catch((err) => {
      ErrorHandler.log('onMessage', err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    });

  return true;
});

broadcastSwReady();
