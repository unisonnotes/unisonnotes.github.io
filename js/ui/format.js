// Document-level type settings shared by the woven page, the editable doc and print.
export const FONTS = [
  { id: "sans", name: "Geist", css: '"Geist", ui-sans-serif, system-ui, sans-serif' },
  { id: "serif", name: "Charter", css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  { id: "times", name: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { id: "georgia", name: "Georgia", css: "Georgia, serif" },
  { id: "humanist", name: "Calibri", css: 'Calibri, Carlito, "Segoe UI", Ubuntu, sans-serif' },
  { id: "arial", name: "Arial", css: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
  { id: "mono", name: "Geist Mono", css: '"Geist Mono", ui-monospace, monospace' },
];

export const SPACINGS = [
  [1, "Single"],
  [1.15, "1.15"],
  [1.5, "1.5"],
  [2, "Double"],
];

export const DEFAULT_STYLE = { font: "sans", size: 15, spacing: 1.5 };

export const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

/** CSS custom properties for a doc's style; the page and editor read them. */
export function styleVars(style = {}) {
  const s = { ...DEFAULT_STYLE, ...style };
  return { "--doc-font": fontCss(s.font), "--doc-size": s.size + "px", "--doc-spacing": String(s.spacing) };
}
