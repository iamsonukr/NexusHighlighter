/**
 * Free vs. Pro feature boundaries.
 *
 * Model: the extension works with NO license key at all; that's the free
 * tier. Entering a key that verifies with hasAccess: true unlocks Pro. There
 * is no separate "locked out" state; everyone gets the core loop.
 *
 * Keep this list honest: only gate things that are actually implemented.
 * Cloud sync runs after a valid Pro license is present; AI and collections
 * are not built yet.
 */
export const FREE_HIGHLIGHT_LIMIT = 500;

// Percent-of-limit thresholds at which we start nudging toward upgrading,
// so the first thing a near-limit user sees isn't a hard wall.
export const HIGHLIGHT_WARNING_THRESHOLD = 0.9; // show a soft warning at 90%
