// format.js
// Tiny formatting + DOM helpers shared across the UI modules. DOM helpers are
// only called in the browser; the number formatters are pure.

/** Format a number with thousands separators and no decimals. */
export function fmtInt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('de-DE');
}

/** Format money (integer with a leading currency-ish marker). */
export function fmtMoney(n) {
  return fmtInt(n);
}

/** Format a 0..1 probability as a percentage with one decimal. */
export function fmtPct(p) {
  return `${(Number(p) * 100).toFixed(1)}%`;
}

/** Format a float with a fixed number of decimals. */
export function fmtFloat(n, d = 2) {
  return (Number(n) || 0).toFixed(d);
}

/** Escape text for safe insertion as HTML text content via attributes. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create an element with optional props and children. Minimal hyperscript so UI
 * modules avoid innerHTML string building (which is error-prone to escape).
 * @param {string} tag
 * @param {object} [props] { class, text, title, onclick, attrs:{}, ... }
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'title') node.title = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) node.setAttribute(ak, av);
    else node.setAttribute(k, v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) {
  if (node) while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Build a tooltip title string from a breakdown object (key: value lines).
 * @param {object} breakdown
 * @returns {string}
 */
export function tooltipFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return '';
  return Object.entries(breakdown)
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? Number(v.toFixed ? v.toFixed(3) : v) : v}`)
    .join('\n');
}
