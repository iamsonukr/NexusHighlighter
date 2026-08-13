/**
 * Free/registered vs. paid feature boundaries.
 *
 * Model: the extension works with NO license key at all, and a verified key
 * with a user.id identifies a registered user for cloud sync. Paid access can
 * still unlock premium tools such as export/global search.
 *
 * Keep this list honest: only gate things that are actually implemented.
 * AI and collections are not built yet.
 */
export const FREE_HIGHLIGHT_LIMIT = 2000;

// Percent-of-limit thresholds at which we start nudging toward upgrading,
// so the first thing a near-limit user sees isn't a hard wall.
export const HIGHLIGHT_WARNING_THRESHOLD = 0.9; // show a soft warning at 90%

export const PURCHASE_URL = 'https://codersnexus.com/nexus-store/nexus-highlighter#pricing';
