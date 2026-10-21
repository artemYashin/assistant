import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, X, Square, LoaderCircle, AlertCircle } from "lucide-react";
import { api } from "./api.js";
import { createVoiceShortcut, voiceRecordingIsLongEnough, shortcutTextWasInserted } from "./voice-shortcut.js";

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
type Phase = "idle" | "requesting" | "recording" | "transcribing" | "error";
export function VoiceShortcut({ enabled, onText, onBusy, title }: {
  enabled: boolean; onText: (text: string) => void; onBusy: (busy: boolean) => void; title: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle"), [error, setError] = useState(""), [seconds, setSeconds] = useState(0);
  const phaseRef = useRef<Phase>("idle"), attempt = useRef(0), started = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcription = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef({ enabled, onText, onBusy });
  latest.current = { enabled, onText, onBusy };
  function change(next: Phase) {
    phaseRef.current = next; setPhase(next);
    latest.current.onBusy(next !== "idle");
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
  function finish() {
    if (phaseRef.current === "requesting") { cancel(); return; }
    if (phaseRef.current !== "recording") return;
    if (!voiceRecordingIsLongEnough(started.current, performance.now())) { cancel(); return; }
    change("transcribing"); clearTimeout(deadline.current); recorder.current?.stop();
  }
  const actions = useRef({ start, finish, cancel }); actions.current = { start, finish, cancel };
  useEffect(() => {
    const doublePress = createVoiceShortcut();
    let restoreTyping: (() => void) | undefined;
    let previousTarget: EventTarget | null = null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phaseRef.current !== "idle") {
        event.preventDefault(); event.stopPropagation(); actions.current.cancel(); return;
      }
      if (event.key === "Enter" && phaseRef.current !== "idle" && !event.isComposing) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && phaseRef.current === "recording") actions.current.finish();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (event.repeat) return;
      const matched = doublePress(event, performance.now());
      if (!matched) {
        restoreTyping = event.code === "KeyM" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing
          ? captureTyping(target, event.key) : undefined;
        previousTarget = event.target;
        return;
      }
      if (phaseRef.current === "idle" && !latest.current.enabled) { restoreTyping = undefined; return; }
      event.preventDefault(); event.stopPropagation();
      if (previousTarget === event.target) restoreTyping?.();
      restoreTyping = undefined;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (phaseRef.current === "idle" || phaseRef.current === "error") void actions.current.start();
      else if (phaseRef.current === "transcribing") actions.current.cancel();
      else actions.current.finish();
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      attempt.current++; release(); latest.current.onBusy(false);
    };
  }, []);
  useEffect(() => {
    if (phase === "idle") dialog.current?.close();
    else if (!dialog.current?.open) { dialog.current?.showModal(); dialog.current?.querySelector<HTMLElement>(".voice-shortcut-card")?.focus(); }
  }, [phase]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - started.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);
  return createPortal(<dialog ref={dialog} className="voice-shortcut-dialog" aria-labelledby="voice-shortcut-title"
    onCancel={event => { event.preventDefault(); cancel(); }} onClose={() => { if (phaseRef.current !== "idle") cancel(); }}>
    <div className={`voice-shortcut-card is-${phase}`} tabIndex={-1}>
      <button type="button" className="voice-shortcut-close" onClick={cancel} aria-label="Отменить запись и отправку" title="Отменить · Esc"><X size={19} /></button>
      <div className="voice-orb" aria-hidden="true"><span /><span /><span />
        {phase === "transcribing" || phase === "requesting" ? <LoaderCircle size={27} className="spin" /> : phase === "error" ? <AlertCircle size={27} /> : <Mic size={27} />}
      </div>
      <strong id="voice-shortcut-title">{phase === "recording" ? "Слушаю вас" : phase === "requesting" ? "Включаю микрофон…" : phase === "transcribing" ? "Распознаю речь…" : "Не получилось записать"}</strong>
      <div className="voice-shortcut-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * -0.13}s` }} />)}</div>
      <p className="voice-shortcut-target" title={title}>В текущий чат · {title}</p>
      <p className="voice-shortcut-help" role="status">{error || (phase === "recording" ? "Enter или M M — закончить и отправить" : phase === "transcribing" ? "Esc или × — отменить отправку" : "Разрешите доступ к микрофону")}</p>
      {phase === "recording" && <div className="voice-shortcut-footer"><time>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</time>
        <button type="button" onClick={finish}><Square size={13} />{seconds < 2 ? "Отменить короткую запись" : "Отправить"}</button></div>}
      {phase === "error" && <button type="button" className="secondary" onClick={() => void start()}>Попробовать снова</button>}
    </div>
  </dialog>, document.body);
}
