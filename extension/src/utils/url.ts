/**
 * Strips tracking params and hash fragments so that
 *   https://example.com/article?utm_source=x
 *   https://example.com/article#section-2
 * both resolve to the same logical page as
 *   https://example.com/article
 *
 * Prefers a page's own <link rel="canonical"> when present, since that is
 * the site's own statement of its "real" URL.
 */
const TRACKING_PARAM_PREFIXES = ['utm_', 'ref', 'ref_src', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'si'];

export function getCanonicalUrl(doc: Document = document): string {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (link?.href) {
    try {
      return normalizeUrl(link.href);
    } catch {
      // fall through to location-based normalization
    }
  }
  return normalizeUrl(doc.location.href);
}

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const params = url.searchParams;
  [...params.keys()].forEach((key) => {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower === p || lower.startsWith(p))) {
      params.delete(key);
    }
  });
  url.hash = '';
  url.search = params.toString() ? `?${params.toString()}` : '';
  // strip trailing slash (except root) for consistency
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function getDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Deterministic id for a page derived from its canonical URL, so the same
 * page always maps to the same PageRecord without a round trip. */
export function pageIdFor(canonicalUrl: string): string {
  let hash = 0;
  for (let i = 0; i < canonicalUrl.length; i++) {
    hash = (hash << 5) - hash + canonicalUrl.charCodeAt(i);
    hash |= 0;
  }
  return `page_${Math.abs(hash).toString(36)}`;
}

export function getPageTitle(doc: Document = document): string {
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  return (ogTitle || doc.title || 'Untitled page').trim();
}

export function getPageDescription(doc: Document = document): string | null {
  const meta =
    doc.querySelector('meta[name="description"]') ||
    doc.querySelector('meta[property="og:description"]');
  return meta?.getAttribute('content')?.trim() || null;
}

export function getFavicon(doc: Document = document): string | null {
  const icon = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  return icon?.href || `${doc.location.origin}/favicon.ico`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
