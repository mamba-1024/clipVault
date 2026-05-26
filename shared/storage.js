const DEFAULT_SETTINGS = {
  maxHistorySize: 500,
  maxItemLength: 5000,
  autoDeleteDays: 30,
  enableAutoMonitor: true,
  excludedSites: [],
  duplicateIntervalSec: 60,
  theme: 'system',
  defaultSort: 'time_desc',
  searchCaseSensitive: false,
  searchUseRegex: false,
  language: 'auto',
  floatingBall: {
    enabled: true,
    shrunk: false,
    permanentlyDisabled: false,
    disabledSites: []
  },
  ai: {
    enabled: false,
    channel: 'chrome',
    provider: 'openai',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    openaiEndpoint: 'https://api.openai.com/v1',
    embeddingModel: 'text-embedding-3-small',
    features: {
      autoTag: true,
      smartSearch: true,
      translateEnabled: true,
      rewriteEnabled: true
    },
    rateLimitPerMinute: 15,
    /** @deprecated 使用 translateTargetLang */
    language: 'auto',
    translateTargetLang: 'auto'
  }
};

const KEYS = {
  history: 'clipHistory',
  groups: 'snippetGroups',
  settings: 'settings'
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

/** 规范化文本，避免空格/换行差异导致去重失效 */
export function normalizeClipboardText(text) {
  return (text || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ');
}

function textsMatch(a, b) {
  return normalizeClipboardText(a) === normalizeClipboardText(b);
}

function isHistoryDuplicateEntry(h, text, now, windowMs) {
  return h.type === 'history' && textsMatch(h.text, text) && now - h.createdAt < windowMs;
}

/** 去掉时间窗内同文的其他条目（保留 exceptId） */
function stripSameTextInWindow(history, text, now, windowMs, exceptId = null) {
  return history.filter(
    (h) =>
      !(
        h.type === 'history' &&
        textsMatch(h.text, text) &&
        now - h.createdAt < windowMs &&
        h.id !== exceptId
      )
  );
}

function sortHistory(items, sort) {
  const list = [...items];
  switch (sort) {
    case 'time_asc':
      return list.sort((a, b) => a.createdAt - b.createdAt);
    case 'char_count':
      return list.sort((a, b) => b.charCount - a.charCount);
    case 'source':
      return list.sort((a, b) =>
        (a.sourceTitle || a.source || '').localeCompare(b.sourceTitle || b.source || '')
      );
    case 'time_desc':
    default:
      return list.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function getLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => resolve(data[key]));
  });
}

function setLocal(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

export const SettingsStorage = {
  async getSettings() {
    const saved = (await getLocal(KEYS.settings)) || {};
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      floatingBall: { ...DEFAULT_SETTINGS.floatingBall, ...saved.floatingBall },
      ai: {
        ...DEFAULT_SETTINGS.ai,
        ...(saved.ai || {}),
        features: { ...DEFAULT_SETTINGS.ai.features, ...(saved.ai?.features || {}) },
        translateTargetLang:
          saved.ai?.translateTargetLang || saved.ai?.language || DEFAULT_SETTINGS.ai.translateTargetLang
      }
    };
  },

  async saveSettings(partial) {
    const current = await this.getSettings();
    await setLocal({ [KEYS.settings]: { ...current, ...partial } });
    return { ...current, ...partial };
  },

  async exportData() {
    const data = await chrome.storage.local.get(null);
    return JSON.stringify(data, null, 2);
  },

  async importData(jsonString) {
    const data = JSON.parse(jsonString);
    await setLocal(data);
  }
};

