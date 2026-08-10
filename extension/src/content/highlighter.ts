import type { HighlightColor } from '@/types';

/**
 * Renders a highlight as one or more <mark> wrappers around the text nodes
 * inside a Range. We never touch element.innerHTML (see product brief §29) —
 * that would blow away any event listeners or framework-managed nodes the
 * host page has attached. Instead we walk the text nodes the Range spans and
 * wrap each one individually with Range.surroundContents on a per-text-node
 * sub-range, which only ever touches text nodes we split ourselves.
 */

const MARK_TAG = 'nm-mark';
const MARK_ATTR = 'data-nm-id';

export function renderHighlight(range: Range, id: string, color: HighlightColor): HTMLElement[] {
  const textNodes = getTextNodesInRange(range);
  const marks: HTMLElement[] = [];

  textNodes.forEach((node, i) => {
    const nodeRange = document.createRange();
    if (i === 0) {
      nodeRange.setStart(node, range.startContainer === node ? range.startOffset : 0);
    } else {
      nodeRange.setStart(node, 0);
    }
    if (i === textNodes.length - 1) {
      nodeRange.setEnd(node, range.endContainer === node ? range.endOffset : node.length);
    } else {
      nodeRange.setEnd(node, node.length);
    }
    if (nodeRange.collapsed) return;

    const mark = document.createElement(MARK_TAG);
    mark.setAttribute(MARK_ATTR, id);
    mark.dataset.color = color;
    mark.style.cssText = markStyle(color);
    try {
      nodeRange.surroundContents(mark);
      marks.push(mark);
    } catch {
      // surroundContents throws if the sub-range partially selects a
      // non-text node boundary; skip that fragment rather than corrupt
      // the page. Loss is limited to that one fragment's visual highlight.
    }
  });

  return marks;
}

export function removeHighlight(id: string): void {
  document.querySelectorAll(`${MARK_TAG}[${MARK_ATTR}="${cssEscape(id)}"]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize(); // merges adjacent text nodes back together
  });
}

export function removeAllHighlights(): void {
  document.querySelectorAll(`${MARK_TAG}[${MARK_ATTR}]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

export function recolorHighlight(id: string, color: HighlightColor): void {
  document.querySelectorAll<HTMLElement>(`${MARK_TAG}[${MARK_ATTR}="${cssEscape(id)}"]`).forEach((mark) => {
    mark.dataset.color = color;
    mark.style.cssText = markStyle(color);
  });
}

export function scrollToHighlight(id: string): void {
  const el = document.querySelector<HTMLElement>(`${MARK_TAG}[${MARK_ATTR}="${cssEscape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Inline-styled pulse rather than a page-level stylesheet class: this file
  // renders directly into the host page (outside our shadow root), so it
  // can't rely on the shadow root's injected CSS for the animation.
  const original = el.style.outline;
  el.style.transition = 'outline-color 1.1s ease-out, outline-offset 1.1s ease-out';
  el.style.outline = '2px solid rgba(52, 80, 163, 0.9)';
  el.style.outlineOffset = '2px';
  requestAnimationFrame(() => {
    el.style.outline = '2px solid rgba(52, 80, 163, 0)';
    el.style.outlineOffset = '6px';
  });
  setTimeout(() => {
    el.style.outline = original;
    el.style.transition = '';
  }, 1200);
}

function getTextNodesInRange(range: Range): Text[] {
  const nodes: Text[] = [];

  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    const node = range.commonAncestorContainer as Text;
    return range.intersectsNode(node) && (node.textContent ?? '').length > 0 ? [node] : [];
  }

  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').length > 0) nodes.push(node as Text);
  }
  return nodes;
}

const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: '#FFD84D',
  green: '#8FD14F',
  blue: '#6EC6FF',
  pink: '#FF8FB3',
  orange: '#FFA94D',
  purple: '#C08FFF',
};

function markStyle(color: HighlightColor): string {
  return `background-color:${COLOR_HEX[color]}66; box-shadow: 0 0 0 1px ${COLOR_HEX[color]}33; border-radius:2px; cursor:pointer; padding:0.02em 0;`;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
