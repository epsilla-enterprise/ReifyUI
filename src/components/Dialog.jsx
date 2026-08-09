// Dialog — in-app replacements for window.alert / window.confirm / window.prompt.
//
// Agentic surfaces ask the user things constantly: confirm a destructive tool call, name a
// workspace, acknowledge a failure. Native browser popups block the event loop, cannot be
// styled, and look like a security warning rather than part of your product. This gives the
// same call-site ergonomics — an awaited call that returns a value — without any of that.
//
// Usage:
//   1. Mount <DialogHost> once, wrapping your app.
//   2. Anywhere underneath:
//
//        const { confirm, prompt, alert } = useDialog();
//
//        if (await confirm({ title: 'Delete task', message: 'This cannot be undone.',
//                            destructive: true, confirmLabel: 'Delete' })) { … }
//
//        const name = await prompt({ title: 'New workspace', label: 'Name',
//                                    validate: (v) => v.length < 40 ? null : 'Too long' });
//        // string, or null when cancelled
//
//        await alert({ title: 'Run failed', message: err, variant: 'error' });
//
// Dialogs stack rather than replace: a second caller layers on top instead of trampling the
// first, because two independent code paths asking at once is normal in a streaming UI.
//
// Styling is one stylesheet away — import 'reifyui/styles/dialog.css' — and every colour is a
// themeable variable, so it inherits the host app's palette.
import {
  createContext, useCallback, useContext, useEffect,
  useId, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

const DialogCtx = createContext(null);

const LABELS = {
  en: { confirm: 'Confirm', cancel: 'Cancel', ok: 'OK', create: 'Create', required: 'Please enter a value' },
  zh: { confirm: '确认', cancel: '取消', ok: '好的', create: '创建', required: '请输入内容' },
};

let _idSeq = 0;

/**
 * Mount once near the root. `locale` picks a built-in label set ('en' | 'zh'); `labels`
 * overrides individual strings for any other language.
 */
export function DialogHost({ children, locale = 'en', labels }) {
  const [stack, setStack] = useState([]);
  const t = useMemo(
    () => ({ ...(LABELS[locale] || LABELS.en), ...(labels || {}) }),
    [locale, labels],
  );

  const open = useCallback((spec) => new Promise((resolve) => {
    setStack((s) => [...s, { id: `dlg_${++_idSeq}`, spec, resolve }]);
  }), []);

  const close = useCallback((id, value) => {
    setStack((s) => {
      const target = s.find((d) => d.id === id);
      if (target) target.resolve(value);
      return s.filter((d) => d.id !== id);
    });
  }, []);

  const ctx = useMemo(() => ({
    confirm: (opts) => open({ kind: 'confirm', ...opts }),
    prompt: (opts) => open({ kind: 'prompt', ...opts }),
    alert: (opts) => open({ kind: 'alert', ...opts }),
    create: (opts) => open({ kind: 'create', ...opts }),
    labels: t,
  }), [open, t]);

  return (
    <DialogCtx.Provider value={ctx}>
      {children}
      {stack.length > 0 && typeof document !== 'undefined' && createPortal(
        <div className="rui-dlg-root" role="presentation">
          {stack.map((d, i) => (
            <DialogShell key={d.id} dialog={d} isTop={i === stack.length - 1} onClose={close} t={t} />
          ))}
        </div>,
        document.body,
      )}
    </DialogCtx.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogCtx);
  // Fail loudly rather than silently no-op: a confirm() that always resolves false would skip
  // the user's decision entirely, which is worse than a crash in development.
  if (!ctx) throw new Error('useDialog() called outside <DialogHost>');
  return ctx;
}

// A cancelled prompt/create yields null (no value); a cancelled confirm/alert yields false.
const cancelValue = (kind) => ((kind === 'prompt' || kind === 'create') ? null : false);

function DialogShell({ dialog, isTop, onClose, t }) {
  const { id, spec } = dialog;
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!isTop) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose(id, cancelValue(spec.kind));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, isTop, onClose, spec.kind]);

  // Focus the field if there is one, else the primary action — so Enter does the obvious thing.
  useEffect(() => {
    if (!isTop || !ref.current) return;
    const el = ref.current.querySelector('input, textarea')
      || ref.current.querySelector('.rui-dlg-primary')
      || ref.current.querySelector('button');
    el?.focus();
  }, [isTop]);

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget && isTop) onClose(id, cancelValue(spec.kind));
  };

  const done = (v) => onClose(id, v);

  return (
    <div className="rui-dlg-backdrop" onClick={onBackdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={spec.title ? titleId : undefined}
        className={`rui-dlg-card${spec.kind === 'create' ? ' is-wide' : ''}`}
      >
        {spec.kind === 'alert' && <AlertBody spec={spec} onClose={done} t={t} titleId={titleId} />}
        {spec.kind === 'confirm' && <ConfirmBody spec={spec} onClose={done} t={t} titleId={titleId} />}
        {spec.kind === 'prompt' && <PromptBody spec={spec} onClose={done} t={t} titleId={titleId} />}
        {spec.kind === 'create' && <CreateBody spec={spec} onClose={done} t={t} titleId={titleId} />}
      </div>
    </div>
  );
}

function Header({ title, variant, titleId }) {
  if (!title) return null;
  return (
    <div className={`rui-dlg-h${variant ? ` is-${variant}` : ''}`}>
      <div className="rui-dlg-title" id={titleId}>{title}</div>
    </div>
  );
}

const Footer = ({ children }) => <div className="rui-dlg-f">{children}</div>;

