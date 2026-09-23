/**
 * A small round "i" info button and its popover.
 *
 * Usage:
 *   attachInfo(anchorElement, 'strategy-a-info');    // reads the id off the button data-info
 *   attachInfoTo(labelSpan, key, { placement: 'end' })  // programmatic: append a button
 *
 * Content comes from `js/ui/glossary.js`. One popover open at a time, keyboard-driven, click
 * outside or Escape or scroll to close. The popover is anchored to its trigger; the trigger
 * gets focus back on close for a clean keyboard flow.
 *
 * Anchoring: on click, the popover sits below the button by default and flips above when there
 * is no room. A tiny ink pointer nudges toward the trigger so a reader knows what it explains.
 *
 * The trigger button ships a fixed 20 px "i" glyph inside a 44 px hit target on touch and a
 * 28 px hit target on desktop; both come out of the same CSS class.
 */

import { GLOSSARY } from './glossary.js';

const POPOVER_MAX_WIDTH = 320;
const POPOVER_GAP = 8;

let activePopover = null;
let scrollHandler = null;
let resizeHandler = null;
let keyHandler = null;
let clickHandler = null;

/**
 * Build a real info button (a <button>) and return the DOM node. The caller inserts it.
 */
export function createInfoButton(key, { label } = {}) {
  const entry = GLOSSARY[key];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'info-btn';
  button.setAttribute('aria-label', `About ${entry?.title || label || key}`);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.dataset.infoKey = key;
  button.innerHTML = '<span aria-hidden="true">i</span>';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Re-read the key from dataset so callers that swap the key on a select change (a
    // strategy dropdown, the aircraft picker) route to the current entry instead of the one
    // that was live when the button was built.
    const currentKey = button.dataset.infoKey || key;
    toggle(button, currentKey);
  });
  return button;
}

/**
 * Wire every element already in the DOM that carries `data-info-for` (single glossary key), by
 * appending an info button right after it. Called by main.js at boot.
 */
export function mountInfoButtons(root = document) {
  const anchors = root.querySelectorAll('[data-info-for]');
  for (const anchor of anchors) {
    const key = anchor.dataset.infoFor;
    if (!key || !GLOSSARY[key]) continue;
    if (anchor.querySelector(':scope > .info-btn')) continue;
    anchor.appendChild(createInfoButton(key));
  }
}

function toggle(button, key) {
  if (activePopover && activePopover.trigger === button) {
    closeActive({ restoreFocus: true });
    return;
  }
  if (activePopover) closeActive();
  open(button, key);
}

function open(trigger, key) {
  const entry = GLOSSARY[key];
  if (!entry) return;
  const popover = buildPopover(entry, key);
  document.body.appendChild(popover);
  positionPopover(popover, trigger);
  trigger.setAttribute('aria-expanded', 'true');
  activePopover = { trigger, node: popover, key };
  // Focus the close button so keyboard users have somewhere to land.
  const closeBtn = popover.querySelector('.info-popover-close');
  if (closeBtn) closeBtn.focus();
  wireCloseListeners();
}

function buildPopover(entry, key) {
  const wrapper = document.createElement('div');
  wrapper.className = 'info-popover';
  wrapper.setAttribute('role', 'dialog');
  const titleId = `info-popover-title-${key.replace(/[^a-z0-9-]/gi, '-')}`;
  wrapper.setAttribute('aria-labelledby', titleId);
  wrapper.setAttribute('data-info-popover', key);

  const header = document.createElement('div');
  header.className = 'info-popover-header';

  const title = document.createElement('h3');
  title.id = titleId;
  title.className = 'info-popover-title';
  title.textContent = entry.title;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'info-popover-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActive({ restoreFocus: true });
  });
  header.appendChild(closeBtn);

  wrapper.appendChild(header);

  const body = document.createElement('p');
  body.className = 'info-popover-body';
  body.textContent = entry.body;
  wrapper.appendChild(body);

  if (entry.learnMore && entry.learnMore.href) {
    const link = document.createElement('a');
    link.className = 'info-popover-link';
    link.href = entry.learnMore.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = entry.learnMore.label || 'Learn more';
    wrapper.appendChild(link);
  }

  wrapper.appendChild(makePointer());
  return wrapper;
}

