import { html, useState, useEffect } from "./h.js";
import { Icon } from "./icons.js";
import { Modal } from "./kit.js";
import { THEMES, themeSettings, setThemeSettings, chooseTheme, activeTheme, onThemeChange, toggleMode, resolvedMode } from "../themes.js";

export function useTheme() {
  const [state, setState] = useState(() => ({ s: themeSettings(), theme: activeTheme() }));
  useEffect(() => onThemeChange((s, theme) => setState({ s, theme })), []);
  return state;
}

export function ModeToggle() {
  const { theme } = useTheme();
  const dark = theme.mode === "dark";
  return html`<button
    class="icon-btn mode-toggle"
    onClick=${toggleMode}
    title=${dark ? "Switch to light" : "Switch to dark"}
    aria-label="Toggle light and dark"
  >
    <span class=${"mode-icons" + (dark ? " is-dark" : "")}>
      <${Icon} name="sun" />
      <${Icon} name="moon" />
    </span>
  </button>`;
}

function Swatch({ theme, active, onPick }) {
  const [bg, surface, text, accent] = theme.swatch;
  return html`<button class=${"swatch" + (active ? " is-active" : "")} onClick=${() => onPick(theme.id)} aria-pressed=${active}>
    <span class="swatch-art" style=${{ background: bg }}>
      <span class="swatch-page" style=${{ background: surface, borderColor: text + "22" }}>
        <i style=${{ background: accent, width: "46%" }} />
        <i style=${{ background: text, opacity: 0.5, width: "78%" }} />
        <i style=${{ background: text, opacity: 0.3, width: "62%" }} />
        <i style=${{ background: text, opacity: 0.3, width: "70%" }} />
      </span>
      <span class="swatch-dot" style=${{ background: accent }} />
    </span>
    <span class="swatch-name">${theme.name}${active && html`<${Icon} name="check" size=${13} />`}</span>
  </button>`;
}

export function ThemePicker({ open, onClose }) {
  const { s } = useTheme();
  const mode = resolvedMode(s);
  const section = (m, label) => html`<div class="theme-group">
    <div class="kicker">${label}${mode === m && html`<span class="kicker-live">in use</span>`}</div>
    <div class="swatch-grid">
      ${THEMES.filter((t) => t.mode === m).map((t) => html`<${Swatch} key=${t.id} theme=${t} active=${s[m] === t.id} onPick=${chooseTheme} />`)}
    </div>
  </div>`;
  return html`<${Modal} open=${open} onClose=${onClose} title="Appearance" subtitle="Pick a light and a dark theme. Unison switches between them." icon="palette" width=${640}>
    <div class="segmented" role="radiogroup" aria-label="Mode">
      ${[
        ["system", "monitor", "System"],
        ["light", "sun", "Light"],
        ["dark", "moon", "Dark"],
      ].map(
        ([id, icon, label]) => html`<button
          role="radio"
          aria-checked=${s.mode === id}
          class=${s.mode === id ? "is-on" : ""}
          onClick=${() => setThemeSettings({ mode: id })}
        >
          <${Icon} name=${icon} size=${14} /> ${label}
        </button>`,
      )}
    </div>
    ${section("light", "Light themes")} ${section("dark", "Dark themes")}
  <//>`;
}