export const Storage = {
  async getHistory(limit = 50, offset = 0, sort = 'time_desc') {
    const history = (await getLocal(KEYS.history)) || [];
    const historyOnly = history.filter((h) => h.type === 'history');
    const sorted = sortHistory(historyOnly, sort);
    return sorted.slice(offset, offset + limit);
  },

  async getAllItems() {
    return (await getLocal(KEYS.history)) || [];
  },

  async getSettings() {
    return SettingsStorage.getSettings();
  },

  async addHistoryItem(item) {
    const settings = await SettingsStorage.getSettings();
    let text = normalizeClipboardText(item.text || '');
    if (!text) return null;

    let isTruncated = false;
    if (text.length > settings.maxItemLength) {
      text = text.slice(0, settings.maxItemLength);
      isTruncated = true;
    }

    let history = (await getLocal(KEYS.history)) || [];
    const now = Date.now();
    const duplicateWindow = settings.duplicateIntervalSec * 1000;

    const applyMerge = (existing) => {
      const merged = {
        ...existing,
        text,
        createdAt: now,
        source: item.source ?? existing.source,
        sourceTitle: item.sourceTitle ?? existing.sourceTitle,
        charCount: text.length,
        isTruncated: isTruncated || existing.isTruncated
      };
      const withoutOld = history.filter((h) => h.id !== existing.id);
      const cleaned = stripSameTextInWindow(withoutOld, text, now, duplicateWindow, merged.id);
      return [merged, ...cleaned];
    };

    // 最新一条已是相同内容：只更新时间（避免连续两次写入产生两条）
    if (history[0]?.type === 'history' && textsMatch(history[0].text, text)) {
      history = applyMerge(history[0]);
      await setLocal({ [KEYS.history]: history });
      return history[0];
    }

    const dup = history.find((h) => isHistoryDuplicateEntry(h, text, now, duplicateWindow));
    if (dup) {
      history = applyMerge(dup);
      await setLocal({ [KEYS.history]: history });
      return history[0];
    }

    history = stripSameTextInWindow(history, text, now, duplicateWindow);

    const newItem = {
      ...item,
      id: item.id || generateId(),
      text,
      charCount: text.length,
      isTruncated,
      type: item.type || 'history',
      createdAt: item.createdAt || now,
      aiTags: [],
      aiSummary: null,
      aiTranslation: null,
      aiTranslationLang: null,
      aiCategory: null,
      aiLanguage: null,
      aiEmbedding: null,
      aiProcessedAt: null,
      aiProcessing: false
    };

    history.unshift(newItem);

    const historyOnly = history.filter((h) => h.type === 'history');
    if (historyOnly.length > settings.maxHistorySize) {
      const toRemove = historyOnly.length - settings.maxHistorySize;
      const sorted = sortHistory(historyOnly, 'time_asc');
      const removeIds = new Set(sorted.slice(0, toRemove).map((h) => h.id));
      const trimmed = history.filter((h) => h.type !== 'history' || !removeIds.has(h.id));
      await setLocal({ [KEYS.history]: trimmed });
      return newItem;
    }

    await setLocal({ [KEYS.history]: history });
    return newItem;
  },

  async deleteHistoryItem(id) {
    const history = (await getLocal(KEYS.history)) || [];
    await setLocal({ [KEYS.history]: history.filter((h) => h.id !== id) });
  },

  async deleteHistoryItems(ids) {
    const idSet = new Set(ids);
    const history = (await getLocal(KEYS.history)) || [];
    await setLocal({ [KEYS.history]: history.filter((h) => !idSet.has(h.id)) });
  },

  async clearHistory() {
    const history = (await getLocal(KEYS.history)) || [];
    const kept = history.filter((h) => h.type === 'snippet' || h.isFavorite);
    await setLocal({ [KEYS.history]: kept });
  },

  async toggleFavorite(id) {
    const history = (await getLocal(KEYS.history)) || [];
    const item = history.find((h) => h.id === id);
    if (!item) return null;
    item.isFavorite = !item.isFavorite;
    await setLocal({ [KEYS.history]: history });
    return item;
  },

  async batchFavorite(ids, isFavorite) {
    const idSet = new Set(ids);
    const history = (await getLocal(KEYS.history)) || [];
    history.forEach((h) => {
      if (idSet.has(h.id)) h.isFavorite = isFavorite;
    });
    await setLocal({ [KEYS.history]: history });
  }
};

export const SnippetStorage = {
  async getSnippets(groupId = null) {
    const history = (await getLocal(KEYS.history)) || [];
    const snippets = history.filter((h) => h.type === 'snippet');
    if (groupId === null) return snippets;
    if (groupId === 'ungrouped') return snippets.filter((s) => !s.snippetGroup);
    return snippets.filter((s) => s.snippetGroup === groupId);
  },

  async saveSnippet(snippet) {
    const history = (await getLocal(KEYS.history)) || [];
    const settings = await SettingsStorage.getSettings();
    let text = snippet.text || '';
    let isTruncated = false;
    if (text.length > settings.maxItemLength) {
      text = text.slice(0, settings.maxItemLength);
      isTruncated = true;
    }

    const existing = history.findIndex((h) => h.id === snippet.id);
    const item = {
      id: snippet.id || generateId(),
      text,
      title: snippet.title || text.slice(0, 50),
      source: snippet.source || '',
      sourceTitle: snippet.sourceTitle || '',
      type: 'snippet',
      contentType: snippet.contentType || 'text',
      createdAt: snippet.createdAt || Date.now(),
      isFavorite: snippet.isFavorite ?? true,
      snippetGroup: snippet.snippetGroup || null,
      tags: snippet.tags || [],
      charCount: text.length,
      isTruncated
    };

    if (existing >= 0) {
      history[existing] = { ...history[existing], ...item };
    } else {
      history.unshift(item);
    }
    await setLocal({ [KEYS.history]: history });
    return item;
  },

  async deleteSnippet(id) {
    await Storage.deleteHistoryItem(id);
  },

  async getGroups() {
    return (await getLocal(KEYS.groups)) || [];
  },

  async createGroup(group) {
    const groups = (await getLocal(KEYS.groups)) || [];
    const newGroup = {
      id: group.id || generateId(),
      name: group.name,
      color: group.color || '#4A90D9',
      createdAt: group.createdAt || Date.now(),
      order: group.order ?? groups.length + 1
    };
    groups.push(newGroup);
    await setLocal({ [KEYS.groups]: groups });
    return newGroup;
  },

  async deleteGroup(groupId) {
    const groups = (await getLocal(KEYS.groups)) || [];
    const history = (await getLocal(KEYS.history)) || [];
    history.forEach((h) => {
      if (h.snippetGroup === groupId) h.snippetGroup = null;
    });
    await setLocal({
      [KEYS.groups]: groups.filter((g) => g.id !== groupId),
      [KEYS.history]: history
    });
  }
};

export const SearchStorage = {
  async searchHistory(query) {
    if (!query?.trim()) return Storage.getHistory(Infinity, 0, 'time_desc');
    const q = query.toLowerCase();
    const history = await Storage.getHistory(Infinity, 0, 'time_desc');
    return history.filter(
      (h) =>
        h.text.toLowerCase().includes(q) ||
        (h.sourceTitle || '').toLowerCase().includes(q) ||
        (h.source || '').toLowerCase().includes(q)
    );
  },

  async searchSnippets(query) {
    const snippets = await SnippetStorage.getSnippets();
    if (!query?.trim()) return snippets;
    const q = query.toLowerCase();
    return snippets.filter(
      (s) =>
        s.text.toLowerCase().includes(q) ||
        (s.title || '').toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
};

export { generateId, DEFAULT_SETTINGS };
