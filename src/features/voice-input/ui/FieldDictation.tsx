import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { VoiceShortcut } from "../index.js";

export function requestFieldDictation(target: HTMLTextAreaElement | HTMLInputElement | null) {
  if (target) window.dispatchEvent(new CustomEvent("orbit:dictate-field", { detail: target }));
}

function captureField(target: Element | null): ((text: string) => void) | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target.disabled || target.readOnly || (target instanceof HTMLInputElement && !["text", "search", "url", "tel", "email"].includes(target.type))) return null;
    const original = target.value;
    const start = target.selectionStart ?? target.value.length, end = target.selectionEnd ?? start;
    return text => {
      if (!target.isConnected || target.disabled || target.readOnly) return;
      if (target.value !== original) throw new Error("Поле изменилось во время записи. Повторите диктовку.");
      const value = target.value;
      const next = value.slice(0, start) + text + value.slice(end);
      if (target.maxLength >= 0 && next.length > target.maxLength) throw new Error(`Текст превышает лимит поля (${target.maxLength} символов). Запишите короче.`);
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, next);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => {
        target.focus();
        if (target.selectionStart !== null) target.setSelectionRange(start + text.length, start + text.length);
      });
    };
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    return text => {
      if (!target.isConnected || !target.isContentEditable || !target.contains(range.commonAncestorContainer)) return;
      target.focus();
      range.deleteContents();
      const node = document.createTextNode(text); range.insertNode(node);
      range.setStartAfter(node); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };
  }
  return null;
}

export function FieldDictation({ binding, press }: { binding: string; press: string }) {
  const insert = useRef<((text: string) => void) | null>(null);
  const busy = useRef(false);
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    const open = (event: Event) => {
      if (busy.current || document.querySelector(".voice-shortcut-dialog[open]")) return;
      insert.current = captureField((event as CustomEvent<Element>).detail);
      if (insert.current) setAutoStart(true);
    };
    window.addEventListener("orbit:dictate-field", open);
    return () => window.removeEventListener("orbit:dictate-field", open);
  }, []);
  return <VoiceShortcut fieldMode enabled title="Распознанный текст можно отредактировать" currentKey={binding} currentPress={press} newKey=""
    onOpen={() => {
      if (document.querySelector(".voice-shortcut-dialog[open]")) return false;
      insert.current = captureField(document.activeElement);
      return !!insert.current;
    }} onNewChat={() => {}} autoStart={autoStart} onAutoStarted={() => setAutoStart(false)}
    onBusy={value => { busy.current = value; }} onText={text => { insert.current?.(text); insert.current = null; }} />;
}

/** Composer dictation shares the voice popup but only edits the captured draft. */
export function ComposerDictation({ target, enabled, onBusy }: {
  target: React.RefObject<HTMLTextAreaElement | null>; enabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const insert = useRef<((text: string) => void) | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [busy, setBusy] = useState(false);
  return <>
    <button type="button" className="mic-button" aria-label="Голосовой ввод" title="Продиктовать текст в поле сообщения без отправки"
      disabled={!enabled || busy || autoStart} onMouseDown={event => event.preventDefault()}
      onClick={() => {
        if (document.querySelector(".voice-shortcut-dialog[open]")) return;
        target.current?.focus();
        insert.current = captureField(target.current);
        if (insert.current) setAutoStart(true);
      }}><Mic size={18} /></button>
    <VoiceShortcut fieldMode enabled={enabled} title="Сообщение ассистенту · без отправки" currentKey="" newKey=""
      onOpen={() => false} onNewChat={() => {}} autoStart={autoStart} onAutoStarted={() => setAutoStart(false)}
      onBusy={value => { setBusy(value); onBusy(value); }} onText={text => { insert.current?.(text); insert.current = null; }} />
  </>;
}
