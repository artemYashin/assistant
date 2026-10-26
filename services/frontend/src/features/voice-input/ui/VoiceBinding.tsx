import {
  voiceBinding,
  voiceBindingLabel,
  modifierCode,
} from "../../../../../backend/src/voice-binding.js";
import { X } from "lucide-react";
import { useRef, useState } from "react";

export function VoiceBinding({
  value,
  otherKey,
  otherKeys = [],
  onChange,
}: {
  value: string;
  otherKey: string;
  otherKeys?: string[];
  onChange: (value: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef("");
  function cancel() {
    setListening(false);
    pending.current = "";
    setError("");
  }
  function save(binding: string) {
    if (binding === otherKey || otherKeys.includes(binding)) {
      setError("Эта клавиша уже используется для другого действия");
      return;
    }
    onChange(binding);
    setError("");
    setListening(false);
    pending.current = "";
  }
  return (
    <div
      className="voice-binding"
      data-voice-binding
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancel();
      }}
      onKeyDown={(event) => {
        if (listening && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <button
        type="button"
        className="voice-binding-key"
        aria-label="Записать клавишу"
        onClick={() => {
          setListening(true);
          pending.current = "";
          setError("");
        }}
        onKeyDown={(event) => {
          if (!listening) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            cancel();
            return;
          }
          if (event.repeat || event.nativeEvent.isComposing) return;
          if (!event.code || event.code === "Unidentified") {
            setError("Браузер не распознал клавишу");
            return;
          }
          if (modifierCode(event.code)) {
            pending.current = voiceBinding(event);
            return;
          }
          pending.current = "";
          save(voiceBinding(event));
        }}
        onKeyUp={(event) => {
          if (!listening) return;
          event.preventDefault();
          event.stopPropagation();
          if (pending.current && modifierCode(event.code)) save(pending.current);
        }}
      >
        {listening ? (
          "Нажмите клавишу…"
        ) : (
          <>
            <kbd>{value ? voiceBindingLabel(value) : "Отключено"}</kbd>
            <span>Изменить клавишу</span>
          </>
        )}
      </button>
      {listening && (
        <button
          type="button"
          className="voice-binding-cancel"
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancel}
          title="Отменить выбор · Esc"
        >
          Отмена <kbd>Esc</kbd>
        </button>
      )}
      {value && !listening && (
        <button
          type="button"
          className="icon-button"
          title="Отключить горячую клавишу"
          aria-label="Отключить горячую клавишу"
          onClick={() => {
            cancel();
            onChange("");
          }}
        >
          <X size={14} />
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
