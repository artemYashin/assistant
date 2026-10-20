import { Link } from "react-router-dom";
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
export function OverviewUsage({ usage }: { usage: any }) {
  if (!usage) return null;
  const peak = Math.max(
    1,
    ...usage.daily.map((day: any) => day.input + day.output),
  );
  return (
    <section className="panel overview-usage">
      <div className="section-heading">
        <h2>Использование LLM</h2>
        <Link to="/usage">Подробнее →</Link>
      </div>
      <div className="overview-token-totals">
        {[
          ["Последние 24 часа", usage.day],
          ["Последние 7 недель", usage.weeks],
        ].map(([label, value]: any) => (
          <div key={label}>
            <small>{label}</small>
            <strong>
              {number(value.input + value.output)} <small>токенов</small>
            </strong>
            <span>
              Вход: {number(value.input)} · Выход: {number(value.output)}
            </span>
            <small>
              Запросов: {value.requests}
              {value.incomplete
                ? ` · без полного отчёта: ${value.incomplete}`
                : ""}
            </small>
          </div>
        ))}
      </div>
      <div className="overview-chart-legend">
        <span>
          <i className="token-input" />
          Вход
        </span>
        <span>
          <i className="token-output" />
          Выход
        </span>
        <small>По дням за 7 недель · UTC</small>
      </div>
      <div
        className="overview-token-chart"
        role="list"
        aria-label="Токены по дням"
      >
        {usage.daily.map((day: any) => (
          <div
            key={day.day}
            className="overview-token-day"
            role="listitem"
            tabIndex={0}
            aria-label={`${day.day}: вход ${day.input}, выход ${day.output}`}
          >
            <div
              className="overview-token-bar"
              style={{ height: `${((day.input + day.output) / peak) * 100}%` }}
            >
              <span className="token-output" style={{ flex: day.output }} />
              <span className="token-input" style={{ flex: day.input }} />
            </div>
            <span className="overview-token-tooltip">
              {day.day}
              <br />
              Вход: {number(day.input)}
              <br />
              Выход: {number(day.output)}
            </span>
          </div>
        ))}
      </div>
      <div className="overview-chart-dates">
        <span>{usage.daily[0]?.day}</span>
        <span>{usage.daily.at(-1)?.day}</span>
      </div>
      <small className="muted">
        По отчётам модели, в выбранном контексте. Дни без зарегистрированных
        токенов показаны нулевыми. Токены относятся к дате начала запроса.
      </small>
    </section>
  );
}
