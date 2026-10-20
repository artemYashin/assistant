import { useEffect, useState } from "react";
import { api } from "./api.js";

export function useTicketFilterOptions(
  context: { client: string; project: string },
  settings: any,
  tickets: any[],
) {
  const [options, setOptions] = useState<{
    types: string[];
    states: string[];
    priorityCount: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setOptions(null);
    setError("");
    api(`/tickets/filter-options?${new URLSearchParams(context)}`)
      .then((value) => {
        if (live) setOptions(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project, settings]);
  const unique = (values: string[]) =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b, "ru"));
  return {
    types: unique([
      ...(options?.types || settings?.azureTypes || []),
      ...tickets.map((t) => t.type || ""),
    ]),
    states: unique(options?.states || settings?.azureStates || []),
    priorities: [
      ...new Set<number>([
        ...Array.from({ length: options?.priorityCount ?? 3 }, (_, i) => i + 1),
        ...tickets.map((t) => t.priority ?? 1),
      ]),
    ].sort((a, b) => a - b),
    error,
  };
}
