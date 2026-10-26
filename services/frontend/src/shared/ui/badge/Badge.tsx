import React from "react";

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
