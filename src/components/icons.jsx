// Line-glyph icon set for the conversational surface (16-17px, currentColor stroke) —
// extracted verbatim from HarnessRouter's workbench. Dependency-free (inline SVG only).
import React from 'react';

export function Svg({ children, s = 16 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
}

export function Chevron({ dir, size = 16 }) {
  const d = dir === 'left' ? 'M15 18l-6-6 6-6' : dir === 'right' ? 'M9 18l6-6-6-6' : 'M6 9l6 6 6-6';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

// ── tool-step icons (activity timeline) ──
export const IcTool = () => <Svg s={17}><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.3 2.3-1.7-1.7 2.3-2.3a4 4 0 0 0-1.6 0Z" /></Svg>;
export const IcPlug = () => <Svg s={17}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></Svg>;
export const IcSkill = () => <Svg s={17}><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></Svg>;
export const IcTerminal = () => <Svg s={17}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></Svg>;
export const IcDoc = () => <Svg s={17}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></Svg>;
export const IcList = () => <Svg s={17}><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>;
export const IcGlobe = () => <Svg s={17}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></Svg>;
export const IcSearch = () => <Svg s={17}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>;
export const IcScroll = () => <Svg s={17}><path d="M6 3h10a2 2 0 0 1 2 2v12a3 3 0 0 0 3 3H8a2 2 0 0 1-2-2V3z" /><path d="M6 3a2 2 0 0 0-2 2v2h2M10 8h6M10 12h6" /></Svg>;
export const IcSpawn = () => <Svg s={17}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M6 9v3a3 3 0 0 0 3 3h6" /></Svg>;
export const IcCheck = () => <Svg s={17}><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IcThink = () => <Svg s={16}><path d="M9.5 2a5.5 5.5 0 0 0-3 10.1V15a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-2.9A5.5 5.5 0 0 0 9.5 2zM9 20h4M10 22h2" /></Svg>;
export const IcSend = () => <Svg s={16}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></Svg>;

// ── chrome glyphs (chat panel, chips, search) ──
// The package draws its own so a consumer never inherits an icon-library dependency from a
// component: four apps pull the same four glyphs out of lucide today purely to hand them to a
// panel that could have drawn them itself.
export const IcX = ({ size = 14 }) => <Svg s={size}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const IcMic = ({ size = 15 }) => <Svg s={size}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" /></Svg>;
export const IcPaperclip = ({ size = 16 }) => <Svg s={size}><path d="M21.4 11.1 12.2 20.3a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5" /></Svg>;
export const IcPanelRight = ({ size = 17 }) => <Svg s={size}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Svg>;
export const IcDownload = ({ size = 16 }) => <Svg s={size}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></Svg>;
export const IcEye = ({ size = 15 }) => <Svg s={size}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Svg>;
