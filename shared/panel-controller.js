import { UIRenderer } from './ui-renderer.js';
import { isSidePanelSupported, openSidePanelFromPopup } from './sidepanel-helper.js';
import { Icons } from './icons.js';
import { animateListItems, pulseMain, updateTabIndicator } from './panel-motion.js';
import { createThemeController } from './theme.js';
import { getActiveLocale, initI18n, t } from './i18n.js';

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

export async function copyToClipboard(text, renderer) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'COPY_TO_CLIPBOARD', text });
      renderer.showToast(t('toastCopied'));
      return;
    }
  } catch {
    /* fallback */
  }
  try {
    await navigator.clipboard.writeText(text);
    renderer.showToast(t('toastCopied'));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    renderer.showToast(t('toastCopied'));
  }
}

export class PanelController {
  constructor(mode) {
    this.mode = mode;
    this.renderer = new UIRenderer({ mode });
    this.activeTab = 'history';
    this.settings = {};
    this.historyItems = [];
    this.snippets = [];
    this.groups = [];
    this.activeGroupId = null;
    this.searchResults = [];
    this.tabSearchQuery = '';
    this.editingSnippet = null;
    this.sort = 'time_desc';
    this.searchQuery = '';
    this.smartSearchActive = false;
  }

  async init() {
    const res = await sendMessage({ type: 'GET_SETTINGS' });
    if (res?.error) {
      console.error('[ClipVault]', res.error);
    }
    this.settings = res?.settings || {};
    await initI18n(this.settings.language || 'auto');
    document.documentElement.lang = getActiveLocale() === 'zh_CN' ? 'zh-CN' : 'en';
    this.sort = this.settings.defaultSort || 'time_desc';
    this.renderer.aiEnabled = this.settings.ai?.enabled || false;
    this.renderer.aiFeatures = this.settings.ai?.features || {};
    if (!this._themeCtrl) {
      this._themeCtrl = createThemeController(() => this.settings.theme || 'system');
      this._themeCtrl.install();
    } else {
      this._themeCtrl.apply();
    }
    this.bindChrome();
    this.renderShell();
    if (this.mode === 'popup') {
      this.updatePopupToolbar();
    }
    this.bindShellEvents();
    await this.refresh();
    this.checkSidePanelSupport();
    requestAnimationFrame(() => {
      updateTabIndicator(document.querySelector('.tab-nav'));
    });
  }

