import { Prompts } from './ai-prompts.js';

const MAX_INPUT_CHARS = 8000;

function truncateInput(text) {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

// 规范化 endpoint：去掉末尾的斜杠和已知路径后缀，防止拼接重复
function normalizeEndpoint(ep) {
  return ep.replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/embeddings$/i, '');
}

export const OpenAIAdapter = {
  _config: null,

  init(config) {
    this._config = {
      ...config,
      endpoint: normalizeEndpoint(config.endpoint || '')
    };
    return { available: !!config?.apiKey };
  },

  async _chat(messages, options = {}) {
    const { apiKey, endpoint, model } = this._config;
    const url = `${endpoint}/chat/completions`;
    const body = {
      model: model || 'gpt-4o-mini',
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 500
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  },

  async tag(text, hints) {
    const hintSuffix = hints?.contentType ? `\nDetected content type: ${hints.contentType}` : '';
    const raw = await this._chat([
      { role: 'system', content: Prompts.tag.system + hintSuffix },
      { role: 'user', content: `Classify this text:\n\n${truncateInput(text)}` }
    ], { jsonMode: true });
    try {
      const parsed = JSON.parse(raw);
      return {
        tags: parsed.tags || [],
        category: parsed.category || null,
        language: parsed.language || null
      };
    } catch {
      return { tags: [], category: null, language: null };
    }
  },

  async summarize(text) {
    const result = await this._chat([
      { role: 'system', content: Prompts.summarize.system },
      { role: 'user', content: truncateInput(text) }
    ]);
    return { summary: (result || '').trim().slice(0, 200) };
  },

  async translate(text, targetLang) {
    const systemPrompt = Prompts.translate.system(targetLang);
    const result = await this._chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: truncateInput(text) }
    ]);
    return { translatedText: (result || '').trim() };
  },

  async rewrite(text, style) {
    const systemPrompt = Prompts.rewrite.system(style);
    const result = await this._chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: truncateInput(text) }
    ]);
    return { rewrittenText: (result || '').trim() };
  },

  async expandKeywords(query) {
    const raw = await this._chat([
      { role: 'system', content: Prompts.semanticSearchQuery.system },
      { role: 'user', content: query }
    ], { jsonMode: true });
    try {
      const parsed = JSON.parse(raw);
      return parsed.keywords || [query];
    } catch {
      return [query];
    }
  },

  async embed(text) {
    const { apiKey, endpoint, embeddingModel } = this._config;
    if (!embeddingModel) return { embedding: null };
    const url = `${endpoint}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: truncateInput(text)
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Embedding API error ${res.status}: ${errBody}`);
    }
    const data = await res.json();
    return { embedding: data.data[0].embedding };
  },

  dispose() {}
};
