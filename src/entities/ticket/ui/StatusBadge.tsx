export function StatusBadge({
  state,
  colors = {},
  kind = "state",
}: {
  kind?: "state" | "type";
  state: string;
  colors?: Record<string, string>;
}) {
  const color = colors[state];
  return (
    <span
      className={`ticket-${kind}-badge`}
      title={state}
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
