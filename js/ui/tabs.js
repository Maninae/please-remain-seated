/**
 * Left vertical tab rail (desktop) + bottom tab bar (phone).
 *
 * Three tabs: Race (existing page content), Rankings (analytical core), About (thesis + sources).
 * URL round-trip: `?tab=<race|rankings|about>` reflects the active tab and restores on reload.
 * Keyboard: real buttons with `role="tab"` inside a `role="tablist"`, arrow keys move focus,
 * Home / End jump to the ends, Enter / Space activate.
 *
 * Side effects:
 *   - Toggles `hidden` on the three panel roots and `body[data-tab="..."]`.
 *   - Dispatches `prs:tab-changed` (detail: { tab }) so the race pauses when the tab leaves
 *     Race and resumes when it returns. The race module listens for this instead of the tab
 *     module reaching into race state.
 *
 * The rail carries a small code-drawn inline SVG icon plus a short label per tab. The active
 * tab is ink on paper; the rest are soft gray. Everything else stays paper. No colour except
 * ink for the active state, so the rail never competes with the race for the eye.
 */

const TAB_IDS = Object.freeze(['race', 'rankings', 'about']);
const TAB_LABELS = Object.freeze({ race: 'Race', rankings: 'Rankings', about: 'About' });
const STORAGE_KEY_LAST_TAB = 'prs.tab';

/** SVG icon markup per tab. All ink strokes; the active state relies on `currentColor`. */
const TAB_ICONS = Object.freeze({
  race: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 L21 12"/><circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="14" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M3 7 L21 7"/><path d="M3 17 L21 17"/></svg>',
  rankings: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="18" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/><circle cx="18" cy="7" r="1.8" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="14" cy="17" r="1.8" fill="currentColor" stroke="none"/></svg>',
  about: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="10" x2="12" y2="17"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/></svg>',
});

/**
 * Mount the tab rail and both tab-controlled panels. Reads the initial tab from the URL
 * (`?tab=`), or the last-visited tab in localStorage, and falls back to "race" so a fresh
 * visit lands on the hero content.
 */
export function mountTabs() {
  const rail = document.getElementById('tab-rail');
  const bar = document.getElementById('tab-bar-phone');
  if (!rail && !bar) return null;

  const panels = {
    race: document.getElementById('tab-panel-race'),
    rankings: document.getElementById('tab-panel-rankings'),
    about: document.getElementById('tab-panel-about'),
  };
  const buttons = {};

  buildRail(rail, buttons);
  buildRail(bar, buttons, { compact: true });

  wireKeyboard();
  wireUrlSync();

  const initial = pickInitialTab();
  // Activate synchronously so the initial hidden state on the panels matches the URL by the
  // time the first frame paints. Callers who need the initial `prs:tab-changed` event should
  // mount BEFORE calling this function; the fired event still bubbles through the window so
  // any post-mount listener with an initial-sync path picks up the current tab from
  // `document.body.dataset.tab`.
  activate(initial, { silent: true });

  return {
    activate,
    currentTab: () => currentTabRef.current,
  };

  // ---- implementation ----

  function buildRail(container, buttonMap, { compact = false } = {}) {
    if (!container) return;
    container.setAttribute('role', 'tablist');
    container.setAttribute('aria-label', 'Sections');
    container.innerHTML = '';
    for (const id of TAB_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('data-tab-id', id);
      button.setAttribute('id', `tab-${compact ? 'phone-' : ''}${id}`);
      button.setAttribute('aria-controls', `tab-panel-${id}`);
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = -1;
      button.className = 'tab-btn';
      const iconWrap = document.createElement('span');
      iconWrap.className = 'tab-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = TAB_ICONS[id];
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = TAB_LABELS[id];
      button.appendChild(iconWrap);
      button.appendChild(label);
      button.addEventListener('click', () => activate(id));
      container.appendChild(button);
      if (!buttonMap[id]) buttonMap[id] = [];
      buttonMap[id].push(button);
    }
  }

  function pickInitialTab() {
    if (typeof window === 'undefined') return 'race';
    const url = new URLSearchParams(window.location.search);
    const fromUrl = url.get('tab');
    if (fromUrl && TAB_IDS.includes(fromUrl)) return fromUrl;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY_LAST_TAB);
      if (stored && TAB_IDS.includes(stored)) return stored;
    } catch (error) { /* private tab or blocked storage */ }
    return 'race';
  }

  function activate(tabId, { silent = false } = {}) {
    if (!TAB_IDS.includes(tabId)) return;
    currentTabRef.current = tabId;
    // Toggle panels via `hidden`, never inline `display`, so the base rule in css/base.css wins.
    for (const id of TAB_IDS) {
      const panel = panels[id];
      const isActive = id === tabId;
      if (panel) {
        panel.hidden = !isActive;
        panel.setAttribute('aria-hidden', String(!isActive));
      }
      const nodes = buttons[id] || [];
      for (const node of nodes) {
        node.setAttribute('aria-selected', String(isActive));
        node.classList.toggle('on', isActive);
        node.tabIndex = isActive ? 0 : -1;
      }
    }
    document.body.dataset.tab = tabId;
    if (!silent) {
      try { window.localStorage.setItem(STORAGE_KEY_LAST_TAB, tabId); } catch (error) { /* ignore */ }
      writeTabToUrl(tabId);
    }
    window.dispatchEvent(new CustomEvent('prs:tab-changed', { detail: { tab: tabId } }));
  }

  function wireKeyboard() {
    const containers = [rail, bar].filter(Boolean);
    for (const container of containers) {
      container.addEventListener('keydown', (event) => {
        const key = event.key;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const focusableList = TAB_IDS.map((id) => (buttons[id] || []).find((btn) => btn.closest('#' + container.id)));
        const currentIndex = focusableList.findIndex((btn) => btn === document.activeElement);
        let nextIndex = currentIndex;
        if (key === 'ArrowUp' || key === 'ArrowLeft') nextIndex = Math.max(0, (currentIndex >= 0 ? currentIndex : 0) - 1);
        else if (key === 'ArrowDown' || key === 'ArrowRight') nextIndex = Math.min(focusableList.length - 1, (currentIndex >= 0 ? currentIndex : 0) + 1);
        else if (key === 'Home') nextIndex = 0;
        else if (key === 'End') nextIndex = focusableList.length - 1;
        const nextButton = focusableList[nextIndex];
        if (nextButton) {
          nextButton.focus();
          activate(TAB_IDS[nextIndex]);
        }
      });
    }
  }

  function wireUrlSync() {
    window.addEventListener('popstate', () => {
      const url = new URLSearchParams(window.location.search);
      const fromUrl = url.get('tab');
      if (fromUrl && TAB_IDS.includes(fromUrl) && fromUrl !== currentTabRef.current) {
        activate(fromUrl, { silent: true });
      }
    });
  }
}

const currentTabRef = { current: 'race' };

/**
 * Rewrite `?tab=` on the current URL without touching any other param. Uses replaceState so
 * the browser back button walks whatever the store subscriber already writes; a real
 * pushState per tab-change would fight the store's replaceState and spam history.
 */
function writeTabToUrl(tabId) {
  if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
  const params = new URLSearchParams(window.location.search);
  params.set('tab', tabId);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  try { window.history.replaceState({}, '', next); } catch (error) { /* ignore */ }
}

/** Read the current tab (from body dataset if the module has mounted, else "race"). */
export function currentTabId() {
  if (typeof document === 'undefined') return 'race';
  return document.body?.dataset?.tab || 'race';
}
