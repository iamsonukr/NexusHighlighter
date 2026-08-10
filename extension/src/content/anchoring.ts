import type { TextAnchor } from '@/types';

/**
 * Text anchoring system.
 *
 * We never rely on DOM child-indexes alone (sites reflow their markup
 * constantly). Instead every highlight is captured as a *description* of
 * the text — its own content plus a little of what surrounds it — and
 * relocated at read time by re-finding that description, trying
 * progressively looser strategies until one works:
 *
 *   1. Exact text + prefix/suffix context   (cheap, and correct almost always)
 *   2. Prefix + selected text + suffix scan (handles small surrounding edits)
 *   3. Paragraph/context fuzzy match        (handles reflowed markup)
 *   4. CSS selector fallback                (last resort, position-based)
 *
 * If none succeed, the highlight is reported as "not found" rather than
 * silently mis-placed — see restoreHighlights() in index.tsx.
 */

const CONTEXT_LEN = 40;

export function captureAnchor(range: Range): TextAnchor | null {
  const selectedText = range.toString();
  if (!selectedText.trim()) return null;

  const container = closestBlockAncestor(range.commonAncestorContainer);
  const fullText = container?.textContent ?? '';
  const startIndexInBlock = container ? getTextOffsetWithin(container, range.startContainer, range.startOffset) : -1;
  const endIndexInBlock = container ? getTextOffsetWithin(container, range.endContainer, range.endOffset) : -1;
  const hasExactOffsets =
    startIndexInBlock >= 0 &&
    endIndexInBlock >= startIndexInBlock &&
    fullText.slice(startIndexInBlock, endIndexInBlock) === selectedText;

  const prefixText =
    hasExactOffsets
      ? fullText.slice(Math.max(0, startIndexInBlock - CONTEXT_LEN), startIndexInBlock)
      : getAdjacentText(range, 'before');

  const suffixText =
    hasExactOffsets
      ? fullText.slice(endIndexInBlock, endIndexInBlock + CONTEXT_LEN)
      : getAdjacentText(range, 'after');

  return {
    selectedText,
    prefixText,
    suffixText,
    paragraphText: fullText.slice(0, 2000), // cap so we never store megabytes for one anchor
    selector: container ? cssPath(container) : 'body',
    startOffset: hasExactOffsets ? startIndexInBlock : 0,
    endOffset: hasExactOffsets ? endIndexInBlock : selectedText.length,
  };
}

export interface LocateResult {
  range: Range;
  strategy: 1 | 2 | 3 | 4;
}

export function locateAnchor(anchor: TextAnchor): LocateResult | null {
  return (
    strategyExactWithContext(anchor) ??
    strategyStoredOffsetInSelector(anchor) ??
    strategyPrefixSuffixScan(anchor) ??
    strategyParagraphFuzzyMatch(anchor) ??
    strategySelectorFallback(anchor)
  );
}

// ---- Strategy 1: exact text, verified by surrounding context ----
function strategyExactWithContext(anchor: TextAnchor): LocateResult | null {
  const root = document.body;
  const matches = findAllTextOccurrences(root, anchor.selectedText);
  for (const range of matches) {
    const { before, after } = getSurroundingText(range, CONTEXT_LEN);
    if (before.endsWith(anchor.prefixText.slice(-15)) && after.startsWith(anchor.suffixText.slice(0, 15))) {
      return { range, strategy: 1 };
    }
  }
  // Unique match even without context confirmation is still strategy 1.
  if (matches.length === 1) return { range: matches[0], strategy: 1 };
  return null;
}

// ---- Strategy 2: scan for prefix+text+suffix as one string ----
function strategyPrefixSuffixScan(anchor: TextAnchor): LocateResult | null {
  const combined = `${anchor.prefixText}${anchor.selectedText}${anchor.suffixText}`;
  const container = document.querySelector(anchor.selector) ?? document.body;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let blockText = '';
  const nodes: Text[] = [];
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
    blockText += node.textContent ?? '';
  }
  const idx = blockText.indexOf(combined);
  if (idx === -1) return null;
  const start = idx + anchor.prefixText.length;
  const end = start + anchor.selectedText.length;
  return buildRangeFromFlatOffsets(nodes, start, end);
}

// ---- Strategy 3: fuzzy match against the stored paragraph text ----
function strategyParagraphFuzzyMatch(anchor: TextAnchor): LocateResult | null {
  const candidates = document.querySelectorAll<HTMLElement>('p, li, blockquote, td, div, span, h1, h2, h3, h4');
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of candidates) {
    const text = el.textContent ?? '';
    if (!text.includes(anchor.selectedText)) continue;
    const score = similarity(text.slice(0, 300), anchor.paragraphText.slice(0, 300));
    if (score > 0.5 && (!best || score > best.score)) best = { el, score };
  }
  if (!best) return null;
  const range = findFirstOccurrenceIn(best.el, anchor.selectedText);
  return range ? { range, strategy: 3 } : null;
}

