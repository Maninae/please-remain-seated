/**
 * Phone-only settings drawer.
 *
 * On phone (< 900 px) the sidebar slides in from the right. This module owns the toggle
 * button, the scrim, focus trapping while the drawer is open, and body-scroll locking.
 *
 * The desktop and 900-1099 layout keep the sidebar mounted in place; this module simply
 * treats any width >= 900 as always-open and never touches the transform or the scrim.
 */

const DRAWER_OPEN_CLASS = 'settings-open';
const MEDIA_QUERY = '(max-width: 899px)';

export function mountSettingsDrawer() {
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('btn-close-settings');
  const scrim = document.getElementById('settings-scrim');
  const drawer = document.getElementById('settings-panel');
  if (!drawer) return;

  const mql = window.matchMedia(MEDIA_QUERY);
  let scrollTop = 0;

  function isPhone() { return mql.matches; }

  function open() {
    if (!isPhone()) return;
    if (document.body.classList.contains(DRAWER_OPEN_CLASS)) return;
    scrollTop = window.scrollY;
    document.body.classList.add(DRAWER_OPEN_CLASS);
    document.body.style.overflow = 'hidden';
    if (scrim) scrim.hidden = false;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    // Focus lands on the drawer's close button so keyboard users have a clear anchor.
    if (closeBtn) closeBtn.focus();
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', enforceFocusTrap, true);
  }

  function close() {
    if (!document.body.classList.contains(DRAWER_OPEN_CLASS)) return;
    document.body.classList.remove(DRAWER_OPEN_CLASS);
    document.body.style.overflow = '';
    if (scrim) scrim.hidden = true;
    if (openBtn) {
      openBtn.setAttribute('aria-expanded', 'false');
      openBtn.focus();
    }
    // Restore prior scroll position (locking overflow leaves the offset alone but this keeps
    // any layout shift honest across browsers).
    window.scrollTo(0, scrollTop);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', enforceFocusTrap, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // The drawer traps Tab so focus does not escape into the (hidden) page behind it.
      const focusables = focusableInDrawer();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function enforceFocusTrap(event) {
    if (!document.body.classList.contains(DRAWER_OPEN_CLASS)) return;
    if (drawer.contains(event.target)) return;
    // Focus escaped to the background page (a bit of dev-tools poking, most commonly). Put it
    // back on the close button.
    if (closeBtn) closeBtn.focus();
  }

  function focusableInDrawer() {
    return Array.from(drawer.querySelectorAll(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (scrim) scrim.addEventListener('click', close);

  mql.addEventListener('change', (event) => {
    if (!event.matches && document.body.classList.contains(DRAWER_OPEN_CLASS)) {
      // Went from phone to wider: drop the drawer state so the sticky sidebar takes over.
      close();
    }
  });
}
