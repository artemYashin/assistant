import { useEffect } from "react";
import { createVoiceShortcut } from "../lib/voice-shortcut.js";
export function useChatToggleShortcut(binding: string, press: string, toggle: () => void) {
  useEffect(() => {
    const match = createVoiceShortcut([binding], press === "single" ? [binding] : []);
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || target?.closest("[data-voice-binding]") || document.querySelector("dialog[open]")) return;
      const editing = [target, document.activeElement].some(element => element && (element.closest("input, textarea, select, [role='textbox'], [role='combobox']") || (element instanceof HTMLElement && element.isContentEditable)));
      if (!match(event, performance.now(), editing)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [binding, press, toggle]);
}
