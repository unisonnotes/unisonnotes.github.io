import { html, useState, useRef, useLayoutEffect } from "./h.js";
import { Kbd } from "./kit.js";

/** Inline textarea for editing (or suggesting) a note. Enter saves, Esc cancels. */
export function EditBox({ initial, onSave, onCancel, label = "save" }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return html`<div class="edit-box" onClick=${(e) => e.stopPropagation()}>
    <textarea
      ref=${ref}
      value=${value}
      rows="1"
      onInput=${(e) => setValue(e.target.value)}
      onKeyDown=${(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          value.trim() && onSave(value.trim());
        } else if (e.key === "Escape") onCancel();
      }}
    />
    <div class="edit-actions mono"><span><${Kbd}>↵<//> ${label} · <${Kbd}>Esc<//> cancel</span></div>
  </div>`;
}
