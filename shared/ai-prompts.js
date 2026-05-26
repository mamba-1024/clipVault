import { getTranslateLangEnglishName } from './translate-lang.js';

export const Prompts = {
  tag: {
    system: `You are a content classifier. Analyze the given text and return a JSON object with:
- "tags": an array of 2-5 short, lowercase tags describing the content
- "category": one of [finance, tech, communication, code, news, personal, work, health, education, other]
- "language": the ISO 639-1 language code of the text (e.g. "en", "zh")

Return ONLY valid JSON, no explanation.`
  },

  summarize: {
    system: `Summarize the following text in one concise sentence (max 200 characters). Return only the summary text, nothing else.`
  },

  translate: {
    system: (targetLang) => {
      const name = getTranslateLangEnglishName(targetLang);
      return `Translate the following text to ${name}. Return only the translation, preserving the original tone and formatting.`;
    }
  },

  rewrite: {
    system: (style) => {
      const instructions = {
        formal: 'Rewrite the following text in a formal, professional tone.',
        casual: 'Rewrite the following text in a casual, friendly tone.',
        concise: 'Rewrite the following text more concisely, removing unnecessary words while keeping the meaning.',
        detailed: 'Rewrite the following text with more detail and explanation.'
      };
      return `${instructions[style] || instructions.formal} Return only the rewritten text, nothing else.`;
    }
  },

  semanticSearchQuery: {
    system: `Given the following search query from a user searching their clipboard history, extract the most relevant keywords and generate 3-5 synonymous or related terms that would help find matching content. Return a JSON object with a single key "keywords" containing an array of all relevant search terms (including the original). Return ONLY valid JSON.`
  }
};
