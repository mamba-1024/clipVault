export const ErrorHandler = {
  log(context, error) {
    const entry = {
      context,
      message: error?.message || String(error),
      stack: error?.stack?.slice(0, 500),
      timestamp: Date.now()
    };

    chrome.storage.local.get('errorLog', ({ errorLog = [] }) => {
      errorLog.push(entry);
      if (errorLog.length > 100) errorLog.splice(0, errorLog.length - 100);
      chrome.storage.local.set({ errorLog });
    });
  },

  getLogs() {
    return new Promise((resolve) => {
      chrome.storage.local.get('errorLog', ({ errorLog = [] }) => resolve(errorLog));
    });
  },

  clearLogs() {
    return chrome.storage.local.set({ errorLog: [] });
  }
};

self.addEventListener?.('error', (e) => {
  ErrorHandler.log('sw_uncaught', e.error);
});

self.addEventListener?.('unhandledrejection', (e) => {
  ErrorHandler.log('sw_promise', e.reason);
});
