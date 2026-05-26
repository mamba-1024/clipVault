export function updateTabIndicator(nav) {
  if (!nav) return;
  const active = nav.querySelector('.tab-btn.active');
  const indicator = nav.querySelector('.tab-indicator');
  if (!active || !indicator) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

export function animateListItems(container) {
  if (!container) return;
  const items = container.querySelectorAll(
    '.history-item, .snippet-item, .search-tab-result, .snippet-editor'
  );
  items.forEach((el, i) => {
    el.classList.remove('cv-enter');
    void el.offsetWidth;
    el.style.setProperty('--stagger', `${Math.min(i, 12) * 45}ms`);
    el.classList.add('cv-enter');
  });
}

export function pulseMain(container) {
  container?.classList.add('cv-refresh');
  setTimeout(() => container?.classList.remove('cv-refresh'), 400);
}
