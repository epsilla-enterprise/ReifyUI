// Skeleton — a pulsing placeholder shaped like the eventual content so data
// arriving causes no layout shift (styles in panes.css; respects
// prefers-reduced-motion). Hosts compose their own layouts from it.
import React from 'react';

export function Skeleton({ variant = 'line', w, h, radius, className = '', style }) {
  const cls = `sk sk-${variant}${className ? ' ' + className : ''}`;
  const s = { ...(style || {}) };
  if (w != null) s.width = typeof w === 'number' ? `${w}px` : w;
  if (h != null) s.height = typeof h === 'number' ? `${h}px` : h;
  if (radius != null) s.borderRadius = typeof radius === 'number' ? `${radius}px` : radius;
  return <span className={cls} style={s} aria-hidden="true" />;
}
