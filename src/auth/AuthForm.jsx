// The complete sign-in unit (modeled on the HarnessRouter login screen),
// extracted from ContextualGraph: brand mark on top, email + password with
// the sign in button, Google SSO below, then the register / forgot password
// links. Product-agnostic: the caller passes its brand node (`brand`) and
// product display name (`productName`); auth calls ride the shared client
// (configureAuth must have run at boot).
import { useState } from 'react';
import {
  login, register, googleSignIn, requestPasswordReset, switchOrg,
} from './client.js';
import { GoogleButton, GOOGLE_ENABLED } from './GoogleButton.jsx';

export function AuthForm({ onDone, subtitle, brand = null, productName = '' }) {
  const [mode, setMode] = useState('signin'); // signin | register | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState(null); // orgs, when the account has more than one
  const [resetSent, setResetSent] = useState(false);

  async function enter(orgId) {
    const session = await switchOrg(orgId);
    onDone(session);
  }

  // Route a freshly authenticated session: straight in, or via the org picker.
  async function afterAuth(session) {
    if (session.orgId) onDone(session);
    else if (session.orgs.length === 1) await enter(session.orgs[0].id);
    else if (session.orgs.length > 1) setChoices(session.orgs);
    else setErr('This account is not a member of any organization yet.');
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email.trim());
        setResetSent(true);
      } else {
        const s = mode === 'register'
          ? await register(email.trim(), password, name.trim())
          : await login(email.trim(), password);
        await afterAuth(s);
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : `${mode === 'register' ? 'Sign up' : 'Sign in'} failed.`);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(credential) {
    setErr('');
    setBusy(true);
    try {
      await afterAuth(await googleSignIn(credential));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Google sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (choices) {
    return (
      <div>
        <div className="logo">{brand}</div>
        <h1>Choose workspace</h1>
        <div className="org-list">
          {choices.map((o) => (
            <button
              key={o.id}
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start', height: 38 }}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                enter(o.id).catch((ex) => {
                  setErr(ex instanceof Error ? ex.message : 'Could not select the workspace.');
                  setBusy(false);
                });
              }}
            >
              {o.name || o.id}
            </button>
          ))}
        </div>
        {err && <div className="auth-err">{err}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="logo">{brand}</div>
      <h1>{mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</h1>
      <p className="sub">
        {mode === 'register' ? 'Get started in seconds.'
          : mode === 'forgot' ? 'We will email you a reset link.'
            : (subtitle || 'Welcome back.')}
      </p>

      {mode === 'forgot' ? (
        resetSent ? (
          <>
            <div className="auth-note">
              If an account exists for <b>{email.trim()}</b>, a password reset link is on its way. It is valid for 1 hour.
            </div>
            <button
              type="button"
              className="btn primary lg"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => { setErr(''); setResetSent(false); setMode('signin'); }}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="email" />
            </div>
            {err && <div className="auth-err">{err}</div>}
            <button type="submit" className="btn primary lg" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
              {busy ? 'Please wait...' : 'Send reset link'}
            </button>
            <p className="auth-switch">
              <button type="button" onClick={() => { setErr(''); setMode('signin'); }}>Back to sign in</button>
            </p>
          </>
        )
      ) : (
        <>
          {mode === 'register' && (
            <div className="field">
              <label>Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jane Doe" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="email" />
          </div>
          <div className="field">
            <div className="field-row">
              <label>Password</label>
              {mode === 'signin' && (
                <button type="button" className="link-sm" onClick={() => { setErr(''); setResetSent(false); setMode('forgot'); }}>
                  Forgot password?
                </button>
              )}
            </div>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={mode === 'register' ? 'At least 8 characters' : ''}
            />
          </div>
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" className="btn primary lg" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>

          {GOOGLE_ENABLED && <GoogleButton onCredential={onGoogle} onError={setErr} />}

          <p className="auth-switch">
            {mode === 'register' ? 'Already have an account?' : `New to ${productName || 'the product'}?`}{' '}
            <button type="button" onClick={() => { setErr(''); setMode(mode === 'register' ? 'signin' : 'register'); }}>
              {mode === 'register' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </>
      )}
    </form>
  );
}