// ---- Strategy 4: CSS selector position fallback ----
function strategySelectorFallback(anchor: TextAnchor): LocateResult | null {
  const el = document.querySelector<HTMLElement>(anchor.selector);
  if (!el) return null;
  const range = findFirstOccurrenceIn(el, anchor.selectedText);
  return range ? { range, strategy: 4 } : null;
}

// ---------- shared helpers ----------

function closestBlockAncestor(node: Node): HTMLElement | null {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const blockTags = new Set(['P', 'LI', 'BLOCKQUOTE', 'TD', 'ARTICLE', 'SECTION', 'DIV', 'H1', 'H2', 'H3', 'H4']);
  while (el && !blockTags.has(el.tagName)) {
    el = el.parentElement;
  }
  return el ?? (node.parentElement as HTMLElement | null);
}

function getAdjacentText(range: Range, side: 'before' | 'after'): string {
  const surrounding = getSurroundingText(range, CONTEXT_LEN);
  return side === 'before' ? surrounding.before : surrounding.after;
}

function getTextOffsetWithin(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  try {
    range.selectNodeContents(root);
    range.setEnd(container, offset);
    return range.toString().length;
  } catch {
    return -1;
  }
}

function getSurroundingText(range: Range, len: number): { before: string; after: string } {
  const beforeRange = document.createRange();
  beforeRange.setStart(document.body, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const before = beforeRange.toString().slice(-len);

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEndAfter(document.body.lastChild ?? document.body);
  const after = afterRange.toString().slice(0, len);

  return { before, after };
}

function findAllTextOccurrences(root: HTMLElement, text: string): Range[] {
  if (!text) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isVisible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes: Text[] = [];
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) nodes.push(node as Text);

  const flat = nodes.map((n) => n.textContent ?? '').join('');
  let fromIndex = 0;
  let idx: number;
  // Cap to first 25 matches so a very common phrase can't hang the page.
  while ((idx = flat.indexOf(text, fromIndex)) !== -1 && ranges.length < 25) {
    const range = buildRangeFromFlatOffsets(nodes, idx, idx + text.length)?.range;
    if (range) ranges.push(range);
    fromIndex = idx + 1;
  }
  return ranges;
}

function findFirstOccurrenceIn(el: HTMLElement, text: string): Range | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) nodes.push(node as Text);
  const flat = nodes.map((n) => n.textContent ?? '').join('');
  const idx = flat.indexOf(text);
  if (idx === -1) return null;
  return buildRangeFromFlatOffsets(nodes, idx, idx + text.length)?.range ?? null;
}

function strategyStoredOffsetInSelector(anchor: TextAnchor): LocateResult | null {
  const el = document.querySelector<HTMLElement>(anchor.selector);
  return el ? rangeFromStoredOffsets(el, anchor) : null;
}

function rangeFromStoredOffsets(el: HTMLElement, anchor: TextAnchor): LocateResult | null {
  if (anchor.startOffset < 0 || anchor.endOffset <= anchor.startOffset) return null;
  const text = el.textContent ?? '';
  if (text.slice(anchor.startOffset, anchor.endOffset) !== anchor.selectedText) return null;

  const nodes = textNodesUnder(el);
  const located = buildRangeFromFlatOffsets(nodes, anchor.startOffset, anchor.endOffset);
  return located ? { range: located.range, strategy: 4 } : null;
}

function textNodesUnder(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

function buildRangeFromFlatOffsets(nodes: Text[], start: number, end: number): LocateResult | null {
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const n of nodes) {
    const len = n.textContent?.length ?? 0;
    if (!startNode && pos + len > start) {
      startNode = n;
      startOffset = start - pos;
    }
    if (!endNode && pos + len >= end) {
      endNode = n;
      endOffset = end - pos;
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;

  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    return null;
  }
  return { range, strategy: 1 };
}

function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.closest('[data-notemark-ui]')) return false; // never match inside our own UI
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/** Cheap trigram-ish similarity for fuzzy paragraph matching (0..1). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(shingles(a));
  const setB = new Set(shingles(b));
  let intersection = 0;
  setA.forEach((s) => {
    if (setB.has(s)) intersection++;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function shingles(text: string, n = 4): string[] {
  const clean = text.toLowerCase().replace(/\s+/g, ' ');
  const out: string[] = [];
  for (let i = 0; i <= clean.length - n; i++) out.push(clean.slice(i, i + n));
  return out;
}

function cssPath(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  let depth = 0;
  while (current && current.nodeType === Node.ELEMENT_NODE && depth < 6) {
    let selector = current.tagName.toLowerCase();
    if (current.classList.length) {
      selector += `.${[...current.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.')}`;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((c) => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  return parts.join(' > ');
}
