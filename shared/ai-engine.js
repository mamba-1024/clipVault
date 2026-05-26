import { ChromeAIAdapter } from './ai-chrome.js';
import { OpenAIAdapter } from './ai-openai.js';
import { RateLimiter } from './ai-rate-limit.js';
import { AICache } from './ai-cache.js';

let _status = { channel: null, available: false, reason: '' };
let _settings = null;
let _rateLimiter = null;

function getAdapter() {
  if (!_status.available) return null;
  return _status.channel === 'openai' ? OpenAIAdapter : ChromeAIAdapter;
}

export const AIEngine = {
  async init(settings) {
    _settings = settings;
    _rateLimiter = new RateLimiter(settings.ai?.rateLimitPerMinute || 15);
    const channel = settings.ai?.channel || 'chrome';

    if (channel === 'chrome') {
      const chromeResult = await ChromeAIAdapter.init();
      if (chromeResult.available) {
        _status = { channel: 'chrome', available: true, reason: '' };
        return _status;
      }
      if (settings.ai?.openaiApiKey) {
        const openaiResult = OpenAIAdapter.init({
          apiKey: settings.ai.openaiApiKey,
          endpoint: settings.ai.openaiEndpoint || 'https://api.openai.com/v1',
          model: settings.ai.openaiModel || 'gpt-4o-mini',
          embeddingModel: settings.ai.embeddingModel || 'text-embedding-3-small'
        });
        if (openaiResult.available) {
          _status = { channel: 'openai', available: true, reason: 'chrome_unavailable_fallback' };
          return _status;
        }
      }
      _status = { channel: 'chrome', available: false, reason: chromeResult.reason };
      return _status;
    }

    if (channel === 'openai') {
      if (!settings.ai?.openaiApiKey) {
        _status = { channel: 'openai', available: false, reason: 'no_api_key' };
        return _status;
      }
      const result = OpenAIAdapter.init({
        apiKey: settings.ai.openaiApiKey,
        endpoint: settings.ai.openaiEndpoint || 'https://api.openai.com/v1',
        model: settings.ai.openaiModel || 'gpt-4o-mini'
      });
      _status = { channel: 'openai', available: result.available, reason: result.available ? '' : 'init_failed' };
      return _status;
    }

    _status = { channel: null, available: false, reason: 'unknown_channel' };
    return _status;
  },

  getStatus() {
    return { ..._status };
  },

  async probeChromeAI() {
    return ChromeAIAdapter.probe();
  },

  async tag(text, hints) {
    const adapter = getAdapter();
    if (!adapter) throw new Error('AI engine not available');
    await _rateLimiter.acquire();

    const cached = await AICache.get(text, 'tag');
    if (cached) return cached;

    const result = await adapter.tag(text, hints);
    await AICache.set(text, 'tag', result);
    return result;
  },

  async summarize(text) {
    const adapter = getAdapter();
    if (!adapter) throw new Error('AI engine not available');
    await _rateLimiter.acquire();

    const cached = await AICache.get(text, 'summarize');
    if (cached) return cached;

    const result = await adapter.summarize(text);
    await AICache.set(text, 'summarize', result);
    return result;
  },

  async translate(text, targetLang) {
    const adapter = getAdapter();
    if (!adapter) throw new Error('AI engine not available');
    await _rateLimiter.acquire();

    const cacheKey = `translate_${targetLang}`;
    const cached = await AICache.get(text, cacheKey);
    if (cached) return cached;

    const result = await adapter.translate(text, targetLang);
    await AICache.set(text, cacheKey, result);
    return result;
  },

  async rewrite(text, style) {
    const adapter = getAdapter();
    if (!adapter) throw new Error('AI engine not available');
    await _rateLimiter.acquire();

    const cacheKey = `rewrite_${style}`;
    const cached = await AICache.get(text, cacheKey);
    if (cached) return cached;

    const result = await adapter.rewrite(text, style);
    await AICache.set(text, cacheKey, result);
    return result;
  },

  async embed(text) {
    const adapter = getAdapter();
    if (!adapter) return { embedding: null };

    if (_status.channel !== 'openai') return { embedding: null };

    const cached = await AICache.get(text, 'embed');
    if (cached) return cached;

    try {
      const result = await adapter.embed(text);
      await AICache.set(text, 'embed', result);
      return result;
    } catch {
      return { embedding: null };
    }
  },

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  },

  async semanticSearch(query, items, options = {}) {
    const topK = options.topK || 20;
    const adapter = getAdapter();

    if (!adapter) return [];

    if (_status.channel === 'openai') {
      const queryEmbed = await this.embed(query);
      if (queryEmbed.embedding) {
        const scored = items
          .filter((item) => item.aiEmbedding)
          .map((item) => ({
            id: item.id,
            score: this.cosineSimilarity(queryEmbed.embedding, item.aiEmbedding)
          }))
          .filter((r) => r.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
        return scored;
      }
    }

    try {
      const keywords = await adapter.expandKeywords(query);
      const lower = keywords.map((k) => k.toLowerCase());
      const scored = items
        .map((item) => {
          const text = (item.text || '').toLowerCase();
          let score = 0;
          for (const kw of lower) {
            if (text.includes(kw)) score += 1;
            if ((item.aiTags || []).some((tag) => tag.toLowerCase().includes(kw))) score += 0.5;
          }
          return { id: item.id, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return scored;
    } catch {
      return [];
    }
  },

  async dispose() {
    await ChromeAIAdapter.dispose();
    _status = { channel: null, available: false, reason: '' };
    _settings = null;
    _rateLimiter = null;
  }
};
