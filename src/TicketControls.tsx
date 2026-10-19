import { useEffect, useState } from "react";
import { api } from "./api.js";
export function StatusBadge({
  state,
  colors = {},
}: {
  state: string;
  colors?: Record<string, string>;
}) {
  const color = colors[state];
  return (
    <span
      className="ticket-state-badge"
      style={
        color
          ? { color, background: color + "18", borderColor: color }
          : undefined
      }
    >
      {state}
    </span>
  );
}
export function StatusColorsEditor({ form, set }: any) {
  const [name, setName] = useState("");
  const colors = form.statusColors || {};
  return (
    <section className="stack import-settings">
      <h3>Цвета статусов</h3>
      <p className="muted">
        Точные названия статусов Azure. Цвета сохраняются только в Orbit.
      </p>
      {Object.entries(colors).map(([state, color]) => (
        <div className="status-color-row" key={state}>
          <span>{state}</span>
          <input
            type="color"
            aria-label={`Цвет ${state}`}
            value={String(color)}
            onChange={(e) =>
              set("statusColors", { ...colors, [state]: e.target.value })
            }
          />
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const next = { ...colors };
              delete next[state];
              set("statusColors", next);
            }}
          >
            Сбросить
          </button>
        </div>
      ))}
      <div className="inline-form">
        <input
          aria-label="Статус для цвета"
          placeholder="Например, Ready for Testing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
        <button
          type="button"
          className="secondary"
          disabled={!name.trim()}
          onClick={() => {
            set("statusColors", { ...colors, [name.trim()]: "#466540" });
            setName("");
          }}
        >
          Добавить цвет
        </button>
      </div>
      <small>Нажмите «Сохранить настройки», чтобы применить цвета.</small>
    </section>
  );
}
export function LocalDeveloper({ ticket, onChange }: any) {
  const [people, setPeople] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/developers")
      .then((v) => {
        if (active) setPeople(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ticket.source]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="local-developer">
      <small>Локально поручено</small>
      <select
        aria-label={`Локальный разработчик #${ticket.id}`}
        disabled={busy}
        value={ticket.developer_id || ""}
        onChange={(e) =>
          void act(async () => {
            await api(`/tickets/${ticket.id}/developer`, "PUT", {
              developerId: e.target.value,
            });
            onChange();
          })
        }
      >
        <option value="">Не назначен</option>
        {ticket.developer_id &&
          !people.some((p) => p.id === ticket.developer_id) && (
            <option value={ticket.developer_id}>{ticket.developer_name}</option>
          )}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() =>
          void act(async () =>
            setPeople(await api("/developers/refresh", "POST", {})),
          )
        }
      >
        {busy ? "Загрузка…" : "Загрузить участников Azure"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
