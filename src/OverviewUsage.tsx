import { useState } from "react";
import { Link } from "react-router-dom";
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
export function OverviewUsage({ usage }: { usage: any }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [selected, setSelected] = useState<number | null>(null);
  if (!usage) return null;
  const points = (
    period === "day"
      ? usage.hourly || []
      : usage.daily.slice(period === "week" ? -7 : -30)
  ).map((point: any) => ({
    ...point,
    at: point.hour ? point.hour + ":00:00Z" : point.day + "T00:00:00Z",
  }));
  const max = Math.max(1, ...points.flatMap((p: any) => [p.input, p.output]));
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(max)) - 2);
  const candidates = [
    0,
    ...Array.from({ length: Math.ceil(Math.log10(max)) + 2 }, (_, exponent) =>
      [1, 2, 5].map((n) => n * 10 ** exponent),
    ).flat(),
  ];
  const ceiling = candidates.find((value) => value >= max) || max;
  const x = (index: number) =>
    60 + (index / Math.max(1, points.length - 1)) * 660;
  const y = (value: number) =>
    150 - (Math.log10(1 + value / unit) / Math.log10(1 + ceiling / unit)) * 132;
  // Keep labels legible; select from the high end so large-value steps remain visible.
  const ticks = candidates
    .filter((value) => value <= ceiling)
    .reverse()
    .reduce<number[]>((chosen, value) => {
      if (!chosen.length || y(value) - y(chosen.at(-1)!) >= 13)
        chosen.push(value);
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
            ...(full
              ? { day: "numeric" as const, month: "short" as const }
              : {}),
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
      <div
        className="overview-usage-periods"
        role="group"
        aria-label="Период графика"
      >
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
            Вход
          </span>
          <span>
            <i className="token-output" />
            Выход
          </span>
          <small>Логарифмическая шкала Y</small>
        </div>
        <svg
          viewBox="0 0 760 185"
          role="img"
          aria-label="Линейный график входных и выходных токенов, логарифмическая шкала"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1="60"
                x2="720"
                y1={y(tick)}
                y2={y(tick)}
                stroke="#dce3e9"
                strokeDasharray="3 4"
              />
              <text
                x="51"
                y={y(tick) + 4}
                textAnchor="end"
                className="overview-axis-label"
              >
                {tick >= 1000000
                  ? tick / 1000000 + "M"
                  : tick >= 1000
                    ? tick / 1000 + "K"
                    : tick}
              </text>
            </g>
          ))}
          {(["input", "output"] as const).map((key) => (
            <polyline
              key={key}
              fill="none"
              stroke={key === "input" ? "#377a68" : "#6784c4"}
              strokeWidth="1.2"
              strokeLinejoin="round"
              points={points
                .map((p: any, i: number) => x(i) + "," + y(p[key]))
                .join(" ")}
            />
          ))}
          {points.map((point: any, index: number) => (
            <g key={point.at}>
              {(["input", "output"] as const).map((key) => (
                <circle
                  key={key}
                  cx={x(index)}
                  cy={y(point[key])}
                  r={selected === index ? 3 : 1.5}
                  fill={key === "input" ? "#377a68" : "#6784c4"}
                />
              ))}
              {(index === 0 ||
                index === points.length - 1 ||
                index % Math.ceil(points.length / 5) === 0) && (
                <text
                  x={x(index)}
                  y="174"
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === points.length - 1
                        ? "end"
                        : "middle"
                  }
                  className="overview-axis-label"
                >
                  {label(point.at)}
                </text>
              )}
              <rect
                x={x(index) - 330 / Math.max(1, points.length - 1)}
                y="15"
                width={660 / Math.max(1, points.length - 1)}
                height="140"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={
                  label(point.at, true) +
                  ": вход " +
                  point.input +
                  ", выход " +
                  point.output
                }
                onMouseEnter={() => setSelected(index)}
                onMouseLeave={() => setSelected(null)}
                onFocus={() => setSelected(index)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(index)}
              />
            </g>
          ))}
          {hovered && selected !== null && (
            <g
              pointerEvents="none"
              transform={`translate(${Math.max(60, Math.min(544, x(selected) + 10))},${Math.max(8, Math.min(90, y(Math.max(hovered.input, hovered.output)) - 64))})`}
              className="overview-point-tooltip"
            >
              <rect width="174" height="58" rx="7" />
              <text x="9" y="15">
                {label(hovered.at, true)} UTC
              </text>
              <text x="9" y="33" fill="#377a68">
                Вход: {number(hovered.input)}
              </text>
              <text x="9" y="48" fill="#6784c4">
                Выход: {number(hovered.output)}
              </text>
            </g>
          )}
        </svg>
      </div>
      <small className="muted">
        По полученным отчётам модели в выбранном контексте. Шкала log₁₀(1 +
        токены / {number(unit)}) позволяет показать нулевые значения и подробнее
        различать крупные значения. Текущий час/день ещё не завершён; токены
        относятся к началу запроса. Без отчёта модели расход может быть
        неполным.
      </small>
    </section>
  );
}
