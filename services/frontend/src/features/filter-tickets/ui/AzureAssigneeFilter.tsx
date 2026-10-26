import { api } from "../../../shared/api/http/index.js";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";

async function searchPeople(query: string) {
  const result = await api("/developers/search", "POST", { query });
  // Ticket summaries store Azure display names, which are also the filter values.
  const people = new Map<string, { value: string; label: string; avatarName: string }>();
  for (const user of result.users) {
    if (!user.name) continue;
    people.set(user.name, {
      value: user.name,
      avatarName: user.name,
      label: user.email ? `${user.name} · ${user.email}` : user.name,
    });
  }
  return {
    options: [...people.values()],
    warning: [
      result.warning,
      result.truncated ? "Показаны первые 20 пользователей. Уточните запрос." : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function AzureAssigneeFilter({
  names,
  value,
  onChange,
  disabled = false,
}: {
  names: string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <MultiSelect
      label="Исполнитель Azure"
      placeholder="Все исполнители"
      value={value}
      onChange={onChange}
      disabled={disabled}
      searchOptions={searchPeople}
      options={[...new Set([...names, ...value])].sort().map((name) => ({
        value: name,
        avatarName: name || undefined,
        label: name || "Не назначен в Azure",
      }))}
    />
  );
}
