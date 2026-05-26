import { SettingsStorage } from '../shared/storage.js';
import { ErrorHandler } from '../shared/error-handler.js';
import { initI18n, applyI18nToDOM, t } from '../shared/i18n.js';
import { applyThemePreference, createThemeController } from '../shared/theme.js';

let settings = {};
let excludedSites = [];
let fbDisabledSites = [];
let themeCtrl = null;

function showStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.hidden = false;
  el.textContent = msg;
  el.style.color = isError ? '#ff8fa3' : '#3dffa8';
  setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function toggleOpenAIFields(channel) {
  document.querySelectorAll('.ai-openai-field').forEach((el) => {
    el.style.display = channel === 'openai' ? '' : 'none';
  });
}

const PROVIDER_PRESETS = {
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small'
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    embeddingModel: ''
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    embeddingModel: 'embedding-3'
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    embeddingModel: 'text-embedding-v3'
  },
  moonshot: {
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    embeddingModel: ''
  },
  ollama: {
    endpoint: 'http://localhost:11434/v1',
    model: 'qwen2.5:3b',
    embeddingModel: 'nomic-embed-text'
  },
  custom: {
    endpoint: '',
    model: '',
    embeddingModel: ''
  }
};

function applyProviderPreset(provider) {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;
  const epEl = document.getElementById('aiOpenaiEndpoint');
  const modelEl = document.getElementById('aiOpenaiModel');
  // 只在值为空或等于某个预设时自动填充（不覆盖用户手动改过的值）
  if (!epEl.value || Object.values(PROVIDER_PRESETS).some((p) => p.endpoint === epEl.value)) {
    epEl.value = preset.endpoint;
  }
  if (!modelEl.value || Object.values(PROVIDER_PRESETS).some((p) => p.model === modelEl.value)) {
    modelEl.value = preset.model;
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

function renderFbDisabled() {
  const list = document.getElementById('fbDisabledList');
  if (!list) return;
  list.innerHTML = fbDisabledSites
    .map(
      (site, i) => `
    <div class="excluded-item">
      <span>${site}</span>
      <button type="button" class="btn btn-secondary" data-fb-remove="${i}">×</button>
    </div>`
    )
    .join('');

  list.querySelectorAll('[data-fb-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fbDisabledSites.splice(parseInt(btn.dataset.fbRemove, 10), 1);
      renderFbDisabled();
    });
  });
}

function renderExcluded() {
  const list = document.getElementById('excludedList');
  list.innerHTML = excludedSites
    .map(
      (site, i) => `
    <div class="excluded-item">
      <span>${site}</span>
      <button type="button" class="btn btn-secondary" data-remove="${i}">×</button>
    </div>`
    )
    .join('');

  list.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      excludedSites.splice(parseInt(btn.dataset.remove, 10), 1);
      renderExcluded();
    });
  });
}

function localizeSelectOptions() {
  document.querySelectorAll('select[data-i18n-options]').forEach((select) => {
    const keys = select.getAttribute('data-i18n-options')?.split(',') || [];
    Array.from(select.options).forEach((opt, i) => {
      if (keys[i]) opt.textContent = t(keys[i].trim());
    });
  });
}

function applyPageI18n() {
  applyI18nToDOM(document);
  localizeSelectOptions();
  document.title = t('optionsTitle');
  document.documentElement.lang = settings.language === 'zh_CN' ? 'zh-CN' : 'en';
}

function collectForm() {
  return {
    language: document.getElementById('language').value,
    maxHistorySize: parseInt(document.getElementById('maxHistorySize').value, 10),
    maxItemLength: parseInt(document.getElementById('maxItemLength').value, 10),
    autoDeleteDays: parseInt(document.getElementById('autoDeleteDays').value, 10),
    defaultSort: document.getElementById('defaultSort').value,
    theme: document.getElementById('theme').value,
    enableAutoMonitor: document.getElementById('enableAutoMonitor').checked,
    duplicateIntervalSec: parseInt(document.getElementById('duplicateIntervalSec').value, 10),
    excludedSites: [...excludedSites],
    searchCaseSensitive: document.getElementById('searchCaseSensitive').checked,
    searchUseRegex: document.getElementById('searchUseRegex').checked,
    floatingBall: {
      enabled: document.getElementById('fbEnabled').checked,
      shrunk: document.getElementById('fbShrunk').checked,
      permanentlyDisabled: !document.getElementById('fbClearPermanent').checked,
      disabledSites: [...fbDisabledSites]
    },
    ai: {
      enabled: document.getElementById('aiEnabled').checked,
      channel: document.getElementById('aiChannel').value,
      provider: document.getElementById('aiProvider').value,
      openaiApiKey: document.getElementById('aiOpenaiApiKey').value,
      openaiModel: document.getElementById('aiOpenaiModel').value,
      openaiEndpoint: document.getElementById('aiOpenaiEndpoint').value,
      features: {
        autoTag: document.getElementById('aiAutoTag').checked,
        smartSearch: document.getElementById('aiSmartSearch').checked,
        translateEnabled: document.getElementById('aiTranslate').checked,
        rewriteEnabled: document.getElementById('aiRewrite').checked
      },
      rateLimitPerMinute: parseInt(document.getElementById('aiRateLimit').value, 10),
      language: document.getElementById('aiLanguage').value
    }
  };
}

