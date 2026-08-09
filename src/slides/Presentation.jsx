// Presentation — fullscreen deck playback, modeled on how people actually
// present (Google Slides): entering triggers REAL browser fullscreen, the
// slide fills the screen edge-to-edge on black, everything is keyboard-driven
// (←/→/Space/PgUp/PgDn/Home/End, Esc exits), click advances, and the only
// chrome is a floating control pill that appears on mouse move and fades away
// with the cursor after a moment of stillness.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideView } from './SlideView.jsx';

export function Presentation({ deck, resolveSrc, startIndex = 0, onExit }) {
  const slides = deck?.slides || [];
  const rootRef = useRef(null);
  const idleRef = useRef(null);
  const iRef = useRef(Math.min(startIndex, Math.max(0, slides.length - 1)));
  const [i, setI] = useState(iRef.current);
  const [awake, setAwake] = useState(true);

  const go = useCallback((n) => {
    const next = Math.max(0, Math.min(slides.length - 1, n));
    iRef.current = next;
    setI(next);
  }, [slides.length]);

  // Real fullscreen on enter; leaving fullscreen (Esc) exits the show.
  useEffect(() => {
    const el = rootRef.current;
    el?.requestFullscreen?.().catch(() => {});
    const onFsChange = () => { if (!document.fullscreenElement) onExit && onExit(); };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(iRef.current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(iRef.current - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(slides.length - 1);
      else if (e.key === 'Escape') onExit && onExit();   // also fires via fullscreenchange
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, slides.length, onExit]);

  // Wake the chrome on movement; let it sleep (with the cursor) after 2s still.
  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setAwake(false), 2000);
  }, []);
  useEffect(() => { wake(); return () => window.clearTimeout(idleRef.current); }, [wake]);

  return (
    <div ref={rootRef} className="sl-present" onMouseMove={wake}
         onClick={() => go(iRef.current + 1)}
         style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000',
                  cursor: awake ? 'default' : 'none' }}>
      <SlideView slide={slides[i]} theme={deck?.theme} resolveSrc={resolveSrc} bare />
      <div className={'sl-present-pill' + (awake ? ' awake' : '')}
           onClick={(e) => e.stopPropagation()}>
        <button className="sl-pp-btn" aria-label="Previous slide" onClick={() => go(i - 1)} disabled={i === 0}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="sl-pp-count">{i + 1} / {slides.length}</span>
        <button className="sl-pp-btn" aria-label="Next slide" onClick={() => go(i + 1)} disabled={i >= slides.length - 1}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <span className="sl-pp-sep" />
        <button className="sl-pp-btn" aria-label="Exit presentation" onClick={onExit}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  );
}
