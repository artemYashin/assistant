import { useEffect, useRef, useState } from "react";
import { X, Plus } from "lucide-react";
import { SingleSelect } from "./SingleSelect.js";
import { api } from "./api.js";

export function LocalTagsEditor({ value, onChange, source, disabled }: {
  value: string; onChange: (value: string) => void; source: string; disabled: boolean;
}) {
  const [known, setKnown] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rows = value.split("\n");
  const tags = rows.map((v) => v.trim()).filter(Boolean);
  useEffect(() => {
    let live = true;
    api(`/local-ticket-tags?${new URLSearchParams({ source })}`)
      .then((result) => { if (live) setKnown(result); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [source]);
  useEffect(() => { if (active !== null) input.current?.focus(); }, [active]);
  function append(tag = "") {
    if (tag && tags.includes(tag)) return;
    const next = [...tags, tag];
    onChange(next.join("\n"));
    setActive(tag ? null : next.length - 1);
  }
  return <div className="local-tags-editor">
    <SingleSelect label={loading ? "Загружаю существующие теги…" : "Добавить существующий тег"}
      value="" options={known.filter((tag) => !tags.includes(tag)).map((tag) => ({ value: tag, label: tag }))}
      disabled={disabled || loading || tags.length >= 30} onChange={append} />
    {error && <p className="muted" role="status">Список тегов недоступен: {error}. Можно ввести вручную.</p>}
    <span className="local-tags-editor-label">Локальные теги · Enter — следующий тег</span>
    <div className="local-tags-editor-field" role="group" aria-label="Локальные теги">
      {rows.map((tag, index) => <div className="local-tags-editor-row" key={index}>
        {active === index || !tag.trim() ? <input ref={active === index ? input : undefined}
          aria-label={`Тег ${index + 1}`} placeholder="Введите тег…" maxLength={60}
          disabled={disabled} value={tag} onFocus={() => setActive(index)}
          onBlur={() => setActive(null)}
          onChange={(e) => onChange(rows.map((v, i) => i === index ? e.target.value : v).join("\n"))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!tag.trim()) return;
              if (rows[index + 1] !== undefined) setActive(index + 1);
              else if (tags.length < 30) append();
              else setActive(null);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/[\r\n]/.test(text)) return;
            e.preventDefault();
            const pasted = text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
            const next = [...rows];
            next.splice(index, 1, ...pasted);
            onChange(next.join("\n"));
            setActive(null);
          }} /> : <button type="button" className="local-tags-editor-chip" disabled={disabled}
            title="Редактировать тег" onClick={() => setActive(index)}>{tag.trim()}</button>}
        {tag && <button type="button" className="local-tags-editor-remove" disabled={disabled}
          aria-label={`Удалить тег ${tag.trim()}`} onClick={() => {
            onChange(rows.filter((_, i) => i !== index).join("\n")); setActive(null);
          }}><X size={13} /></button>}
      </div>)}
      {tags.length < 30 && rows.every((v) => !!v.trim()) && <button type="button"
        className="text-button" disabled={disabled} onClick={() => append()}><Plus size={14} />Добавить тег</button>}
    </div>
    <span className="muted">{tags.length} / 30 · до 60 символов в теге. Нажмите на тег, чтобы изменить.</span>
  </div>;
}
