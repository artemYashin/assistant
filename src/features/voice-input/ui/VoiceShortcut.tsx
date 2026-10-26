import { keepVoiceOverlayOnTop } from "../lib/voice-overlay.js";
import { voiceBinding } from "../../../../server/voice-binding.js";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, X, Square, LoaderCircle, AlertCircle } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { createVoiceShortcut, voiceRecordingIsLongEnough, shortcutTextWasInserted } from "../lib/voice-shortcut.js";

function captureTyping(target: Element | null, key: string): (() => void) | undefined {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const before = target.value, start = target.selectionStart, end = target.selectionEnd;
    if (start === null || end === null) return;
    return () => {
      if (!target.isConnected || !shortcutTextWasInserted(before, target.value, key, start, end)) return;
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, before);
      target.setSelectionRange(start, end);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };
  }
  const editor = target?.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  const prefix = range.cloneRange(); prefix.selectNodeContents(editor); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length, end = start + range.toString().length;
  const before = editor.textContent || "", html = editor.innerHTML;
  return () => {
    if (!editor.isConnected || !shortcutTextWasInserted(before, editor.textContent || "", key, start, end)) return;
    editor.innerHTML = html;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
}
type Phase = "idle" | "requesting" | "recording" | "transcribing" | "error" | "blocked";
export function VoiceShortcut({ enabled, unavailableReason, onText, onBusy, title, onNewChat, onOpen, currentKey = "KeyM", newKey = "KeyN", currentPress = "double", newPress = "double", autoStart = false, onAutoStarted, fieldMode = false }: {
  unavailableReason?: string;
  fieldMode?: boolean;
  currentPress?: string; newPress?: string;
  onOpen: () => void | boolean; currentKey?: string; newKey?: string;
  onNewChat: () => void; autoStart?: boolean; onAutoStarted: () => void;
  enabled: boolean; onText: (text: string) => void; onBusy: (busy: boolean) => void; title: string;
}) {
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>("idle"), [error, setError] = useState(""), [seconds, setSeconds] = useState(0);
  const phaseRef = useRef<Phase>("idle"), attempt = useRef(0), started = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcription = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  useEffect(() => { document.body.append(host); return () => host.remove(); }, [host]);
  const latest = useRef({ enabled, unavailableReason, onText, onBusy, onNewChat, onOpen });
  latest.current = { enabled, unavailableReason, onText, onBusy, onNewChat, onOpen };
  function change(next: Phase) {
    phaseRef.current = next; setPhase(next);
    latest.current.onBusy(next !== "idle" && next !== "blocked");
  }
  function release() {
    clearTimeout(deadline.current);
    transcription.current?.abort(); transcription.current = null;
    const rec = recorder.current; recorder.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }
  function cancel() {
    attempt.current++; release(); setError(""); change("idle");
  }
  function fail(message: string) {
    attempt.current++; release(); setError(message); change("error");
  }
  async function start() {
    if (!latest.current.enabled) return;
    const id = ++attempt.current;
    setError(""); setSeconds(0); change("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Микрофон доступен на localhost или HTTPS в браузере с поддержкой записи.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== attempt.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : {});
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onerror = () => { if (id === attempt.current) fail("Не удалось записать голос. Проверьте микрофон и повторите."); };
      rec.onstop = async () => {
        media.getTracks().forEach(track => track.stop());
        if (id !== attempt.current) return;
        clearTimeout(deadline.current); recorder.current = null; stream.current = null;
        if (phaseRef.current !== "transcribing") { fail("Запись прервалась. Сообщение не отправлено."); return; }
        try {
          const controller = new AbortController(); transcription.current = controller;
          const form = new FormData();
          form.append("audio", new Blob(chunks, { type: rec.mimeType }), "voice");
          const result = await api<{ text: string }>("/voice/transcribe", "POST", form, controller.signal);
          if (id !== attempt.current) return;
          const text = result.text?.trim();
          if (!text) throw new Error("Речь не распознана. Попробуйте ещё раз.");
          if (text.length > 16000) throw new Error("Запись слишком длинная для сообщения. Повторите короче.");
          if (!latest.current.enabled) throw new Error("Чат сейчас занят. Сообщение не отправлено.");
          transcription.current = null;
          change("idle");
          latest.current.onText(text);
        } catch (e: any) { if (id === attempt.current) fail(e.message || "Не удалось распознать речь."); }
      };
      rec.start();
      started.current = performance.now(); change("recording");
      deadline.current = setTimeout(() => {
        if (id === attempt.current) fail("Достигнут предел записи — 2 минуты. Сообщение не отправлено. Запишите более короткий запрос.");
      }, 120000);
    } catch (e: any) {
      if (id === attempt.current) fail(e.name === "NotAllowedError" ? "Разрешите доступ к микрофону в настройках браузера." : e.message || "Не удалось включить микрофон.");
    }
  }
  function finish(explicitSend = false) {
    if (phaseRef.current === "requesting") { cancel(); return; }
    if (phaseRef.current !== "recording") return;
    if (!explicitSend && !voiceRecordingIsLongEnough(started.current, performance.now())) { cancel(); return; }
    change("transcribing"); clearTimeout(deadline.current); recorder.current?.stop();
  }
  const actions = useRef({ start, finish, cancel }); actions.current = { start, finish, cancel };
  useEffect(() => {
    if (autoStart && enabled && phaseRef.current === "idle") {
      onAutoStarted();
      void actions.current.start();
    }
  }, [autoStart, enabled, onAutoStarted]);
  useEffect(() => {
    const doublePress = createVoiceShortcut([currentKey, newKey], [currentPress === "single" ? currentKey : "", newPress === "single" ? newKey : ""]);
    let restoreTyping: (() => void) | undefined;
    let previousTarget: EventTarget | null = null;
    const keydown = (event: KeyboardEvent) => {
      // The active recorder owns Enter regardless of focus or earlier preventDefault.
      // Stop other window listeners too: there may be several mounted voice modes.
      if (event.key === "Enter" && phaseRef.current !== "idle") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && !event.isComposing && event.keyCode !== 229 && phaseRef.current === "recording")
          actions.current.finish(true);
        return;
      }
      if (event.defaultPrevented || (phaseRef.current === "idle" && document.querySelector(".voice-shortcut-dialog[open]"))) return;
      if (event.target instanceof Element && event.target.closest("[data-voice-binding]")) { restoreTyping = undefined; previousTarget = null; return; }
      if (event.key === "Escape" && phaseRef.current !== "idle") {
        event.preventDefault(); event.stopPropagation(); actions.current.cancel(); return;
      }
      const binding = voiceBinding(event);
      const target = event.target instanceof Element ? event.target : null;
      if (event.repeat) return;
      const active = document.activeElement;
      const isEditor = (element: Element | null) => !!element && (
        !!element.closest("input, textarea, [role='textbox'], [role='combobox']") ||
        (element instanceof HTMLElement && element.isContentEditable)
      );
      const editing = isEditor(target) || isEditor(active);
      const matched = doublePress(event, performance.now(), editing && !fieldMode);
      if (!fieldMode && editing && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(binding)) {
        restoreTyping = undefined; previousTarget = null; return;
      }
      if (!matched) {
        restoreTyping = [currentKey, newKey].includes(binding) && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing
          ? captureTyping(target, event.key) : undefined;
        previousTarget = event.target;
        return;
      }
      if ((phaseRef.current === "idle" || phaseRef.current === "blocked" || phaseRef.current === "error") && !latest.current.enabled) {
        restoreTyping = undefined;
        if (latest.current.unavailableReason) {
          event.preventDefault(); event.stopPropagation();
          setError(latest.current.unavailableReason); change("blocked");
        }
        return;
      }
      event.preventDefault(); event.stopPropagation();
      if (!((binding === currentKey && currentPress === "single") || (binding === newKey && newPress === "single")) && previousTarget === event.target) restoreTyping?.();
      restoreTyping = undefined;

      if (phaseRef.current === "idle" || phaseRef.current === "error" || phaseRef.current === "blocked") {
        if (!latest.current.enabled) return;
        if (latest.current.onOpen() === false) return;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (binding === newKey) latest.current.onNewChat();
        else void actions.current.start();
      }
      else if (phaseRef.current === "transcribing") actions.current.cancel();
      else actions.current.finish();
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      attempt.current++; release(); latest.current.onBusy(false);
    };
  }, [currentKey, newKey, currentPress, newPress, fieldMode]);
  const visible = phase !== "idle";
  useEffect(() => {
    const element = dialog.current;
    if (!element || !visible) return;
    element.setAttribute("open", "");
    const cleanup = keepVoiceOverlayOnTop(host, element);
    return () => { cleanup(); element.removeAttribute("open"); };
  }, [visible, host]);
  useEffect(() => {
    if (!fieldMode) return;
    const cancelOutside = (event: PointerEvent) => {
      if (phaseRef.current !== "idle" && event.target instanceof Node && !dialog.current?.contains(event.target))
        actions.current.cancel();
    };
    document.addEventListener("pointerdown", cancelOutside, true);
    return () => document.removeEventListener("pointerdown", cancelOutside, true);
  }, [fieldMode]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - started.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);
  return createPortal(<div ref={dialog} role="dialog" className="voice-shortcut-dialog" popover="manual" aria-modal={false} aria-labelledby={titleId}>
    <div className={`voice-shortcut-card is-${phase}`} tabIndex={-1}>
      <button type="button" className="voice-shortcut-close" onClick={cancel} aria-label="Отменить запись и отправку" title="Отменить · Esc"><X size={19} /></button>
      <div className="voice-orb" aria-hidden="true"><span /><span /><span />
        {phase === "transcribing" || phase === "requesting" ? <LoaderCircle size={27} className="spin" /> : (phase === "error" || phase === "blocked") ? <AlertCircle size={27} /> : <Mic size={27} />}
      </div>
      <strong id={titleId}>{phase === "recording" ? "Слушаю вас" : phase === "requesting" ? "Включаю микрофон…" : phase === "transcribing" ? "Распознаю речь…" : phase === "blocked" ? "Голосовой чат пока недоступен" : "Не получилось записать"}</strong>
      <div className="voice-shortcut-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * -0.13}s` }} />)}</div>
      <p className="voice-shortcut-target" title={title}>{fieldMode ? "В поле ввода" : "В текущий чат"} · {title}</p>
      <p className="voice-shortcut-help" role="status">{error || (phase === "recording" ? `Enter — закончить и ${fieldMode ? "вставить" : "отправить"}` : phase === "transcribing" ? "Esc или × — отменить отправку" : "Разрешите доступ к микрофону")}</p>
      {phase === "recording" && <div className="voice-shortcut-footer"><time>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</time>
        <button type="button" onClick={() => finish()}><Square size={13} />{seconds < 2 ? "Отменить короткую запись" : fieldMode ? "Вставить" : "Отправить"}</button></div>}
      {phase === "blocked" && <button type="button" className="secondary" onClick={cancel}>Понятно</button>}
      {phase === "error" && <button type="button" className="secondary" onClick={() => void start()}>Попробовать снова</button>}
    </div>
  </div>, host);
}