function makePointer() {
  const pointer = document.createElement('span');
  pointer.className = 'info-popover-pointer';
  pointer.setAttribute('aria-hidden', 'true');
  return pointer;
}

function positionPopover(popover, trigger) {
  // Two passes: place off-screen so we can measure, then anchor. The popover flips above the
  // trigger when there is not enough space below.
  popover.style.left = '-9999px';
  popover.style.top = '-9999px';
  popover.style.maxWidth = `${POPOVER_MAX_WIDTH}px`;

  const triggerRect = trigger.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = triggerRect.bottom + POPOVER_GAP;
  let placement = 'below';
  if (top + popRect.height > viewportHeight - 8 && triggerRect.top > popRect.height + POPOVER_GAP) {
    top = triggerRect.top - popRect.height - POPOVER_GAP;
    placement = 'above';
  }

  let left = triggerRect.left + triggerRect.width / 2 - popRect.width / 2;
  const minLeft = 8;
  const maxLeft = viewportWidth - popRect.width - 8;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  popover.style.left = `${Math.round(left + window.scrollX)}px`;
  popover.style.top = `${Math.round(top + window.scrollY)}px`;
  popover.dataset.placement = placement;

  const pointer = popover.querySelector('.info-popover-pointer');
  if (pointer) {
    const pointerLeft = triggerRect.left + triggerRect.width / 2 - left;
    pointer.style.left = `${Math.round(pointerLeft)}px`;
  }
}

function wireCloseListeners() {
  keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeActive({ restoreFocus: true });
    }
  };
  clickHandler = (event) => {
    if (!activePopover) return;
    if (activePopover.node.contains(event.target)) return;
    if (activePopover.trigger.contains(event.target)) return;
    closeActive();
  };
  scrollHandler = () => closeActive();
  resizeHandler = () => closeActive();
  document.addEventListener('keydown', keyHandler, true);
  document.addEventListener('mousedown', clickHandler, true);
  document.addEventListener('touchstart', clickHandler, true);
  window.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
  window.addEventListener('resize', resizeHandler);
}

function unwireCloseListeners() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  if (clickHandler) {
    document.removeEventListener('mousedown', clickHandler, true);
    document.removeEventListener('touchstart', clickHandler, true);
  }
  if (scrollHandler) window.removeEventListener('scroll', scrollHandler, { capture: true });
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  keyHandler = null;
  clickHandler = null;
  scrollHandler = null;
  resizeHandler = null;
}

function closeActive({ restoreFocus = false } = {}) {
  if (!activePopover) return;
  const { trigger, node } = activePopover;
  trigger.setAttribute('aria-expanded', 'false');
  if (node && node.parentNode) node.parentNode.removeChild(node);
  activePopover = null;
  unwireCloseListeners();
  if (restoreFocus && trigger && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}

/**
 * Given a strategy select element (`<select>`), attach an info button next to it whose key
 * tracks the currently-selected option. The caller passes a function that maps a value to its
 * glossary key (usually the same string as the strategy id).
 */
export function attachDynamicInfoButton(selectElement, keyFor) {
  if (!selectElement) return null;
  const button = createInfoButton(keyFor(selectElement.value) || selectElement.value);
  selectElement.insertAdjacentElement('afterend', button);
  const update = () => {
    const nextKey = keyFor(selectElement.value) || selectElement.value;
    if (!GLOSSARY[nextKey]) return;
    const entry = GLOSSARY[nextKey];
    button.dataset.infoKey = nextKey;
    button.setAttribute('aria-label', `About ${entry.title}`);
    if (activePopover && activePopover.trigger === button) {
      closeActive();
    }
  };
  selectElement.addEventListener('change', update);
  return { button, update };
}

/**
 * Test hook: is a popover open right now? Used only by e2e; unit code should not care.
 */
export function isPopoverOpen() {
  return activePopover !== null;
}
