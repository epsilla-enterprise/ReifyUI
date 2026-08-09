// SlideView — render ONE slide from the deck JSON onto the fixed 1920×1080
// stage, then scale that stage to fit the container (the convergent pattern
// from OpenDesign / frontend-slides). Theme tokens become CSS vars so every
// element reads them; elements are absolutely positioned by their `frame`.
// The SAME component renders the editor canvas, the thumbnails, and the
// presentation view — one renderer, four surfaces.
import { useEffect, useRef, useState } from 'react';
import { ElementView } from './elements.jsx';

const STAGE_W = 1920;
const STAGE_H = 1080;

/** deck.theme → CSS custom properties consumed by the element renderers. */
export function themeVars(theme) {
  const p = (theme && theme.palette) || {};
  const f = (theme && theme.fonts) || {};
  return {
    '--sl-bg': p.bg || '#FFFFFF',
    '--sl-surface': p.surface || '#F7F8FB',
    '--sl-ink': p.ink || '#111827',
    '--sl-mute': p.mute || '#6B7280',
    '--sl-brand': p.brand || '#4F46E5',
    '--sl-accent': p.accent || '#06B6D4',
    '--sl-head': f.head || 'Inter, system-ui, sans-serif',
    '--sl-body': f.body || 'Inter, system-ui, sans-serif',
    '--sl-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
}

function background(bg, theme) {
  if (!bg) return { background: 'var(--sl-bg)' };
  if (bg.color) return { background: bg.color };
  if (bg.gradient) return { background: bg.gradient };
  if (bg.image) return { backgroundImage: `url(${bg.image})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: 'var(--sl-bg)' };
}

/** The un-scaled 1920×1080 stage. Used directly for export/screenshot; wrapped
 *  by SlideView for on-screen scaling. */
export function SlideStage({ slide, theme, resolveSrc, selectedId, onSelectElement }) {
  return (
    <div className="sl-stage"
         style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden',
                  fontFamily: 'var(--sl-body)', ...themeVars(theme), ...background(slide?.background, theme) }}>
      {(slide?.elements || []).map((el) => {
        const fr = el.frame || {};
        const sel = onSelectElement && el.id === selectedId;
        return (
          <div key={el.id}
               className={'sl-el' + (sel ? ' sl-el-selected' : '')}
               onMouseDown={onSelectElement ? (e) => { e.stopPropagation(); onSelectElement(el.id); } : undefined}
               style={{ position: 'absolute',
                        left: fr.x || 0, top: fr.y || 0,
                        width: fr.w ?? 400, height: fr.h ?? 100,
                        transform: fr.rotation ? `rotate(${fr.rotation}deg)` : undefined,
                        cursor: onSelectElement ? 'pointer' : 'default' }}>
            <ElementView el={el} resolveSrc={resolveSrc} />
          </div>
        );
      })}
    </div>
  );
}

/** Scales the fixed stage to fill its parent while preserving 16:9. */
export function SlideView({ slide, theme, resolveSrc, selectedId, onSelectElement, onDeselect, bare }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="sl-fit"
         onMouseDown={onDeselect}
         style={{ position: 'relative', width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: STAGE_W * scale, height: STAGE_H * scale, position: 'relative',
                    boxShadow: bare ? 'none' : '0 8px 40px -8px rgba(15,23,42,.25)',
                    borderRadius: bare ? 0 : 6 * scale, overflow: 'hidden',
                    flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <SlideStage slide={slide} theme={theme} resolveSrc={resolveSrc}
                      selectedId={selectedId} onSelectElement={onSelectElement} />
        </div>
      </div>
    </div>
  );
}
