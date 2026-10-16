// Styled dropdowns (the M1 design from the Round 10 mockups) for every <select> in the app.
// The native select stays in the page as the source of truth: it keeps its id, value, options and
// change listeners, so the rest of the code doesn't change. This adds a button that shows the
// current option and opens a dark popover list. Choosing an item sets select.value and fires
// 'change', just as the native control would.
//
// Options may carry data-meta (shown on the right, e.g. "81 keys"). A select with
// data-placeholder="Select" always shows that label (an action menu, like "Select…").
// Lists longer than SEARCH_AT get a filter box.

const SEARCH_AT = 14;
let open = null; // { select, trigger, pop, items, active, cleanup }

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CHEVRON = '<svg class="dd-chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

export function enhanceSelects(root = document) {
  for (const select of root.querySelectorAll('select:not([data-dd])')) enhance(select);
  // Keep existing triggers in step with their select (value or disabled changed by code).
  for (const select of root.querySelectorAll('select[data-dd]')) sync(select);
}

function enhance(select) {
  select.dataset.dd = '1';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dd-trigger' + (select.classList.contains('btn-small') ? ' dd-small' : '');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = select.getAttribute('aria-label') || select.labels?.[0]?.textContent || '';
  if (label) trigger.setAttribute('aria-label', label);
  if (select.id) trigger.id = `${select.id}-dd`;
  select.after(trigger);
  select.classList.add('dd-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  trigger.addEventListener('click', () => (open?.select === select ? close() : show(select, trigger)));
  trigger.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(select, trigger); }
  });
  sync(select);
}

function sync(select) {
  const trigger = select.nextElementSibling;
  if (!trigger?.classList.contains('dd-trigger')) return;
  const opt = select.selectedOptions[0];
  const text = select.dataset.placeholder ?? opt?.textContent ?? '';
  // Only touch the DOM when something changed: the app's MutationObserver calls this on every change.
  if (trigger.dataset.text !== text || !trigger.firstChild) {
    trigger.dataset.text = text;
    trigger.innerHTML = `<span class="dd-value">${esc(text)}</span>${CHEVRON}`;
  }
  if (trigger.disabled !== select.disabled) trigger.disabled = select.disabled;
  if (trigger.title !== (select.title || '')) trigger.title = select.title || '';
}

function show(select, trigger) {
  close();
  if (select.disabled) return;
  const host = select.closest('dialog') ?? document.body; // a modal dialog is in the top layer
  const pop = document.createElement('div');
  pop.className = 'dd-pop';
  pop.setAttribute('role', 'listbox');
  pop.id = `dd-pop-${Math.random().toString(36).slice(2, 8)}`;
  const many = select.options.length > SEARCH_AT;
  pop.innerHTML = (many ? '<input class="dd-search" type="search" placeholder="Filter…" aria-label="Filter the list">' : '') + '<div class="dd-list"></div>';
  host.appendChild(pop);
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', pop.id);

  const list = pop.querySelector('.dd-list');
  const render = (filter = '') => {
    const f = filter.trim().toLowerCase();
    let html = '';
    for (const node of select.children) {
      const opts = node.tagName === 'OPTGROUP' ? [...node.children] : [node];
      const shown = opts.filter(o => !o.hidden && !(o.value === '' && select.dataset.placeholder) && (!f || o.textContent.toLowerCase().includes(f)));
      if (!shown.length) continue;
      if (node.tagName === 'OPTGROUP') html += `<div class="dd-group">${esc(node.label)}</div>`;
      for (const o of shown) {
        const on = o.selected && !select.dataset.placeholder;
        html += `<button type="button" class="dd-item${on ? ' is-on' : ''}" role="option" aria-selected="${on}" data-i="${o.index}" ${o.disabled ? 'disabled' : ''}>
          <span class="dd-label">${esc(o.textContent)}</span>${o.dataset.meta ? `<span class="dd-meta">${esc(o.dataset.meta)}</span>` : ''}</button>`;
      }
    }
    list.innerHTML = html || '<div class="dd-empty">No matches</div>';
    open.items = [...list.querySelectorAll('.dd-item:not(:disabled)')];
    open.active = Math.max(0, open.items.findIndex(b => b.classList.contains('is-on')));
    highlight();
  };
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const w = Math.max(r.width, 220);
    pop.style.minWidth = `${w}px`;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 220 && above > below;
    pop.style.maxHeight = `${Math.max(160, Math.min(420, up ? above : below))}px`;
    pop.style.left = `${Math.min(Math.max(8, r.right - pop.offsetWidth), window.innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = up ? `${Math.max(8, r.top - 6 - pop.offsetHeight)}px` : `${r.bottom + 6}px`;
  };
  const choose = btn => {
    const i = Number(btn.dataset.i);
    close(true);
    if (select.selectedIndex !== i || select.dataset.placeholder) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync(select);
  };
  const onKey = e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = open.items.length;
      if (n) { open.active = (open.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; highlight(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open.items[open.active]) choose(open.items[open.active]);
    } else if (e.key === 'Tab') close();
  };
  const onDown = e => { if (!pop.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) close(); };
  const onScroll = e => { if (!pop.contains(e.target)) close(); };

  open = { select, trigger, pop, items: [], active: 0, cleanup: null };
  render();
  place();
  list.addEventListener('click', e => { const b = e.target.closest('.dd-item'); if (b && !b.disabled) choose(b); });
  list.addEventListener('mousemove', e => { const b = e.target.closest('.dd-item'); const i = open?.items.indexOf(b); if (b && i >= 0 && i !== open.active) { open.active = i; highlight(false); } });
  const search = pop.querySelector('.dd-search');
  search?.addEventListener('input', () => { render(search.value); place(); });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  open.cleanup = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
  };
  (search ?? open.items[open.active] ?? pop).focus({ preventScroll: true });
  open.items[open.active]?.scrollIntoView({ block: 'nearest' });
}

function highlight(scroll = true) {
  open.items.forEach((b, i) => b.classList.toggle('is-active', i === open.active));
  const b = open.items[open.active];
  if (b && scroll) b.scrollIntoView({ block: 'nearest' });
  if (b && !open.pop.querySelector('.dd-search')) b.focus({ preventScroll: true });
}

function close(refocus = false) {
  if (!open) return;
  const { trigger, pop, cleanup } = open;
  open = null;
  cleanup?.();
  pop.remove();
  if (trigger.isConnected) {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    if (refocus) trigger.focus({ preventScroll: true });
  }
}
