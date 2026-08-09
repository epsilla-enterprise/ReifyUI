// Shared deck renderer + presentation (the Slides product's canvas — and,
// like SheetGrid, embeddable anywhere: studio Spaces can mount a deck later).
// IMPORT VIA SUBPATH ONLY ('@ui-core/src/slides/index.js'), NOT the ui-core
// root index: echarts/mermaid/highlight.js load lazily inside these
// components, and a root re-export would force every ui-core consumer (CG,
// Flowness) to resolve those deps at build time. See docs/slides-architecture.md.
export { SlideView, SlideStage, themeVars } from './SlideView.jsx';
export { ElementView } from './elements.jsx';
export { EditorCanvas } from './Editor.jsx';
export { Presentation } from './Presentation.jsx';