function fillForm(s) {
  document.getElementById('language').value = s.language || 'auto';
  document.getElementById('maxHistorySize').value = s.maxHistorySize;
  document.getElementById('maxItemLength').value = s.maxItemLength;
  document.getElementById('autoDeleteDays').value = s.autoDeleteDays;
  document.getElementById('defaultSort').value = s.defaultSort;
  document.getElementById('theme').value = s.theme;
  document.getElementById('enableAutoMonitor').checked = s.enableAutoMonitor;
  document.getElementById('duplicateIntervalSec').value = s.duplicateIntervalSec;
  document.getElementById('searchCaseSensitive').checked = s.searchCaseSensitive;
  document.getElementById('searchUseRegex').checked = s.searchUseRegex;
  excludedSites = [...(s.excludedSites || [])];
  renderExcluded();

  const fb = s.floatingBall || {};
  document.getElementById('fbEnabled').checked = fb.enabled !== false;
  document.getElementById('fbShrunk').checked = !!fb.shrunk;
  document.getElementById('fbClearPermanent').checked = !fb.permanentlyDisabled;
  fbDisabledSites = [...(fb.disabledSites || [])];
  renderFbDisabled();

  const ai = s.ai || {};
  document.getElementById('aiEnabled').checked = ai.enabled || false;
  document.getElementById('aiChannel').value = ai.channel || 'chrome';
  document.getElementById('aiProvider').value = ai.provider || 'openai';
  document.getElementById('aiOpenaiApiKey').value = ai.openaiApiKey || '';
  document.getElementById('aiOpenaiModel').value = ai.openaiModel || 'gpt-4o-mini';
  document.getElementById('aiOpenaiEndpoint').value = ai.openaiEndpoint || 'https://api.openai.com/v1';
  document.getElementById('aiAutoTag').checked = ai.features?.autoTag ?? true;
  document.getElementById('aiSmartSearch').checked = ai.features?.smartSearch ?? true;
  document.getElementById('aiTranslate').checked = ai.features?.translateEnabled ?? true;
  document.getElementById('aiRewrite').checked = ai.features?.rewriteEnabled ?? true;
  document.getElementById('aiRateLimit').value = ai.rateLimitPerMinute || 15;
  document.getElementById('aiLanguage').value = ai.language || 'auto';
  toggleOpenAIFields(ai.channel || 'chrome');
}

async function init() {
  settings = await SettingsStorage.getSettings();
  await initI18n(settings.language || 'auto');
  fillForm(settings);
  applyPageI18n();

  themeCtrl = createThemeController(() => document.getElementById('theme').value);
  themeCtrl.install();

  document.getElementById('theme').addEventListener('change', (e) => {
    applyThemePreference(e.target.value);
  });

  document.getElementById('language').addEventListener('change', async () => {
    await initI18n(document.getElementById('language').value);
    applyPageI18n();
  });

  document.getElementById('aiChannel').addEventListener('change', (e) => {
    toggleOpenAIFields(e.target.value);
  });

  document.getElementById('aiProvider').addEventListener('change', (e) => {
    applyProviderPreset(e.target.value);
  });

  document.getElementById('testAiBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('aiStatusText');
    statusEl.hidden = false;
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = t('aiTesting');

    // 统一通过 Service Worker → Offscreen Document 测试
    const res = await sendMessage({ type: 'AI_INIT' });
    if (res?.available) {
      statusEl.textContent = t('aiTestOk') + ` (${res.channel || ''})`;
      statusEl.style.color = '#3dffa8';
    } else if (res?.reason === 'after-download') {
      statusEl.textContent = t('aiChromeDownloading');
      statusEl.style.color = '#ffb84d';
    } else {
      const reason = res?.reason || res?.error || t('aiTestFail');
      statusEl.textContent = reason;
      statusEl.style.color = '#ff8fa3';
    }
    setTimeout(() => { statusEl.hidden = true; }, 8000);
  });

  document.getElementById('addExcluded').addEventListener('click', () => {
    const val = document.getElementById('newExcluded').value.trim();
    if (val && !excludedSites.includes(val)) {
      excludedSites.push(val);
      document.getElementById('newExcluded').value = '';
      renderExcluded();
    }
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const prevLang = settings.language;
    settings = await SettingsStorage.saveSettings(collectForm());
    themeCtrl?.apply();
    if (settings.language !== prevLang) {
      await initI18n(settings.language || 'auto');
      applyPageI18n();
    }
    fbDisabledSites = [...(settings.floatingBall?.disabledSites || [])];
    renderFbDisabled();
    showStatus(t('statusSaved'));
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const json = await SettingsStorage.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipvault-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await SettingsStorage.importData(text);
      settings = await SettingsStorage.getSettings();
      await initI18n(settings.language || 'auto');
      fillForm(settings);
      applyPageI18n();
      showStatus(t('statusImportOk'));
    } catch (err) {
      showStatus(t('statusImportFail', err.message), true);
    }
    e.target.value = '';
  });

  document.getElementById('viewLogsBtn').addEventListener('click', async () => {
    const logs = await ErrorHandler.getLogs();
    const pre = document.getElementById('error-log');
    pre.style.display = 'block';
    pre.textContent = logs.length
      ? logs
          .map((l) => `[${new Date(l.timestamp).toLocaleString()}] ${l.context}: ${l.message}`)
          .join('\n')
      : t('noErrorLogs');
  });

  document.getElementById('clearLogsBtn').addEventListener('click', async () => {
    await ErrorHandler.clearLogs();
    document.getElementById('error-log').textContent = '';
    showStatus(t('statusLogsCleared'));
  });

  document.getElementById('clearAllBtn').addEventListener('click', async () => {
    if (!confirm(t('confirmClearAll'))) return;
    await chrome.storage.local.clear();
    settings = await SettingsStorage.saveSettings(collectForm());
    showStatus(t('statusAllCleared'));
  });
}

init();
