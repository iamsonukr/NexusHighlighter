export type HighlightColor =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'orange'
  | 'purple';

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'purple',
];

// The anchor is everything we need to relocate a piece of text on a page
// that may have changed since we last saw it. See src/content/anchoring.ts
// for the recovery strategy that consumes this.
export interface TextAnchor {
  selectedText: string;
  prefixText: string; // ~40 chars immediately before the selection
  suffixText: string; // ~40 chars immediately after the selection
  paragraphText: string; // full text of the nearest block-level ancestor, for fuzzy fallback
  selector: string; // CSS selector path to the start container's parent element
  startOffset: number; // character offset of selection start within that element's text
  endOffset: number;
}

export interface Highlight {
  id: string;
  userId: string; // 'local' until an account is signed in
  pageId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  pageTitle: string;

  anchor: TextAnchor;
  color: HighlightColor;

  note: string | null;
  tags: string[];

  isPinned: boolean;
  isArchived: boolean;
  isSynced: boolean; // false until pushed to a future backend

  createdAt: number;
  updatedAt: number;
  deletedAt: number | null; // soft delete, so sync can propagate deletions
}

export interface PageRecord {
  id: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  description: string | null;
  favicon: string | null;
  readingStatus: 'unread' | 'reading' | 'completed' | 'archived';
  lastVisitedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  defaultColor: HighlightColor;
  syncToCloud: boolean;
  syncPreferenceSet: boolean;
  allowAnalytics: boolean;
  aiFeaturesEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultColor: 'yellow',
  syncToCloud: true,
  syncPreferenceSet: false,
  allowAnalytics: false,
  aiFeaturesEnabled: false,
};

// Messages passed between content script, background worker, and popup.
export type ExtensionMessage =
  | { type: 'HIGHLIGHTS_UPDATED'; pageId: string }
  | { type: 'GET_PAGE_STATS'; url: string }
  | { type: 'OPEN_SIDEBAR' }
  | { type: 'OPEN_PURCHASE_PAGE' }
  | { type: 'START_EXTENSION_AUTH' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'VERIFY_LICENSE'; key: string }
  | { type: 'GET_LICENSE_STATE' }
  | { type: 'REVERIFY_LICENSE' }
  | { type: 'CLEAR_LICENSE' }
  | { type: 'SYNC_HIGHLIGHT'; highlight: Highlight }
  | { type: 'SYNC_ALL_HIGHLIGHTS'; fullPull?: boolean }
  | { type: 'LICENSE_UPDATED'; state: LicenseState };

// ---------- Licensing ----------
// The extension has no accounts, login, or in-extension payment. A single
// license key is entered once in the popup and checked against the
// customer's own backend. All purchase/payment happens on that website,
// outside the extension entirely.

export interface VerifyLicenseSuccess {
  success: true;
  valid: boolean;
  hasAccess: boolean;
  reason: string;
  message: string;
  verifiedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    username: string;
    email: string;
    avatar: string | null;
    isActive: boolean;
  };
  product: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string;
    version: string;
    licenseType: string;
    supportedPlatforms: string[];
    published: boolean;
  };
  subscription: {
    id: string;
    status: string;
    startDate: string;
    endDate: string | null;
    cancelledAt: string | null;
  } | null;
  license: {
    key: string;
    status: string;
    durationDays: number;
    purchasedAt: string;
    redeemedAt: string | null;
    expiresAt: string | null;
    invoiceNumber: string;
  };
  plan: {
    id: string;
    name: string;
    type: string;
    price: number;
    currency: string;
    durationDays: number;
  } | null;
}

export interface VerifyLicenseFailure {
  success: false;
  message: string;
}

export type VerifyLicenseResponse = VerifyLicenseSuccess | VerifyLicenseFailure;

export interface ExtensionTokenResponse {
  success: boolean;
  message?: string;
  extensionSlug?: string;
  extensionToken?: string;
  tokenType?: 'license_key' | string;
  state?: string;
  access?: Omit<VerifyLicenseSuccess, 'success'> | VerifyLicenseFailure;
}

export type LicenseStatus = 'unset' | 'checking' | 'valid' | 'invalid' | 'offline';

export interface LicenseState {
  key: string | null;
  status: LicenseStatus;
  hasAccess: boolean;
  message: string | null;
  userId: string | null;
  userFullName: string | null;
  planName: string | null;
  expiresAt: string | null;
  lastVerifiedAt: number | null;
}

export const EMPTY_LICENSE_STATE: LicenseState = {
  key: null,
  status: 'unset',
  hasAccess: false,
  message: null,
  userId: null,
  userFullName: null,
  planName: null,
  expiresAt: null,
  lastVerifiedAt: null,
};
