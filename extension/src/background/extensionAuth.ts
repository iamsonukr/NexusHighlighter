import type { ExtensionTokenResponse, LicenseState, VerifyLicenseResponse } from '@/types';
import { EMPTY_LICENSE_STATE } from '@/types';
import { saveLicenseState } from '@/storage/db';
import { responseToState } from './license';

const EXTENSION_SLUG = 'notemark';
const WEBSITE_LOGIN_URL = import.meta.env.VITE_CODERSNEXUS_LOGIN_URL || 'https://codersnexus.com/login';
const TOKEN_URL =
  import.meta.env.VITE_EXTENSION_AUTH_TOKEN_URL ||
  'https://nexusbackend-ookk.onrender.com/api/extension-auth/token';

function createState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || 'Extension sign in was cancelled.'));
        return;
      }
      if (!responseUrl) {
        reject(new Error('CodersNexus did not return to the extension.'));
        return;
      }
      resolve(responseUrl);
    });
  });
}

function buildLoginUrl(redirectUri: string, state: string): string {
  const url = new URL(WEBSITE_LOGIN_URL);
  url.searchParams.set('extension', EXTENSION_SLUG);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCode(code: string): Promise<ExtensionTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, extensionSlug: EXTENSION_SLUG }),
  });
  const data = (await res.json().catch(() => null)) as ExtensionTokenResponse | null;
  if (!res.ok || !data?.success || !data.extensionToken) {
    throw new Error(data?.message || 'Could not complete CodersNexus extension sign in.');
  }
  return data;
}

function tokenResponseToState(response: ExtensionTokenResponse): LicenseState {
  const access = response.access;
  if (!response.extensionToken) {
    throw new Error('CodersNexus did not return an extension token.');
  }
  if (!access || !('user' in access) || !access.user?.id) {
    throw new Error('CodersNexus authorized the extension but did not return the account identity.');
  }

  const verifyResponse = access
    ? ({ success: Boolean('hasAccess' in access ? access.hasAccess : response.success), ...access } as VerifyLicenseResponse)
    : ({
        ...EMPTY_LICENSE_STATE,
        success: true,
        valid: true,
        hasAccess: true,
        message: response.message || 'Extension authorized.',
      } as VerifyLicenseResponse);

  const state = responseToState(response.extensionToken, verifyResponse);
  if (!state.key || !state.userId) {
    throw new Error('CodersNexus authorization completed, but the extension could not store the returned token.');
  }
  return state;
}

export async function startExtensionAuth(): Promise<LicenseState> {
  const expectedState = createState();
  const redirectUri = chrome.identity.getRedirectURL('notemark-auth');
  const responseUrl = await launchWebAuthFlow(buildLoginUrl(redirectUri, expectedState));
  const callbackUrl = new URL(responseUrl);

  const error = callbackUrl.searchParams.get('error');
  if (error) {
    throw new Error(callbackUrl.searchParams.get('error_description') || error);
  }

  const returnedState = callbackUrl.searchParams.get('state') || '';
  if (returnedState !== expectedState) {
    throw new Error('Extension auth state validation failed.');
  }

  const extensionSlug = callbackUrl.searchParams.get('extension') || EXTENSION_SLUG;
  if (extensionSlug.toLowerCase() !== EXTENSION_SLUG) {
    throw new Error('CodersNexus returned a token for a different extension.');
  }

  const code = callbackUrl.searchParams.get('code');
  if (!code) throw new Error('CodersNexus did not return an authorization code.');

  const tokenResponse = await exchangeCode(code);
  if ((tokenResponse.state || '') !== expectedState) {
    throw new Error('Extension token state validation failed.');
  }

  const state = tokenResponseToState(tokenResponse);
  await saveLicenseState(state);
  return state;
}
