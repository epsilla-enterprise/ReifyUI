// Element renderers — one per element type in the deck model
// (docs/slides-architecture.md). Each renders the element's `content` inside a
// frame that SlideView has already absolutely-positioned + sized on the fixed
// 1920×1080 stage, so these components fill 100% of their box and never worry
// about placement. Charts (ECharts) and flowcharts (Mermaid) load lazily and
// render to SVG so they stay crisp in the canvas, thumbnails, and PDF.
import { useEffect, useRef, useState } from 'react';

// Rich-text runs → spans with marks. role drives default sizing (the stage is
// 1920 wide, so these px sizes read correctly once the stage is scaled).
const ROLE_STYLE = {
  title:    { fontSize: 72, fontWeight: 800, lineHeight: 1.1,  fontFamily: 'var(--sl-head)' },
  subtitle: { fontSize: 36, fontWeight: 500, lineHeight: 1.25, color: 'var(--sl-mute)' },
  body:     { fontSize: 30, fontWeight: 400, lineHeight: 1.4 },
  bullets:  { fontSize: 30, fontWeight: 400, lineHeight: 1.5 },
  caption:  { fontSize: 22, fontWeight: 400, lineHeight: 1.3, color: 'var(--sl-mute)' },
};

function runSpans(runs) {
  return (runs || []).map((r, i) => {
    const marks = new Set(r.marks || []);
    let node = r.text;
    const style = {};
    if (marks.has('bold')) style.fontWeight = 700;
    if (marks.has('italic')) style.fontStyle = 'italic';
    if (marks.has('underline')) style.textDecoration = 'underline';
    if (marks.has('code')) { style.fontFamily = 'var(--sl-mono, monospace)'; style.background = 'rgba(0,0,0,.06)'; style.padding = '0 6px'; style.borderRadius = 4; }
    const link = (r.marks || []).find((m) => typeof m === 'object' && m.link);
    if (link) return <a key={i} href={link.link} style={{ ...style, color: 'var(--sl-brand)' }}>{node}</a>;
    return <span key={i} style={style}>{node}</span>;
  });
}

function TextEl({ el }) {
  const role = el.content?.role || 'body';
  const base = ROLE_STYLE[role] || ROLE_STYLE.body;
  const align = el.style?.align || (role === 'title' || role === 'subtitle' ? 'left' : 'left');
  const runs = el.content?.runs || [];
  const style = { ...base, ...(el.style || {}), textAlign: align, color: el.style?.color || base.color || 'var(--sl-ink)',
                  width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                  justifyContent: el.style?.valign === 'center' ? 'center' : 'flex-start', overflow: 'visible' };
  if (role === 'bullets') {
    return (
      <ul style={{ ...style, margin: 0, paddingLeft: 40, display: 'block' }}>
        {runs.map((r, i) => <li key={i} style={{ marginBottom: 8 }}>{runSpans([r])}</li>)}
      </ul>
    );
  }
  return <div style={style}>{runSpans(runs)}</div>;
}

function ImageEl({ el, resolveSrc }) {
  const src = resolveSrc ? resolveSrc(el.content?.src) : el.content?.src;
  if (!src) return <div style={ph()}>image</div>;
  return <img src={src} alt={el.content?.alt || ''}
              style={{ width: '100%', height: '100%', objectFit: el.content?.fit || 'cover',
                       borderRadius: el.style?.radius ?? 0, display: 'block' }} />;
}

function ChartEl({ el }) {
  const ref = useRef(null);
  useEffect(() => {
    let chart = null; let dead = false;
    (async () => {
      try {
        const echarts = (await import('echarts')).default || (await import('echarts'));
        if (dead || !ref.current) return;
        chart = echarts.init(ref.current, null, { renderer: 'svg' });
        if (el.content?.spec) chart.setOption(el.content.spec);
      } catch { /* echarts missing — leave the box */ }
    })();
    return () => { dead = true; try { chart && chart.dispose(); } catch {} };
  }, [JSON.stringify(el.content?.spec)]);
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function FlowchartEl({ el }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      const src = el.content?.mermaid;
      if (!src) return;
      try {
        const mermaid = (await import('mermaid')).default || (await import('mermaid'));
        mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        const id = 'mmd_' + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, src);
        if (!dead) setSvg(svg);
      } catch { if (!dead) setSvg(''); }
    })();
    return () => { dead = true; };
  }, [el.content?.mermaid]);
  return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: svg || '' }} />;
}

function ShapeEl({ el }) {
  const kind = el.content?.kind || 'rect';
  const fill = el.style?.fill || 'var(--sl-brand)';
  const stroke = el.style?.stroke || 'transparent';
  const sw = el.style?.strokeWidth ?? 0;
  if (kind === 'line' || kind === 'arrow') {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <defs><marker id="ah" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={stroke !== 'transparent' ? stroke : fill} /></marker></defs>
        <line x1="2" y1="50" x2="98" y2="50" stroke={stroke !== 'transparent' ? stroke : fill}
              strokeWidth={sw || 3} markerEnd={kind === 'arrow' ? 'url(#ah)' : undefined} />
      </svg>
    );
  }
  const radius = kind === 'ellipse' ? '50%' : (el.style?.radius ?? 8);
  return <div style={{ width: '100%', height: '100%', background: fill, borderRadius: radius,
                       border: sw ? `${sw}px solid ${stroke}` : undefined }} />;
}

function TableEl({ el }) {
  const cols = el.content?.columns || [];
  const rows = el.content?.rows || [];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 24, color: 'var(--sl-ink)' }}>
      {cols.length > 0 && (
        <thead><tr>{cols.map((c, i) => (
          <th key={i} style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '2px solid var(--sl-brand)', fontWeight: 700 }}>{c}</th>
        ))}</tr></thead>
      )}
      <tbody>{rows.map((r, i) => (
        <tr key={i}>{(r || []).map((cell, j) => (
          <td key={j} style={{ padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,.08)' }}>{cell}</td>
        ))}</tr>
      ))}</tbody>
    </table>
  );
}

function CodeEl({ el }) {
  const ref = useRef(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const hljs = (await import('highlight.js/lib/common')).default;
        if (dead || !ref.current) return;
        ref.current.textContent = el.content?.source || '';
        hljs.highlightElement(ref.current);
      } catch { if (ref.current) ref.current.textContent = el.content?.source || ''; }
    })();
    return () => { dead = true; };
  }, [el.content?.source, el.content?.lang]);
  return (
    <pre style={{ width: '100%', height: '100%', margin: 0, overflow: 'auto', borderRadius: 8,
                  fontSize: 22, lineHeight: 1.5, background: '#0B1020' }}>
      <code ref={ref} className={`language-${el.content?.lang || 'plaintext'}`} />
    </pre>
  );
}

function EmbedEl({ el }) {
  return <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}
              dangerouslySetInnerHTML={{ __html: el.content?.html || '' }} />;
}

function ph() {
  return { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
           background: 'var(--sl-surface)', color: 'var(--sl-mute)', fontSize: 20, borderRadius: 8 };
}

const RENDERERS = {
  text: TextEl, image: ImageEl, chart: ChartEl, flowchart: FlowchartEl,
  shape: ShapeEl, table: TableEl, code: CodeEl, embed: EmbedEl,
};

export function ElementView({ el, resolveSrc }) {
  const R = RENDERERS[el.type];
  if (!R) return <div style={ph()}>{el.type}</div>;
  return <R el={el} resolveSrc={resolveSrc} />;
}
