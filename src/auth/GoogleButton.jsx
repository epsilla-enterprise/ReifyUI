// Google Identity Services button (shared Epsilla user pool) — extracted from
// ContextualGraph. On success it hands the id_token (credential) to the
// caller, which exchanges it for a session via the engine's /v1/auth/google.
//
// The client id is the shared platform OAuth Web client (PUBLIC — Google
// inlines it into every page); each product's origin must be listed on that
// client's Authorized JavaScript origins. The whole block (the "or" divider
// included) collapses when GIS cannot render, e.g. while an origin is not yet
// authorized, so the form never shows a dead gap.
import { useEffect, useRef, useState } from 'react';

const CLIENT_ID = '247853836408-ojk91u8901hdlbkevid4fohmrfdot17l.apps.googleusercontent.com';

export function GoogleButton({ onCredential, onError }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  // Keep the latest callbacks in a ref so the GIS button mounts exactly once
  // and never flickers when the parent re-renders on each keystroke.
  const cb = useRef({ onCredential, onError });
  cb.current = { onCredential, onError };

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return undefined;
    const SRC = 'https://accounts.google.com/gsi/client';
    let done = false;
    const render = () => {
      if (done) return;
      const g = window.google;
      if (!g?.accounts?.id || !ref.current) return;
      done = true;
      try {
        g.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (resp) => {
            if (resp?.credential) cb.current.onCredential(resp.credential);
            else cb.current.onError?.('Google sign in was cancelled.');
          },
        });
        ref.current.innerHTML = '';
        g.accounts.id.renderButton(ref.current, {
          theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 320,
        });
      } catch {
        setFailed(true);
      }
    };
    let s = document.querySelector(`script[src="${SRC}"]`);
    if (s && window.google) render();
    else {
      if (!s) {
        s = document.createElement('script');
        s.src = SRC;
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', render);
    }
    // If nothing rendered (script blocked, origin not authorized, offline),
    // collapse the block instead of leaving an empty gap.
    const check = window.setTimeout(() => {
      const iframe = ref.current?.querySelector('iframe');
      if (!iframe || iframe.getBoundingClientRect().height < 10) setFailed(true);
    }, 3500);
    return () => {
      s?.removeEventListener('load', render);
      window.clearTimeout(check);
    };
  }, []);

  if (!CLIENT_ID || failed) return null;
  return (
    <>
      <div className="auth-or"><span>or</span></div>
      <div ref={ref} className="auth-gwrap" />
    </>
  );
}

export const GOOGLE_ENABLED = !!CLIENT_ID;