function AlertBody({ spec, onClose, t, titleId }) {
  return (
    <>
      <Header title={spec.title} variant={spec.variant} titleId={titleId} />
      <div className="rui-dlg-b">
        {spec.message ? <div className="rui-dlg-msg">{spec.message}</div> : null}
      </div>
      <Footer>
        <button type="button" className="rui-dlg-btn rui-dlg-primary" onClick={() => onClose(true)}>
          {spec.confirmLabel || t.ok}
        </button>
      </Footer>
    </>
  );
}

function ConfirmBody({ spec, onClose, t, titleId }) {
  const destructive = !!spec.destructive;
  return (
    <>
      <Header title={spec.title} variant={destructive ? 'destructive' : spec.variant} titleId={titleId} />
      <div className="rui-dlg-b">
        {spec.message ? <div className="rui-dlg-msg">{spec.message}</div> : null}
      </div>
      <Footer>
        <button type="button" className="rui-dlg-btn rui-dlg-secondary" onClick={() => onClose(false)}>
          {spec.cancelLabel || t.cancel}
        </button>
        <button
          type="button"
          className={`rui-dlg-btn rui-dlg-primary${destructive ? ' is-destructive' : ''}`}
          onClick={() => onClose(true)}
        >
          {spec.confirmLabel || t.confirm}
        </button>
      </Footer>
    </>
  );
}

function PromptBody({ spec, onClose, t, titleId }) {
  const [value, setValue] = useState(spec.defaultValue ?? '');
  const [err, setErr] = useState(null);
  const inputId = useId();
  const Field = spec.multiline ? 'textarea' : 'input';

  const submit = () => {
    const invalid = spec.validate?.(value);
    if (invalid) { setErr(String(invalid)); return; }
    if (spec.required !== false && !String(value).trim()) { setErr(t.required); return; }
    onClose(String(value));
  };

  return (
    <>
      <Header title={spec.title} variant={spec.variant} titleId={titleId} />
      <div className="rui-dlg-b">
        {spec.message ? <div className="rui-dlg-msg">{spec.message}</div> : null}
        {spec.label ? <label className="rui-dlg-label" htmlFor={inputId}>{spec.label}</label> : null}
        <Field
          id={inputId}
          className={`rui-dlg-input${err ? ' is-err' : ''}`}
          type={spec.multiline ? undefined : (spec.inputType || 'text')}
          rows={spec.multiline ? (spec.rows || 4) : undefined}
          value={value}
          placeholder={spec.placeholder || ''}
          onChange={(e) => { setValue(e.target.value); if (err) setErr(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !spec.multiline) { e.preventDefault(); submit(); }
          }}
          autoComplete="off"
          spellCheck="false"
        />
        {err ? <div className="rui-dlg-err">{err}</div> : null}
        {!err && spec.help ? <div className="rui-dlg-help">{spec.help}</div> : null}
      </div>
      <Footer>
        <button type="button" className="rui-dlg-btn rui-dlg-secondary" onClick={() => onClose(null)}>
          {spec.cancelLabel || t.cancel}
        </button>
        <button type="button" className="rui-dlg-btn rui-dlg-primary" onClick={submit}>
          {spec.confirmLabel || t.confirm}
        </button>
      </Footer>
    </>
  );
}

// Pick-a-type-then-name, for "New …" flows where the thing being created has variants. The
// caller supplies `types: [{ kind, label, color, icon }]`, so this stays icon-library agnostic.
// Resolves to { kind, name } or null.
function CreateBody({ spec, onClose, t, titleId }) {
  const types = spec.types || [];
  const [kind, setKind] = useState(spec.defaultKind || types[0]?.kind || '');
  const [value, setValue] = useState(spec.defaultValue ?? '');
  const [err, setErr] = useState(null);
  const inputId = useId();
  const sel = types.find((x) => x.kind === kind) || types[0] || {};

  const submit = () => {
    if (spec.required !== false && !String(value).trim()) { setErr(t.required); return; }
    onClose({ kind, name: String(value).trim() });
  };

  return (
    <>
      <Header title={spec.title} titleId={titleId} />
      <div className="rui-dlg-b">
        {types.length > 0 ? (
          <div className="rui-dlg-typegrid">
            {types.map((ty) => (
              <button
                key={ty.kind}
                type="button"
                className={`rui-dlg-type${ty.kind === kind ? ' is-on' : ''}`}
                onClick={() => setKind(ty.kind)}
              >
                {ty.icon ? (
                  <span className="rui-dlg-type-ic" style={ty.color ? { color: ty.color, background: `${ty.color}1f` } : undefined}>
                    {ty.icon}
                  </span>
                ) : null}
                <span className="rui-dlg-type-lbl">{ty.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label className="rui-dlg-label" htmlFor={inputId}>
          {spec.label || `${sel.label || 'Item'} name`}
        </label>
        <input
          id={inputId}
          className={`rui-dlg-input${err ? ' is-err' : ''}`}
          value={value}
          placeholder={spec.placeholder || 'Untitled'}
          onChange={(e) => { setValue(e.target.value); if (err) setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          autoComplete="off"
          spellCheck="false"
        />
        {err ? <div className="rui-dlg-err">{err}</div> : null}
      </div>
      <Footer>
        <button type="button" className="rui-dlg-btn rui-dlg-secondary" onClick={() => onClose(null)}>
          {spec.cancelLabel || t.cancel}
        </button>
        <button type="button" className="rui-dlg-btn rui-dlg-primary" onClick={submit}>
          {spec.confirmLabel || t.create}
        </button>
      </Footer>
    </>
  );
}
