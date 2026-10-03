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
export const UNREGISTERED_HIGHLIGHT_LIMIT = 100;
export const REGISTERED_HIGHLIGHT_LIMIT = 500;
export const FREE_HIGHLIGHT_LIMIT = REGISTERED_HIGHLIGHT_LIMIT;
export const BASIC_HIGHLIGHT_LIMIT = 3000;
export const ADVANCED_HIGHLIGHT_LIMIT = 6000;
export const PRO_HIGHLIGHT_LIMIT = 10000;

export function getPlanHighlightLimit(planType?: string | null, planName?: string | null) {
  const plan = `${planType ?? ''} ${planName ?? ''}`.toLowerCase();

  if (plan.includes('pro')) return PRO_HIGHLIGHT_LIMIT;
  if (plan.includes('advance')) return ADVANCED_HIGHLIGHT_LIMIT;
  if (plan.includes('basic')) return BASIC_HIGHLIGHT_LIMIT;

  return REGISTERED_HIGHLIGHT_LIMIT;
}

export function isPaidPlan(planType?: string | null, planName?: string | null) {
  const plan = `${planType ?? ''} ${planName ?? ''}`.toLowerCase();
  return plan.includes('basic') || plan.includes('advance') || plan.includes('pro');
}

// Percent-of-limit thresholds at which we start nudging toward upgrading,
// so the first thing a near-limit user sees isn't a hard wall.
export const HIGHLIGHT_WARNING_THRESHOLD = 0.9; // show a soft warning at 90%

export const PURCHASE_URL = 'https://codersnexus.com/nexus-store/nexus-highlighter#pricing';
