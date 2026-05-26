import { ContentDetector } from './content-detector.js';
import { Icons, TYPE_META } from './icons.js';
import { t } from './i18n.js';

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export class UIRenderer {
  constructor(options = {}) {
    this.mode = options.mode || 'popup';
    this.container = options.container;
    this.maxPreviewLength = this.mode === 'popup' ? 80 : 200;
    this.selectedIds = new Set();
    this.batchMode = false;
    this.aiEnabled = false;
    this.aiFeatures = {};
  }

  formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('timeJustNow');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('timeMinutesAgo', String(min));
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('timeHoursAgo', String(hr));
    const day = Math.floor(hr / 24);
    if (day < 30) return t('timeDaysAgo', String(day));
    return new Date(timestamp).toLocaleDateString();
  }

  formatCharCount(count) {
    if (count >= 1000) return t('charCountK', (count / 1000).toFixed(1));
    return t('charCount', String(count));
  }

  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  renderSearchBar(placeholder, showSmartToggle = false, smartSearchActive = false) {
    const smartToggle = showSmartToggle
      ? `<button type="button" class="search-smart-toggle ${smartSearchActive ? 'active' : ''}" title="${t('searchSmartToggle')}" data-action="toggle-smart-search">${Icons.sparkle}</button>`
      : '';
    return `
      <div class="search-wrap">
        <span class="search-icon">${Icons.search}</span>
        <input type="search" class="search-input ${smartSearchActive ? 'smart-active' : ''}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
        ${smartToggle}
      </div>`;
  }

  renderTabs(activeTab) {
    const tabs = [
      { id: 'history', label: t('tabHistory') },
      { id: 'snippets', label: t('tabSnippets') },
      { id: 'search', label: t('tabSearch') }
    ];
    return `<nav class="tab-nav" data-active="${activeTab}">
      <span class="tab-indicator" aria-hidden="true"></span>
      ${tabs
        .map(
          (tab) =>
            `<button type="button" class="tab-btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>`
        )
        .join('')}
    </nav>`;
  }

  renderSortOptions(currentSort) {
    const opts = [
      { value: 'time_desc', label: t('sortTimeDesc') },
      { value: 'time_asc', label: t('sortTimeAsc') },
      { value: 'char_count', label: t('sortCharCount') },
      { value: 'source', label: t('sortSource') }
    ];
    return `<select class="sort-select" aria-label="${escapeHtml(t('sortAria'))}">${opts
      .map(
        (o) =>
          `<option value="${o.value}" ${o.value === currentSort ? 'selected' : ''}>${o.label}</option>`
      )
      .join('')}</select>`;
  }

  renderBatchBar() {
    return `
      <div class="batch-bar hidden">
        <span class="batch-count">${escapeHtml(t('batchCount', '0'))}</span>
        <button type="button" class="btn-text batch-select-all">${t('batchSelectAll')}</button>
        <button type="button" class="btn-text batch-favorite">${t('batchFavorite')}</button>
        <button type="button" class="btn-text batch-delete">${t('batchDelete')}</button>
        <button type="button" class="btn-text batch-cancel">${t('batchCancel')}</button>
      </div>`;
  }

  renderEmpty(message, hint = '') {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
        ${hint ? `<p class="empty-hint">${escapeHtml(hint)}</p>` : ''}
      </div>`;
  }

  renderHistoryItem(item, index) {
    const detected = ContentDetector.detect(item.text);
    const maxPreview = this.maxPreviewLength;
    const isLong = item.text.length > maxPreview;
    const preview = isLong ? item.text.slice(0, maxPreview) + '…' : item.text;
    const codeClass = detected.type === 'code' ? 'is-code' : '';
    const favClass = item.isFavorite ? 'active' : '';
    const checked = this.selectedIds.has(item.id) ? 'checked' : '';
    const batchCheckbox = this.batchMode
      ? `<input type="checkbox" class="item-checkbox" data-id="${item.id}" ${checked} />`
      : '';
    const shortcut =
      index < 9 && !this.batchMode
        ? `<span class="shortcut-hint">${index + 1}</span>`
        : '';

    const meta = TYPE_META[detected.type] || TYPE_META.text;

    let typeAction = '';
    if (detected.action === 'open_url') {
      typeAction = `<button type="button" class="btn-sm action-type" data-action="open_url">${Icons.link} ${t('actionOpen')}</button>`;
    } else if (detected.action === 'send_email') {
      typeAction = `<button type="button" class="btn-sm action-type" data-action="send_email">${Icons.mail} ${t('actionMail')}</button>`;
    }

    const aiTagsHtml = this.aiEnabled && item.aiTags?.length
      ? `<div class="ai-tags">${item.aiTags.map((tag) => `<span class="ai-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

    const aiSummaryHtml = this.aiEnabled && item.aiSummary
      ? `<div class="ai-summary-chip"><span class="ai-label">AI</span> ${escapeHtml(item.aiSummary)}</div>`
      : '';

    const aiActions = this.aiEnabled
      ? `<div class="ai-actions">${this.aiFeatures.translateEnabled !== false ? `<button type="button" class="icon-btn action-ai-translate" title="${t('actionTranslate')}">${Icons.translate}</button>` : ''}${this.aiFeatures.rewriteEnabled !== false ? `<button type="button" class="icon-btn action-ai-rewrite" title="${t('actionRewrite')}">${Icons.rewrite}</button>` : ''}<button type="button" class="icon-btn action-ai-summarize" title="${t('actionSummarize')}">${Icons.sparkle}</button></div>`
      : '';

    return `
      <article class="history-item ${codeClass}" data-id="${item.id}" data-index="${index}">
        ${batchCheckbox}
        ${shortcut}
        <div class="item-top">
          <span class="type-badge" data-type="${detected.type}">${meta.icon} ${meta.label}</span>
          <div class="item-content ${isLong ? 'collapsible' : ''}">
            <span class="content-text">${escapeHtml(preview)}</span>
            ${isLong ? `<button type="button" class="expand-btn">${t('expand')}</button>` : ''}
          </div>
        </div>
        ${
          isLong
            ? `<div class="content-full hidden"><pre>${escapeHtml(item.text)}</pre></div>`
            : ''
        }
        <div class="item-meta">
          <span class="meta-chip item-source">${Icons.globe} ${escapeHtml(this.truncate(item.sourceTitle || item.source, 28))}</span>
          <span class="meta-chip item-time">${this.formatRelativeTime(item.createdAt)}</span>
          <span class="meta-chip item-chars">${this.formatCharCount(item.charCount)}</span>
          ${item.isTruncated ? `<span class="truncated-badge">${t('truncatedBadge')}</span>` : ''}
        </div>
        ${aiSummaryHtml}
        ${aiTagsHtml}
        <div class="item-actions">
          ${typeAction}
          ${aiActions}
          <button type="button" class="icon-btn action-favorite ${favClass}" title="${t('actionFavorite')}">${Icons.star}</button>
          <button type="button" class="icon-btn action-copy" title="${t('actionCopy')}">${Icons.copy}</button>
          <button type="button" class="icon-btn action-delete" title="${t('actionDelete')}">${Icons.trash}</button>
        </div>
      </article>`;
  }

  renderHistoryList(items) {
    const inner = !items.length
      ? this.renderEmpty(t('emptyHistory'), t('emptyHistoryHint'))
      : items.map((item, i) => this.renderHistoryItem(item, i)).join('');
    if (this.mode === 'popup') return inner;
    return `<div class="history-list-scroll">${inner}</div>`;
  }

  renderSnippetView(groups, snippets, activeGroupId = null) {
    const groupTabs = [
      { id: null, name: t('groupAll'), color: '#888' },
      ...groups.sort((a, b) => a.order - b.order),
      { id: 'ungrouped', name: t('groupUngrouped'), color: '#aaa' }
    ];

    const filtered =
      activeGroupId === null
        ? snippets
        : activeGroupId === 'ungrouped'
          ? snippets.filter((s) => !s.snippetGroup)
          : snippets.filter((s) => s.snippetGroup === activeGroupId);

    const groupBar = `<div class="group-bar">${groupTabs
      .map((g) => {
        const id = g.id === null ? 'all' : g.id;
        const count =
          g.id === null
            ? snippets.length
            : g.id === 'ungrouped'
              ? snippets.filter((s) => !s.snippetGroup).length
              : snippets.filter((s) => s.snippetGroup === g.id).length;
        const active = (activeGroupId === null && g.id === null) || activeGroupId === g.id;
        return `<button type="button" class="group-chip ${active ? 'active' : ''}" data-group="${id}" style="--chip-color:${g.color || '#4A90D9'}">${escapeHtml(g.name)} (${count})</button>`;
      })
      .join('')}</div>`;

    const list =
      filtered.length === 0
        ? this.renderEmpty(t('emptySnippets'), t('emptySnippetsHint'))
        : filtered
            .map(
              (s) => `
        <article class="snippet-item" data-id="${s.id}">
          <div class="snippet-title">${escapeHtml(s.title || t('snippetUntitled'))}</div>
          <div class="snippet-text">${escapeHtml(this.truncate(s.text, this.maxPreviewLength))}</div>
          ${(s.tags || []).length ? `<div class="snippet-tags">${s.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          <div class="item-actions">
            <button type="button" class="icon-btn action-copy" title="${t('actionCopy')}">${Icons.copy}</button>
            <button type="button" class="icon-btn action-edit" title="${t('actionEdit')}">${Icons.edit}</button>
            <button type="button" class="icon-btn action-delete" title="${t('actionDelete')}">${Icons.trash}</button>
          </div>
        </article>`
            )
            .join('');

    const body = `
      <div class="snippet-header">
        <span class="snippet-title-bar">${t('mySnippets')}</span>
        <button type="button" class="btn-primary btn-new-snippet">${t('newSnippet')}</button>
      </div>
      ${groupBar}
      <div class="snippet-list">${list}</div>`;

    return body;
  }

  renderSnippetEditor(snippet = {}, groups = []) {
    const groupOptions = [
      `<option value="">${t('groupUngrouped')}</option>`,
      ...groups.map(
        (g) =>
          `<option value="${g.id}" ${snippet.snippetGroup === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
      )
    ].join('');

    return `
      <div class="snippet-editor">
        <h3>${snippet.id ? t('editSnippet') : t('createSnippet')}</h3>
        <label>${t('labelTitle')}<input type="text" class="editor-title" value="${escapeHtml(snippet.title || '')}" /></label>
        <label>${t('labelContent')}<textarea class="editor-text" rows="4">${escapeHtml(snippet.text || '')}</textarea></label>
        <label>${t('labelGroup')}<select class="editor-group">${groupOptions}</select></label>
        <label>${t('labelTags')}<input type="text" class="editor-tags" value="${escapeHtml((snippet.tags || []).join(', '))}" /></label>
        <div class="editor-actions">
          <button type="button" class="btn-primary editor-save">${t('save')}</button>
          <button type="button" class="btn-text editor-cancel">${t('cancel')}</button>
        </div>
      </div>`;
  }

  renderSearchTabOptions(caseSensitive, useRegex) {
    return `
      <div class="search-options">
        <label><input type="checkbox" class="opt-case" ${caseSensitive ? 'checked' : ''} /> ${t('searchCaseSensitive')}</label>
        <label><input type="checkbox" class="opt-regex" ${useRegex ? 'checked' : ''} /> ${t('searchRegex')}</label>
      </div>`;
  }

  renderSearchResults(results, query) {
    if (!query) return this.renderEmpty(t('emptySearch'), t('emptySearchHint'));
    if (!results.length) return this.renderEmpty(t('emptySearchNoResults', query));

    const total = results.reduce((s, r) => s + (r.matches?.length || 0), 0);
    const header = `<p class="search-summary">${escapeHtml(t('searchSummary', [query, String(results.length), String(total)]))}</p>`;

    const body = results
      .map(
        (r) => `
      <section class="search-tab-result" data-tab-id="${r.tabId}">
        <h4 class="search-tab-title">${Icons.globe} ${escapeHtml(r.title)} <span class="meta-chip">×${r.matches.length}</span></h4>
        <ul class="search-matches">
          ${r.matches
            .map(
              (m) => `
            <li>
              <button type="button" class="search-match-btn" data-tab-id="${r.tabId}" data-position="${m.position}">
                ${escapeHtml(m.context)}
              </button>
            </li>`
            )
            .join('')}
        </ul>
        <button type="button" class="btn-sm goto-tab" data-tab-id="${r.tabId}">${Icons.link} ${t('gotoTab')}</button>
      </section>`
      )
      .join('');

    return header + body;
  }

  showToast(message, duration = 2000) {
    let toast = document.querySelector('.cv-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'cv-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
  }

  toggleBatchMode(enabled) {
    this.batchMode = enabled;
    this.selectedIds.clear();
  }

  toggleItemSelection(id) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    return this.selectedIds.size;
  }
}
