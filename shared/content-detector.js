export const ContentDetector = {
  detect(text) {
    const trimmed = text.trim();

    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      return { type: 'url', icon: '🔗', action: 'open_url', label: '打开链接' };
    }
    if (/^[\w.-]+@[\w.-]+\.\w+$/.test(trimmed)) {
      return { type: 'email', icon: '📧', action: 'send_email', label: '发送邮件' };
    }
    if (/^1[3-9]\d{9}$/.test(trimmed) || /^\+?\d[\d\s-]{7,}$/.test(trimmed)) {
      return { type: 'phone', icon: '📞', action: 'copy', label: '电话号码' };
    }
    if (
      trimmed.includes('\n') &&
      (/^\s*(function|const|let|var|import|class)\s/m.test(trimmed) ||
        /^[{}\[\]()]/m.test(trimmed))
    ) {
      return { type: 'code', icon: '💻', action: 'copy', label: '代码' };
    }
    return { type: 'text', icon: '📝', action: 'copy', label: '文本' };
  }
};
