// Form primitives: a labelled field, and the three controls that go in one.
//
// Every surface in this stack had been hand-rolling `<label>Text<select className="…-input">`,
// which is why the same form looks different in each of them — different label weight, different
// focus ring, a hint that is a paragraph in one place and a caption in another. These are the
// smallest components that make that impossible.
//
// A Field owns the label, the hint and the error, so a control never has to render its own and
// they never disagree about spacing. Passing `error` replaces the hint rather than stacking on it:
// once something is wrong, the thing to read is what is wrong.
import { useId } from 'react';
import { Chevron } from './icons.jsx';

export function Field({ label, hint, error, htmlFor, required, children, className = '' }) {
  return (
    <div className={'uic-field' + (error ? ' is-error' : '') + (className ? ' ' + className : '')}>
      {label && (
        <label className="uic-field-label" htmlFor={htmlFor}>
          {label}{required && <span className="uic-field-req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="uic-field-err">{error}</p>
             : hint ? <p className="uic-field-hint">{hint}</p> : null}
    </div>
  );
}

/** A field whose control is generated for it — the common case, wired for accessibility. */
function withField(Control) {
  return function Fielded({ label, hint, error, required, id, className, ...rest }) {
    const auto = useId();
    const inputId = id || auto;
    return (
      <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={className}>
        <Control id={inputId} invalid={!!error} required={required} {...rest} />
      </Field>
    );
  };
}

function BareInput({ invalid, ...rest }) {
  return <input className={'uic-input' + (invalid ? ' is-error' : '')} aria-invalid={invalid || undefined} {...rest} />;
}

function BareTextarea({ invalid, rows = 4, ...rest }) {
  return <textarea className={'uic-input uic-textarea' + (invalid ? ' is-error' : '')}
                   rows={rows} aria-invalid={invalid || undefined} {...rest} />;
}

/** Options are [{value, label, disabled}] or plain strings. The chevron is drawn rather than left
 *  to the platform, because the platform's differs per OS and the rest of this form does not. */
function BareSelect({ invalid, options = [], placeholder, ...rest }) {
  return (
    <span className="uic-select-wrap">
      <select className={'uic-input uic-select' + (invalid ? ' is-error' : '')}
              aria-invalid={invalid || undefined} {...rest}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>;
        })}
      </select>
      <span className="uic-select-chev" aria-hidden="true"><Chevron dir="down" size={14} /></span>
    </span>
  );
}

export const Input = withField(BareInput);
export const Textarea = withField(BareTextarea);
export const Select = withField(BareSelect);

/** The row a form ends with. `align` is 'end' by default because the primary action belongs where
 *  the eye leaves the last control. */
export function FormActions({ children, align = 'end', className = '' }) {
  return <div className={`uic-form-actions is-${align}${className ? ' ' + className : ''}`}>{children}</div>;
}

/** The two buttons that row almost always holds, so their order stops being a per-form decision. */
export function Button({ variant = 'default', size = 'md', type = 'button', className = '', ...rest }) {
  return <button type={type} className={`uic-btn is-${variant} is-${size}${className ? ' ' + className : ''}`} {...rest} />;
}
