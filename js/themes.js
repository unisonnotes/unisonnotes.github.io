// Theme registry. Colors live in css/tokens.css; this file only knows ids, names and
// preview swatches, plus which theme is active. Mirrors Tern's model: a mode
// (system / light / dark) and a separately chosen theme for each mode.

export const THEMES = [
  { id: "light", name: "Light", mode: "light", swatch: ["#f4f5f7", "#ffffff", "#16181d", "#3461f2"] },
  { id: "paper", name: "Paper", mode: "light", swatch: ["#f1ece2", "#fffdf8", "#2b2620", "#b5652a"] },
  { id: "github-light", name: "GitHub", mode: "light", swatch: ["#f6f8fa", "#ffffff", "#1f2328", "#0969da"] },
  { id: "lavender", name: "Lavender", mode: "light", swatch: ["#f3f0fa", "#ffffff", "#231a3d", "#7e57c2"] },
  { id: "latte", name: "Latte", mode: "light", swatch: ["#e6e9ef", "#fbfbfd", "#4c4f69", "#8839ef"] },
  { id: "dark", name: "Dark", mode: "dark", swatch: ["#0a0c10", "#12151a", "#e9ebee", "#6c95ff"] },
  { id: "starfall", name: "Starfall", mode: "dark", swatch: ["#0b0c10", "#121620", "#ecebe6", "#f2c45a"] },
  { id: "tokyo-night", name: "Tokyo Night", mode: "dark", swatch: ["#16161e", "#1a1b26", "#c0caf5", "#7aa2f7"] },
  { id: "rose-pine", name: "Rosé Pine", mode: "dark", swatch: ["#15131f", "#1f1d2e", "#e0def4", "#ebbcba"] },
  { id: "nord", name: "Nord", mode: "dark", swatch: ["#262b35", "#2e3440", "#eceff4", "#88c0d0"] },
  { id: "mocha", name: "Mocha", mode: "dark", swatch: ["#11111b", "#1e1e2e", "#cdd6f4", "#cba6f7"] },
];

const KEY = "unison.theme";
const DEFAULTS = { mode: "system", light: "light", dark: "dark" };
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();

export function themeSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function resolvedMode(s = themeSettings()) {
  return s.mode === "system" ? (media.matches ? "dark" : "light") : s.mode;
}

export function activeTheme(s = themeSettings()) {
  const mode = resolvedMode(s);
  const id = s[mode];
  return THEMES.find((t) => t.id === id && t.mode === mode) || THEMES.find((t) => t.id === mode);
}

function apply() {
  const s = themeSettings();
  const theme = activeTheme(s);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.mode = theme.mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.swatch[0];
  listeners.forEach((fn) => fn(s, theme));
}

export function setThemeSettings(patch) {
  localStorage.setItem(KEY, JSON.stringify({ ...themeSettings(), ...patch }));
  apply();
}

/** Pick a theme; also switches mode to that theme's mode unless following the system. */
export function chooseTheme(id) {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) return;
  const s = themeSettings();
  const patch = { [theme.mode]: id };
  if (s.mode !== "system") patch.mode = theme.mode;
  else if (resolvedMode(s) !== theme.mode) patch.mode = theme.mode;
  setThemeSettings(patch);
}

export function toggleMode() {
  setThemeSettings({ mode: resolvedMode() === "dark" ? "light" : "dark" });
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media.addEventListener("change", () => {
  if (themeSettings().mode === "system") apply();
});

apply();
