// Sign in with Microsoft (work and school accounts), the platform's
// multi-tenant Entra application. Like GoogleButton, it only obtains an
// OpenID Connect id token and hands it to the caller, which exchanges it for
// a session at the engine's /v1/auth/microsoft.
//
// The token comes back in a popup, to <this origin>/auth/microsoft. That
// address must be one of the application's registered SPA return addresses
// (one per product host) and should serve a blank page: this window reads the
// popup the moment it is back on our origin, before anything could run in it.
// The client id is PUBLIC (it is in every authorize URL).
import { useRef, useState } from 'react';

const CLIENT_ID = 'cb5c1b6e-aca8-48dd-9da9-31320de30b73';
const AUTHORIZE = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize';
const RETURN_PATH = '/auth/microsoft';
const GIVE_UP_MS = 5 * 60 * 1000;

export const MICROSOFT_ENABLED = !!CLIENT_ID;

function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function jwtClaims(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(part + '='.repeat((4 - (part.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}

/** Open Microsoft's sign-in in a popup and resolve with the id token, or
 *  reject with a sentence a person can read. */
export function microsoftIdToken() {
  return new Promise((resolve, reject) => {
    const state = randomHex();
    const nonce = randomHex();
    const back = `${window.location.origin}${RETURN_PATH}`;
    const url = `${AUTHORIZE}?${new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'id_token', redirect_uri: back,
      scope: 'openid profile email', response_mode: 'fragment',
      state, nonce, prompt: 'select_account',
    })}`;
    const w = 480;
    const h = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(url, 'microsoft-sign-in', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      reject(new Error('Allow pop-ups for this site to sign in with Microsoft.'));
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        reject(new Error('Microsoft sign in was cancelled.'));
        return;
      }
      if (Date.now() - started > GIVE_UP_MS) {
        window.clearInterval(timer);
        popup.close();
        reject(new Error('Microsoft sign in took too long. Try again.'));
        return;
      }
      let href = '';
      try { href = popup.location.href; } catch { return; }   // still on Microsoft's pages
      if (!href.startsWith(back)) return;
      window.clearInterval(timer);
      const params = new URLSearchParams(popup.location.hash.replace(/^#/, ''));
      popup.close();
      if (params.get('error')) {
        const why = (params.get('error_description') || '').split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, '');
        reject(new Error(why || 'Microsoft sign in did not complete.'));
        return;
      }
      const token = params.get('id_token') || '';
      if (!token || params.get('state') !== state || jwtClaims(token).nonce !== nonce) {
        reject(new Error('Microsoft sign in could not be confirmed. Try again.'));
        return;
      }
      resolve(token);
    }, 300);
  });
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function MicrosoftButton({ onCredential, onError, disabled }) {
  const [waiting, setWaiting] = useState(false);
  const cb = useRef({ onCredential, onError });
  cb.current = { onCredential, onError };
  if (!CLIENT_ID) return null;

  async function start() {
    setWaiting(true);
    try {
      const token = await microsoftIdToken();
      await cb.current.onCredential(token);
    } catch (ex) {
      cb.current.onError?.(ex instanceof Error ? ex.message : 'Microsoft sign in failed.');
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="auth-mswrap">
      <button type="button" className="auth-msbtn" onClick={start} disabled={disabled || waiting}>
        <MicrosoftLogo />
        <span>{waiting ? 'Waiting for Microsoft...' : 'Sign in with Microsoft'}</span>
      </button>
    </div>
  );
}
