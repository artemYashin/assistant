import { useEffect, useRef, useState } from "react";
import { Search, X, Users } from "lucide-react";
import { api } from "./api.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
export type ReviewerPerson = { id: string; name: string; email: string };
export function PrReviewerPicker({ title, people, onChange, disabled, context }: {
  title: string; people: ReviewerPerson[]; onChange: (value: ReviewerPerson[]) => void;
  disabled: boolean; context: { client: string; project: string };
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReviewerPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    setResults([]); setMessage(""); setLoading(false);
    if (disabled || !open || query.trim().length < 2) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api("/developers/search", "POST", { query: query.trim(), context }, controller.signal)
        .then(result => { if (!controller.signal.aborted) { setResults(result.users); setMessage(result.warning || (result.truncated ? "Показаны первые 20. Уточните поиск." : "")); } })
        .catch(e => { if (!controller.signal.aborted) setMessage(e.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, disabled, context.client, context.project]);
  return <div className="pr-reviewer-group">
    <h4 className="repository-section-title"><Users size={15} /> {title}</h4>
    <fieldset aria-label={title} className="pr-reviewer-picker" disabled={disabled}>
    <div ref={root} className="pr-reviewer-search">
      <Search size={15} />
      <input aria-label={`Поиск ${title} ревьюера`} placeholder="Имя или e-mail" maxLength={100} value={query}
        onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); } if (e.key === "Enter") e.preventDefault(); }} />
      {open && !disabled && <div className="pr-reviewer-results">
        {query.trim().length < 2 ? <small>Введите минимум 2 символа</small> : loading ? <small role="status">Поиск в Azure…</small> : <>
          {results.filter(p => !people.some(item => item.id.toLowerCase() === p.id.toLowerCase())).map(p => <button type="button" key={p.id} disabled={people.length >= 50} onClick={() => { onChange([...people, p]); setQuery(""); setOpen(false); }}>
            <InitialsAvatar name={p.name} /><span>{p.name}<small>{p.email}</small></span>
          </button>)}
          {!results.length && !message && <small>Пользователи не найдены</small>}
          {message && <small role="status">{message}</small>}
        </>}
      </div>}
    </div>
    <div className="pr-reviewer-selected">
      {people.map(p => <div className="pr-reviewer-person" key={p.id}>
        <InitialsAvatar name={p.name} /><span className="pr-reviewer-person-info"><span title={p.name}>{p.name}</span><small title={p.email}>{p.email || "Email не указан"}</small></span>
        <button type="button" className="icon-button" aria-label={`Убрать ${p.name} из ${title}`} onClick={() => onChange(people.filter(item => item.id !== p.id))}><X size={14} /></button>
      </div>)}
      {!people.length && <small className="muted">Ревьюеры не выбраны</small>}
    </div>
  </fieldset></div>;
}
