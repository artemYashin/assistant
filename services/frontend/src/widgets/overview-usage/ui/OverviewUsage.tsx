import { useState } from "react";
import { Link } from "react-router-dom";
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
export function OverviewUsage({ usage }: { usage: any }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [selected, setSelected] = useState<number | null>(null);
  if (!usage) return null;
  const points = (
    period === "day" ? usage.hourly || [] : usage.daily.slice(period === "week" ? -7 : -30)
  ).map((point: any) => ({
    ...point,
    total: point.input + point.output,
    at: point.hour ? point.hour + ":00:00Z" : point.day + "T00:00:00Z",
  }));
  const max = Math.max(1, ...points.map((p: any) => p.total));
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(max)) - 2);
  const candidates = [
    0,
    ...Array.from({ length: Math.ceil(Math.log10(max)) + 2 }, (_, exponent) =>
      [1, 2, 5].map((n) => n * 10 ** exponent),
    ).flat(),
  ];
  const ceiling = candidates.find((value) => value >= max) || max;
  const x = (index: number) => 34 + (index / Math.max(1, points.length - 1)) * 712;
  const y = (value: number) =>
    150 - (Math.log10(1 + value / unit) / Math.log10(1 + ceiling / unit)) * 132;
  // Keep labels legible; select from the high end so large-value steps remain visible.
  const ticks = candidates
    .filter((value) => value <= ceiling)
    .reverse()
    .reduce<number[]>((chosen, value) => {
      if (!chosen.length || y(value) - y(chosen.at(-1)!) >= 13) chosen.push(value);
      return chosen;
    }, [])
    .reverse();
  if (!ticks.includes(0)) {
    if (ticks.length && y(0) - y(ticks[0]) < 13) ticks.shift();
    ticks.unshift(0);
  }
  const label = (at: string, full = false) =>
    new Date(at).toLocaleString("ru-RU", {
      timeZone: "UTC",
      ...(period === "day"
        ? {
            hour: "2-digit" as const,
            minute: "2-digit" as const,
            ...(full ? { day: "numeric" as const, month: "short" as const } : {}),
          }
        : { day: "numeric" as const, month: "short" as const }),
    });
  const hovered = selected === null ? null : points[selected];
  return (
    <section className="panel overview-usage">
      <div className="section-heading">
        <h2>Использование LLM</h2>
        <Link to="/usage">Подробнее →</Link>
      </div>
      <div className="overview-usage-periods" role="group" aria-label="Период графика">
        {(
          [
            ["day", "День"],
            ["week", "Неделя"],
            ["month", "Месяц"],
          ] as const
        ).map(([value, title]) => (
          <button
            type="button"
            key={value}
            aria-pressed={period === value}
            onClick={() => {
              setPeriod(value);
              setSelected(null);
            }}
          >
            {title}
          </button>
        ))}
        <small>
          {period === "day"
            ? "24 часа · по часам"
            : period === "week"
              ? "7 дней · по дням"
              : "30 дней · по дням"}{" "}
          · UTC
        </small>
      </div>
      <div className="overview-token-totals">
        {(
          [
            ["input", "Вход"],
            ["output", "Выход"],
          ] as const
        ).map(([key, title]) => (
          <div key={key}>
            <small>{title} за выбранный период</small>
            <strong>
              {number(points.reduce((sum: number, p: any) => sum + p[key], 0))}{" "}
              <small>токенов</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="overview-line-chart">
        <div className="overview-chart-legend">
          <span>
            <i className="token-input" />
            Всего токенов
          </span>
          <small>Логарифмическая шкала Y</small>
        </div>
        <div className="overview-chart-plot">
          <svg
            viewBox="0 0 760 185"
            role="img"
            aria-label="Общий расход токенов, логарифмическая шкала"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1="34"
                  x2="746"
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="#dce3e9"
                  strokeDasharray="3 4"
                />
                <text x="28" y={y(tick) + 3} textAnchor="end" className="overview-axis-label">
                  {tick >= 1000000 ? tick / 1000000 + "M" : tick >= 1000 ? tick / 1000 + "K" : tick}
                </text>
              </g>
            ))}
            <path d="M34 18 V150 H746" fill="none" stroke="#aab9c6" strokeWidth="0.7" />
            <polyline
              fill="none"
              stroke="#377a68"
              strokeWidth="1"
              strokeLinejoin="round"
              points={points.map((p: any, i: number) => x(i) + "," + y(p.total)).join(" ")}
            />
            {points.map((point: any, index: number) => (
              <g key={point.at}>
                <circle
                  cx={x(index)}
                  cy={y(point.total)}
                  r={selected === index ? 2 : 1}
                  fill="#377a68"
                />
                {(index === 0 ||
                  index === points.length - 1 ||
                  index % Math.ceil(points.length / 5) === 0) && (
                  <text
                    x={x(index)}
                    y="174"
                    textAnchor={
                      index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
                    }
                    className="overview-axis-label"
                  >
                    {label(point.at)}
                  </text>
                )}
                <rect
                  x={Math.max(34, x(index) - 356 / Math.max(1, points.length - 1))}
                  y="15"
                  width={
                    Math.min(746, x(index) + 356 / Math.max(1, points.length - 1)) -
                    Math.max(34, x(index) - 356 / Math.max(1, points.length - 1))
                  }
                  height="140"
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={
                    label(point.at, true) + ": вход " + point.input + ", выход " + point.output
                  }
                  onMouseEnter={() => setSelected(index)}
                  onMouseLeave={() => setSelected(null)}
                  onFocus={() => setSelected(index)}
                  onBlur={() => setSelected(null)}
                  onClick={() => setSelected(index)}
                />
              </g>
            ))}
          </svg>
          {hovered && selected !== null && (
            <div
              className="overview-point-tooltip"
              role="status"
              style={{
                left: `clamp(0px, ${(x(selected) / 760) * 100}%, max(0px, 100% - 172px))`,
                top: `${(Math.max(0, y(hovered.total) - 12) / 185) * 100}%`,
              }}
            >
              <div className="overview-tooltip-date">{label(hovered.at, true)} · UTC</div>
              <div className="overview-tooltip-row overview-tooltip-total">
                <span>Всего токенов</span>
                <strong>{number(hovered.total)}</strong>
              </div>
              <div className="overview-tooltip-row">
                <span>Входные токены</span>
                <b>{number(hovered.input)}</b>
              </div>
              <div className="overview-tooltip-row">
                <span>Выходные токены</span>
                <b>{number(hovered.output)}</b>
              </div>
            </div>
          )}
        </div>
      </div>
      <small className="muted">
        По полученным отчётам модели в выбранном контексте. Шкала log₁₀(1 + токены / {number(unit)})
        позволяет показать нулевые значения и подробнее различать крупные значения. Текущий час/день
        ещё не завершён; токены относятся к началу запроса. Без отчёта модели расход может быть
        неполным.
      </small>
    </section>
  );
}