  checkSidePanelSupport() {
    const btn = document.querySelector('.btn-sidepanel');
    if (!btn) return;
    const supported = isSidePanelSupported();
    if (this.mode !== 'popup') {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    btn.disabled = !supported;
    btn.title = supported ? t('sidepanelSupportedTitle') : t('sidepanelUnsupportedTitle');
  }

  bindChrome() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'HISTORY_UPDATED') this.refresh();
    });
  }

  renderShell() {
    const root = document.getElementById('app');
    const showSort = this.activeTab === 'history';
    const popupHeader = `
      <header class="panel-header">
        <div class="logo-wrap">
          <img class="logo-icon" src="${chrome.runtime.getURL('icons/icon-animated.svg')}" width="28" height="28" alt="" />
          <h1 class="logo"><span class="logo-accent">Clip</span>Vault</h1>
        </div>
        <div class="header-tools">
          ${showSort ? this.renderer.renderSortOptions(this.sort) : `<span class="header-status">${t('headerStatus')}</span>`}
        </div>
      </header>`;
    const popupToolbar = `
      ${this.renderer.renderSearchBar(this.getSearchPlaceholder(), this.renderer.aiEnabled && this.renderer.aiFeatures.smartSearch, this.smartSearchActive)}
      ${this.renderer.renderTabs(this.activeTab)}
      <div class="popup-search-opts" id="popup-search-opts" hidden></div>
      ${this.renderer.renderBatchBar()}`;
    const footerBlock = `
      <footer class="panel-footer">
        <button type="button" class="footer-btn btn-batch-toggle" title="${t('footerBatchTitle')}">
          ${Icons.batch}<span>${t('footerBatch')}</span>
        </button>
        <button type="button" class="footer-btn btn-settings" title="${t('footerSettingsTitle')}">
          ${Icons.settings}<span>${t('footerSettings')}</span>
        </button>
        <button type="button" class="footer-btn btn-sidepanel" title="${t('footerSidepanelTitle')}">
          ${Icons.panel}<span>${t('footerSidepanel')}</span>
        </button>
      </footer>
      <p class="shortcut-tip">${t('shortcutTipPrefix')}<kbd>1</kbd>–<kbd>9</kbd>${t('shortcutTipSuffix')}</p>`;

    if (this.mode === 'popup') {
      root.classList.add('is-popup-shell');
      root.innerHTML = `
      <div class="popup-header" id="popup-header">${popupHeader}</div>
      <div class="popup-toolbar" id="popup-toolbar">${popupToolbar}</div>
      <div class="popup-scroll" id="popup-scroll"></div>
      <div class="popup-bottom" id="popup-bottom">${footerBlock}</div>`;
      return;
    }

    const headerBlock = `${popupHeader}
      ${this.renderer.renderSearchBar(this.getSearchPlaceholder(), this.renderer.aiEnabled && this.renderer.aiFeatures.smartSearch, this.smartSearchActive)}
      ${this.renderer.renderTabs(this.activeTab)}
      ${this.renderer.renderBatchBar()}`;
    root.innerHTML = `
      <div class="app-bg" aria-hidden="true"></div>
      ${headerBlock}
      <main class="panel-main" id="panel-main"></main>
      ${footerBlock}`;
  }

  getSearchPlaceholder() {
    if (this.activeTab === 'snippets') return t('searchSnippets');
    if (this.activeTab === 'search') return t('searchTabsDisabled');
    return t('searchHistory');
  }

  afterRenderMain() {
    const root = document.getElementById('app');
    const listRoot = this.mode === 'popup' ? this.getPopupScrollEl() : document.getElementById('panel-main');
    updateTabIndicator(root?.querySelector('.tab-nav'));
    animateListItems(listRoot);
  }

  getPopupScrollEl() {
    return document.getElementById('popup-scroll');
  }

  getPanelContentRoot() {
    if (this.mode === 'popup') return this.getPopupScrollEl();
    return document.getElementById('panel-main');
  }

  getPanelEventRoot() {
    if (this.mode === 'popup') return document.getElementById('app');
    return document.getElementById('panel-main');
  }

  /** popup 中部工具栏：搜索框 + 搜全站选项 */
  updatePopupToolbar() {
    if (this.mode !== 'popup') return;
    const searchInput = document.querySelector('#popup-toolbar .search-input');
    const opts = document.getElementById('popup-search-opts');
    if (!searchInput) return;

    if (this.activeTab === 'search') {
      searchInput.placeholder = t('searchAllTabs');
      searchInput.value = this.tabSearchQuery;
      if (opts) {
        opts.hidden = false;
        opts.innerHTML = this.renderer.renderSearchTabOptions(
          this.settings.searchCaseSensitive,
          this.settings.searchUseRegex
        );
      }
    } else {
      searchInput.placeholder = this.getSearchPlaceholder();
      searchInput.value = this.searchQuery;
      if (opts) {
        opts.hidden = true;
        opts.innerHTML = '';
      }
    }
  }

  bindShellEvents() {
    const root = document.getElementById('app');
    let searchDebounce;
    root.querySelector('.search-input')?.addEventListener('input', (e) => {
      if (this.mode === 'popup' && this.activeTab === 'search') {
        this.tabSearchQuery = e.target.value;
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => this.runTabSearch(), 400);
        return;
      }
      this.searchQuery = e.target.value;
      if (this.smartSearchActive && this.renderer.aiEnabled && this.searchQuery.trim()) {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => this.runSmartSearch(), 600);
        return;
      }
      this.refresh();
    });

    document.getElementById('popup-search-opts')?.addEventListener('change', (e) => {
      if (e.target.matches('.opt-case, .opt-regex')) this.runTabSearch();
    });

    root.querySelector('.tab-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      this.activeTab = btn.dataset.tab;
      root.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      updateTabIndicator(root.querySelector('.tab-nav'));

      const tools = root.querySelector('.header-tools');
      if (tools) {
        tools.innerHTML =
          this.activeTab === 'history'
            ? this.renderer.renderSortOptions(this.sort)
            : `<span class="header-status">${t('headerStatus')}</span>`;
        tools.querySelector('.sort-select')?.addEventListener('change', (ev) => {
          this.sort = ev.target.value;
          this.refresh();
        });
      }

      if (this.mode === 'popup') this.updatePopupToolbar();

      pulseMain(this.getPanelContentRoot());
      this.refresh();
    });

    root.querySelector('.sort-select')?.addEventListener('change', (e) => {
      this.sort = e.target.value;
      this.refresh();
    });

    root.querySelector('.btn-batch-toggle')?.addEventListener('click', () => this.toggleBatch());
    root.querySelector('.btn-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

    root.querySelector('.search-smart-toggle')?.addEventListener('click', () => {
      this.smartSearchActive = !this.smartSearchActive;
      const btn = root.querySelector('.search-smart-toggle');
      const input = root.querySelector('.search-input');
      if (btn) btn.classList.toggle('active', this.smartSearchActive);
      if (input) input.classList.toggle('smart-active', this.smartSearchActive);
    });
    root.querySelector('.btn-sidepanel')?.addEventListener('click', async () => {
      try {
        await openSidePanelFromPopup();
        this.renderer.showToast(t('toastSidepanelOpened'));
        setTimeout(() => window.close(), 150);
      } catch (err) {
        this.renderer.showToast(err?.message || t('toastSidepanelFailed'));
      }
    });

    document.addEventListener('keydown', (e) => this.onKeydown(e));

    document.querySelector('.batch-select-all')?.addEventListener('click', () => {
      this.toggleSelectAll();
    });
    document.querySelector('.batch-cancel')?.addEventListener('click', () => this.toggleBatch());
    document.querySelector('.batch-delete')?.addEventListener('click', async () => {
      const ids = [...this.renderer.selectedIds];
      if (!ids.length) return;
      await sendMessage({ type: 'DELETE_ITEMS', ids });
      this.toggleBatch();
    });
    document.querySelector('.batch-favorite')?.addEventListener('click', async () => {
      const ids = [...this.renderer.selectedIds];
      if (!ids.length) return;
      await sendMessage({ type: 'BATCH_FAVORITE', ids, isFavorite: true });
      this.toggleBatch();
    });
  }

  async refresh() {
    if (this.activeTab === 'history') await this.loadHistory();
    else if (this.activeTab === 'snippets') await this.loadSnippets();
    else if (this.activeTab === 'search') this.renderSearchTab();
  }

  async loadHistory() {
    const res = await sendMessage({
      type: 'GET_HISTORY',
      query: this.activeTab === 'history' ? this.searchQuery : '',
      sort: this.sort,
      limit: 200
    });
    if (res?.error) {
      console.error('[ClipVault] loadHistory:', res.error);
    }
    this.historyItems = res?.items || [];
    const target = this.getPanelContentRoot();
    if (!target) return;
    target.innerHTML = this.renderer.renderHistoryList(this.historyItems);
    this.bindHistoryEvents(this.getPanelEventRoot());
    this.updateBatchBar();
    this.afterRenderMain();
  }

  async loadSnippets() {
    const res = await sendMessage({
      type: 'GET_SNIPPETS',
      query: this.searchQuery,
      groupId: this.activeGroupId
    });
    this.snippets = res?.snippets || [];
    this.groups = res?.groups || [];
    const target = this.getPanelContentRoot();
    const eventRoot = this.getPanelEventRoot();
    if (!target || !eventRoot) return;

    target.innerHTML = this.renderer.renderSnippetView(this.groups, this.snippets, this.activeGroupId);
    eventRoot.querySelectorAll('.snippet-editor-wrap, .snippet-list-overlay').forEach((n) => n.remove());
    if (this.editingSnippet !== null) {
      target.insertAdjacentHTML(
        'beforeend',
        `<div class="snippet-editor-wrap">${this.renderer.renderSnippetEditor(this.editingSnippet, this.groups)}</div><div class="snippet-list-overlay"></div>`
      );
    }
    this.bindSnippetEvents(eventRoot);
    this.afterRenderMain();
  }

  renderSearchTab() {
    const target = this.getPanelContentRoot();
    if (!target) return;
    const eventRoot = this.getPanelEventRoot();
    const results = this.renderer.renderSearchResults(this.searchResults, this.tabSearchQuery);

    if (this.mode === 'popup') {
      this.updatePopupToolbar();
      target.innerHTML = results;
      this.bindSearchResultEvents(eventRoot);
      this.afterRenderMain();
      return;
    }

    const options = this.renderer.renderSearchTabOptions(
      this.settings.searchCaseSensitive,
      this.settings.searchUseRegex
    );
    target.innerHTML = `
      ${options}
      <input type="search" class="tab-search-input" placeholder="${t('searchAllTabs')}" value="${this.tabSearchQuery}" />
      <div class="tab-search-results">${results}</div>`;

    const input = target.querySelector('.tab-search-input');
    if (!input) {
      this.afterRenderMain();
      return;
    }
    let debounce;
    input.addEventListener('input', () => {
      this.tabSearchQuery = input.value;
      clearTimeout(debounce);
      debounce = setTimeout(() => this.runTabSearch(), 400);
    });

    target.querySelector('.opt-case')?.addEventListener('change', () => this.runTabSearch());
    target.querySelector('.opt-regex')?.addEventListener('change', () => this.runTabSearch());
    this.bindSearchResultEvents(eventRoot);
    this.afterRenderMain();
  }

  async runTabSearch() {
    const q = this.tabSearchQuery.trim();
    const container =
      this.mode === 'popup'
        ? this.getPopupScrollEl()
        : document.getElementById('panel-main')?.querySelector('.tab-search-results');
    if (!container) return;
    if (!q) {
      this.searchResults = [];
      container.innerHTML = this.renderer.renderSearchResults([], '');
      return;
    }
    container.innerHTML = `<p class="loading">${t('searchLoading')}</p>`;
    const optRoot =
      this.mode === 'popup'
        ? document.getElementById('popup-search-opts')
        : document.getElementById('panel-main');
    const caseSensitive = optRoot?.querySelector('.opt-case')?.checked ?? false;
    const useRegex = optRoot?.querySelector('.opt-regex')?.checked ?? false;
    const res = await sendMessage({
      type: 'SEARCH_TABS',
      query: q,
      options: { caseSensitive, useRegex }
    });
    this.searchResults = res?.results || [];
    container.innerHTML = this.renderer.renderSearchResults(this.searchResults, q);
    this.bindSearchResultEvents(this.getPanelEventRoot());
    animateListItems(container);
  }

  bindHistoryEvents(main) {
    main.querySelectorAll('.expand-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.history-item');
        const full = item.querySelector('.content-full');
        full?.classList.toggle('hidden');
        btn.textContent = full?.classList.contains('hidden') ? t('expand') : t('collapse');
      });
    });

    main.querySelectorAll('.action-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        const item =
          this.historyItems.find((h) => h.id === id) ||
          this.snippets.find((s) => s.id === id);
        if (item?.text) copyToClipboard(item.text, this.renderer);
        if (this.mode === 'popup') setTimeout(() => window.close(), 300);
      });
    });

    main.querySelectorAll('.action-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        if (btn.closest('.snippet-item')) {
          await sendMessage({ type: 'DELETE_SNIPPET', id });
        } else {
          await sendMessage({ type: 'DELETE_ITEM', id });
        }
        await this.refresh();
      });
    });

    main.querySelectorAll('.action-favorite').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.history-item')?.dataset.id;
        await sendMessage({ type: 'TOGGLE_FAVORITE', id });
        await this.refresh();
      });
    });

    main.querySelectorAll('.action-type').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.history-item')?.dataset.id;
        const item = this.historyItems.find((h) => h.id === id);
        if (!item?.text) return;
        if (btn.dataset.action === 'open_url') chrome.tabs.create({ url: item.text.trim() });
        if (btn.dataset.action === 'send_email') chrome.tabs.create({ url: `mailto:${item.text.trim()}` });
      });
    });

    main.querySelectorAll('.item-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        this.renderer.toggleItemSelection(cb.dataset.id);
        this.updateBatchBar();
        this.updateSelectAllButton();
      });
    });

    main.querySelectorAll('.action-ai-summarize').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        btn.classList.add('loading');
        const res = await sendMessage({ type: 'AI_SUMMARIZE', id });
        btn.classList.remove('loading');
        if (res?.summary) {
          this.renderer.showToast(res.summary, 5000);
        } else if (res?.error) {
          this.renderer.showToast(res.error, 3000);
        }
      });
    });

    main.querySelectorAll('.action-ai-translate').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const targetLang = this.settings.ai?.language === 'zh_CN' ? 'en' : 'zh_CN';
        btn.classList.add('loading');
        const res = await sendMessage({ type: 'AI_TRANSLATE', id, targetLang });
        btn.classList.remove('loading');
        if (res?.translatedText) {
          this.renderer.showToast(res.translatedText, 5000);
        } else if (res?.error) {
          this.renderer.showToast(res.error, 3000);
        }
      });
    });

    main.querySelectorAll('.action-ai-rewrite').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        btn.classList.add('loading');
        const res = await sendMessage({ type: 'AI_REWRITE', id, style: 'formal' });
        btn.classList.remove('loading');
        if (res?.rewrittenText) {
          this.renderer.showToast(res.rewrittenText, 5000);
        } else if (res?.error) {
          this.renderer.showToast(res.error, 3000);
        }
      });
    });
  }

  bindSnippetEvents(main) {
    main.querySelectorAll('.group-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const g = chip.dataset.group;
        this.activeGroupId = g === 'all' ? null : g;
        this.loadSnippets();
      });
    });

    main.querySelector('.btn-new-snippet')?.addEventListener('click', () => {
      this.editingSnippet = {};
      this.loadSnippets();
    });

    main.querySelectorAll('.action-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.snippet-item')?.dataset.id;
        this.editingSnippet = this.snippets.find((s) => s.id === id) || {};
        this.loadSnippets();
      });
    });

    main.querySelector('.editor-save')?.addEventListener('click', async () => {
      const title = main.querySelector('.editor-title')?.value || '';
      const text = main.querySelector('.editor-text')?.value || '';
      const snippetGroup = main.querySelector('.editor-group')?.value || null;
      const tagsRaw = main.querySelector('.editor-tags')?.value || '';
      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await sendMessage({
        type: 'SAVE_SNIPPET',
        snippet: {
          ...this.editingSnippet,
          title,
          text,
          snippetGroup: snippetGroup || null,
          tags
        }
      });
      this.editingSnippet = null;
      await this.refresh();
    });

    main.querySelector('.editor-cancel')?.addEventListener('click', () => {
      this.editingSnippet = null;
      this.loadSnippets();
    });

    this.bindHistoryEvents(main);
  }

  bindSearchResultEvents(main) {
    main.querySelectorAll('.search-match-btn, .goto-tab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tabId = parseInt(btn.dataset.tabId, 10);
        const position = parseInt(btn.dataset.position, 10);
        if (btn.classList.contains('goto-tab') || Number.isNaN(position)) {
          await chrome.tabs.update(tabId, { active: true });
        } else {
          await sendMessage({ type: 'HIGHLIGHT_TAB', tabId, position });
        }
      });
    });
  }

  toggleBatch() {
    this.renderer.toggleBatchMode(!this.renderer.batchMode);
    const bar = document.querySelector('.batch-bar');
    const btn = document.querySelector('.btn-batch-toggle');
    if (this.renderer.batchMode) {
      bar?.classList.remove('hidden');
      btn?.classList.add('active-batch');
      const label = btn?.querySelector('span');
      if (label) label.textContent = t('batchDone');
    } else {
      bar?.classList.add('hidden');
      btn?.classList.remove('active-batch');
      const label = btn?.querySelector('span');
      if (label) label.textContent = t('footerBatch');
    }
    this.refresh();
  }

  isAllHistorySelected() {
    return (
      this.historyItems.length > 0 &&
      this.historyItems.every((h) => this.renderer.selectedIds.has(h.id))
    );
  }

  toggleSelectAll() {
    if (this.isAllHistorySelected()) {
      this.historyItems.forEach((h) => this.renderer.selectedIds.delete(h.id));
    } else {
      this.historyItems.forEach((h) => this.renderer.selectedIds.add(h.id));
    }
    this.refresh();
    this.updateBatchBar();
  }

  updateSelectAllButton() {
    const btn = document.querySelector('.batch-select-all');
    if (!btn) return;
    btn.textContent = this.isAllHistorySelected() ? t('batchDeselectAll') : t('batchSelectAll');
  }

  updateBatchBar() {
    const count = document.querySelector('.batch-count');
    if (count) count.textContent = t('batchCount', String(this.renderer.selectedIds.size));
    this.updateSelectAllButton();
  }

  async runSmartSearch() {
    const q = this.searchQuery.trim();
    if (!q) { this.refresh(); return; }
    const target = this.getPanelContentRoot();
    if (!target) return;
    target.innerHTML = `<p class="loading">${t('aiProcessing')}</p>`;
    const res = await sendMessage({ type: 'AI_SEMANTIC_SEARCH', query: q });
    if (res?.items?.length) {
      this.historyItems = res.items;
      target.innerHTML = this.renderer.renderHistoryList(this.historyItems);
      this.bindHistoryEvents(this.getPanelEventRoot());
      this.afterRenderMain();
    } else {
      this.historyItems = [];
      target.innerHTML = this.renderer.renderEmpty(t('emptyHistory'), '');
      this.afterRenderMain();
    }
  }

  onKeydown(e) {
    if (e.target.matches('input, textarea, select')) return;
    if (this.activeTab !== 'history' || this.renderer.batchMode) return;
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const index = parseInt(e.key, 10) - 1;
      const item = this.historyItems[index];
      if (item) {
        copyToClipboard(item.text, this.renderer);
        if (this.mode === 'popup') setTimeout(() => window.close(), 300);
      }
    }
  }
}
