/**
 * Shared SVG DOM helpers for the charts modules. Kept in one place so both charts-strips.js and
 * charts-time-split.js can be unit-tested under node --test with the same minimal stub.
 *
 * The helpers work under both a real browser and a stub host with createElementNS/appendChild,
 * so a chart rendered in tests draws into a synthetic svg exactly the way it draws in the page.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function ensureSvg(host) {
  if (isSvgLike(host)) return host;
  if (host && host.children && host.children.length) {
    for (let i = 0; i < host.children.length; i += 1) {
      const c = host.children[i];
      if (isSvgLike(c)) return c;
    }
  }
  const doc = getOwnerDocument(host);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  host.appendChild(svg);
  return svg;
}

function isSvgLike(node) {
  return !!node && (
    node.tagName === 'svg' || node.tagName === 'SVG'
    || node.nodeName === 'svg' || node.nodeName === 'SVG'
    || (typeof node.tagName === 'string' && node.tagName.toLowerCase() === 'svg')
  );
}

function getOwnerDocument(host) {
  if (host && host.ownerDocument) return host.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('charts: no owner document');
}

export function clearElement(el) {
  if (!el) return;
  if (typeof el.replaceChildren === 'function') {
    el.replaceChildren();
    return;
  }
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setAttrs(el, attrs) {
  for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
}

export function readNumericAttr(el, name) {
  if (!el || !el.getAttribute) return null;
  const v = el.getAttribute(name);
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function appendChildNS(parent, tag, attrs, textContent) {
  const doc = getOwnerDocument(parent);
  const el = doc.createElementNS(SVG_NS, tag);
  if (attrs) setAttrs(el, attrs);
  if (textContent != null) el.textContent = String(textContent);
  parent.appendChild(el);
  return el;
}

export function appendRect(parent, attrs) { return appendChildNS(parent, 'rect', attrs); }
export function appendCircle(parent, attrs) { return appendChildNS(parent, 'circle', attrs); }
export function appendLine(parent, attrs) { return appendChildNS(parent, 'line', attrs); }
export function appendText(parent, attrs, text) { return appendChildNS(parent, 'text', attrs, text); }
