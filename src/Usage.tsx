import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUp,
  ArrowDown,
  Clock,
  ShieldCheck,
  Square,
} from "lucide-react";
import { api } from "./api.js";
const number = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("ru-RU");
const statuses: Record<string, string> = {
  running: "Выполняется",
  completed: "Завершён",
  error: "Ошибка",
  limited: "Лимит",
  stopped: "Остановлен",
  interrupted: "Прерван перезапуском",
};
export function Usage({ onSettings }: { onSettings: () => void }) {
  const [days, setDays] = useState("1"),
    [report, setReport] = useState<any>(null),
    [error, setError] = useState(""),
    [stopping, setStopping] = useState(false);
  useEffect(() => {
    let active = true;
    setReport(null);
    const load = async () => {
      try {
        const result = await api(`/usage?days=${days}`);
        if (active) {
          setReport(result);
          setError("");
        }
      } catch (e: any) {
        if (active) setError(e.message);
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [days]);
  const s = report?.summary;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Использование LLM</h1>
          <p>
            Расход только этого Orbit. Данные сохраняются между перезапусками и
            обновляются каждые 5 секунд.
          </p>
        </div>
        <select
          aria-label="Период учёта токенов"
          style={{ width: 170 }}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="1">Последние 24 часа</option>
          <option value="7">Последние 7 дней</option>
          <option value="30">Последние 30 дней</option>
          <option value="0">Всё время</option>
        </select>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="safety-strip">
        <ShieldCheck size={20} />
        <span>
          Это токены, сообщённые SDK, а не счёт GitHub и не остаток
          корпоративной подписки. Неизвестные значения отмечены «—». Кеш показан
          отдельно и не прибавляется повторно.
        </span>
      </div>
      {s && (
        <>
          <div className="stats-grid">
            {[
              {
                label: "Входные токены",
                value: s.input_tokens,
                icon: ArrowDown,
              },
              {
                label: "Выходные токены",
                value: s.output_tokens,
                icon: ArrowUp,
              },
              { label: "Ваши запросы", value: s.requests, icon: Activity },
              {
                label: "Вызовы с отчётом SDK",
                value: s.model_calls,
                icon: Clock,
              },
            ].map((x) => (
              <div className="stat-card" key={x.label}>
                <span>
                  {x.label}
                  <x.icon size={17} />
                </span>
                <strong style={{ fontSize: 25 }}>{number(x.value)}</strong>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="section-heading">
              <h2>Полнота отчёта и ограничения</h2>
              <button className="secondary" onClick={onSettings}>
                Настроить лимиты
              </button>
            </div>
            <p className="muted">
              Кеш: прочитано {number(s.cache_read_tokens)}, записано{" "}
              {number(s.cache_write_tokens)} токенов по отчётам SDK. Без
              usage-отчёта: {s.unreported_requests} запросов. С возможной
              неполнотой: {s.possibly_partial_requests}. Эти категории могут
              пересекаться.
            </p>
            <p className="muted">
              Счётчик начинается с установки трекера; прошлые диалоги не
              пересчитываются. При обрыве связи, остановке или перезапуске
              фактический расход может быть выше полученных значений. Порог
              токенов проверяется после отчёта о вызове и может быть превышен
              одним или несколькими уже выполняющимися вызовами.
            </p>
            {report.activeRequestId && (
              <div className="card-actions">
                <button
                  className="secondary"
                  disabled={stopping}
                  onClick={async () => {
                    setStopping(true);
                    try {
                      await api("/conversation/stop", "POST", {});
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setStopping(false);
                    }
                  }}
                >
                  <Square size={15} />
                  Остановить текущий запрос
                </button>
                <small>Уже потраченные токены не возвращаются.</small>
              </div>
            )}
          </div>
        </>
      )}
      {!report ? (
        <p className="muted">Загружаю отчёт…</p>
      ) : !report.requests.length ? (
        <div className="empty">
          <Activity size={28} />
          <h3>В этом периоде ещё нет запросов</h3>
          <p>
            Отправьте сообщение ассистенту. Синхронизация Teams и Azure сюда не
            попадает: она не вызывает LLM.
          </p>
        </div>
      ) : (
        <div className="table-wrap panel">
          <table>
            <thead>
              <tr>
                <th>Запрос · контекст</th>
                <th>Модель</th>
                <th>Вход / выход</th>
                <th>Отчёты / инструменты</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {report.requests.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <b>{new Date(r.created_at).toLocaleString("ru-RU")}</b>
                    <small>
                      {[r.client, r.project].filter(Boolean).join(" / ") ||
                        "Общий контекст"}
                    </small>
                    <small style={{ display: "block" }}>
                      ID: {r.id.slice(0, 8)}
                      {r.finished_at
                        ? ` · ${Math.round((Date.parse(r.finished_at) - Date.parse(r.created_at)) / 1000)} с`
                        : ""}
                    </small>
                  </td>
                  <td>{r.models || r.model}</td>
                  <td>
                    {number(r.input_tokens)} / {number(r.output_tokens)}
                    {r.incomplete_calls > 0 && (
                      <small style={{ display: "block" }}>
                        Часть данных отсутствует
                      </small>
                    )}
                  </td>
                  <td>
                    {number(r.model_calls)} / {r.tool_calls}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.status === "completed" ? "green" : r.status === "running" ? "violet" : "amber"}`}
                    >
                      {statuses[r.status] || r.status}
                    </span>
                    {r.reason && (
                      <small
                        style={{
                          display: "block",
                          maxWidth: 230,
                          marginTop: 8,
                        }}
                      >
                        {r.reason}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        Таблица показывает последние 100 запросов выбранного периода. Суммы
        рассчитаны по всем сохранённым запросам периода.
      </p>
    </>
  );
}
