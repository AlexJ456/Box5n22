/** Minimal DOM helpers. No framework, no innerHTML in any hot path. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    // Object.assign silently drops custom properties — they need setProperty.
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, String(v));
        else node.style[prop] = v;
      }
    }
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/** Feather-style single-stroke icons, drawn at 24×24. */
const PATHS = {
  play: ['M7 4.5 19 12 7 19.5Z'],
  pause: ['M9 5v14', 'M15 5v14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  back: ['M15 5l-7 7 7 7'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M12 2.6a2 2 0 0 1 2 2v.5l1.5.9.4-.2a2 2 0 0 1 2.7.7l.4.7a2 2 0 0 1-.7 2.7l-.4.2v1.8l.4.2a2 2 0 0 1 .7 2.7l-.4.7a2 2 0 0 1-2.7.7l-.4-.2-1.5.9v.5a2 2 0 0 1-2 2h-.8a2 2 0 0 1-2-2v-.5l-1.5-.9-.4.2a2 2 0 0 1-2.7-.7l-.4-.7a2 2 0 0 1 .7-2.7l.4-.2v-1.8l-.4-.2a2 2 0 0 1-.7-2.7l.4-.7a2 2 0 0 1 2.7-.7l.4.2 1.5-.9v-.5a2 2 0 0 1 2-2z'
  ],
  chart: ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M21.5 20h-19'],
  check: ['M5 13l4 4L19 7'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  volume: ['M11 5 6.5 9H3v6h3.5L11 19z', 'M15.5 9.2a4 4 0 0 1 0 5.6', 'M18.4 6.3a8 8 0 0 1 0 11.4'],
  volumeOff: ['M11 5 6.5 9H3v6h3.5L11 19z', 'M16 10l5 4', 'M21 10l-5 4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.2 1.9'],
  bell: ['M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5', 'M13.7 20.5a2 2 0 0 1-3.4 0'],
  hash: ['M4.5 9h15', 'M4.5 15h15', 'M10.5 3.5 8.5 20.5', 'M16.5 3.5l-2 17']
};

export function icon(name) {
  const node = svg('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false'
  });
  for (const d of PATHS[name]) node.append(svg('path', { d }));
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** "7:04" — the session clock format. */
export function mmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
