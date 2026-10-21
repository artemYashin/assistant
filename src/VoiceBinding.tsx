import { useState } from "react";

export function VoiceBinding({ value, otherKey, onChange }: { value: string; otherKey: string; onChange: (value: string) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  return <div className="voice-binding" data-voice-binding>
    <button type="button" className="voice-binding-key" aria-label="Записать клавишу" onClick={() => { setListening(true); setError(""); }} onBlur={() => setListening(false)} onKeyDown={event => {
      if (!listening) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setListening(false); setError(""); return; }
      if (event.repeat || event.nativeEvent.isComposing) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) {
        setError("Нажмите букву или цифру без модификаторов"); return;
      }
      if (event.code === otherKey) { setError("Эта клавиша уже используется для другого чата"); return; }
      onChange(event.code); setError(""); setListening(false);
    }}>{listening ? "Нажмите клавишу…" : <><kbd>{value.replace(/^(Key|Digit)/, "")}</kbd><span>Изменить клавишу</span></>}</button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
