import type { ReactNode } from "react";

export function StatusBadge({
  state,
  colors = {},
  kind = "state",
  icon,
}: {
  kind?: "state" | "type";
  state: string;
  colors?: Record<string, string>;
  icon?: ReactNode;
}) {
  const color = colors[state];
  return (
    <span
      className={`ticket-${kind}-badge`}
      title={state}
      style={color ? { color, background: color + "18", borderColor: color } : undefined}
    >
      {icon}
      {state}
    </span>
  );
}
