export function searchInPage(query, options = {}) {
  const bodyText = document.body?.innerText || '';
  const results = [];

  let flags = 'g';
  if (!options.caseSensitive) flags += 'i';

  let pattern;
  if (options.useRegex) {
    try {
      pattern = new RegExp(query, flags);
    } catch {
      return {
        title: document.title,
        url: location.href,
        matches: [],
        error: 'Invalid regex'
      };
    }
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(escaped, flags);
  }

  let match;
  while ((match = pattern.exec(bodyText)) !== null) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(bodyText.length, match.index + match[0].length + 50);
    results.push({
      context: '...' + bodyText.slice(start, end) + '...',
      position: match.index
    });
    if (results.length >= 5) break;
  }

  return {
    title: document.title,
    url: location.href,
    favicon: document.querySelector('link[rel*="icon"]')?.href || '',
    matches: results,
    totalMatches: results.length
  };
}

export function highlightAtPosition(position) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    const len = node.textContent.length;
    if (offset + len > position) {
      const range = document.createRange();
      const localPos = position - offset;
      range.setStart(node, Math.min(localPos, len));
      range.setEnd(node, Math.min(localPos + 1, len));
      const span = document.createElement('mark');
      span.className = 'cv-highlight';
      span.style.cssText = 'background:#ffeb3b;padding:2px 0';
      try {
        range.surroundContents(span);
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    offset += len;
    node = walker.nextNode();
  }
}

export async function searchAcrossTabs(query, options = {}) {
  const tabs = await chrome.tabs.query({});
  const results = [];
  const CONCURRENCY = 10;

  for (let i = 0; i < tabs.length; i += CONCURRENCY) {
    const batch = tabs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (tab) => {
        if (!tab.id || !tab.url?.startsWith('http')) return null;
        try {
          const injections = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: searchInPage,
            args: [query, options]
          });
          if (injections[0]?.result?.matches?.length > 0) {
            return { tabId: tab.id, ...injections[0].result };
          }
        } catch {
          return null;
        }
        return null;
      })
    );

    batchResults.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });
  }

  return results;
}
