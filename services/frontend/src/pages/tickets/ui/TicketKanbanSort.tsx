import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { ticketColumns } from "../../../features/ticket-columns/index.js";
import { useLocalManagement } from "../../../entities/work-mode/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import "./ticket-kanban-sort.css";

export function TicketKanbanSort({
  value,
  onChange,
  trash = false,
}: {
  value: string;
  onChange: (value: string) => void;
  trash?: boolean;
}) {
  const management = useLocalManagement();
  const field = value.replace(/-(asc|desc)$/, "");
  const direction = value.endsWith("-asc") ? "asc" : "desc";
  const fields: readonly (readonly [string, string])[] = [
    ["id", "ID тикета"],
    ["title", "Название"],
    ["type", "Тип задачи"],
    ...ticketColumns.filter(
      ([key]) => key !== "actions" && (management || key !== "developer_name"),
    ),
    ...(trash
      ? ([
          ["removedAt", "Удалён"],
          ["expiresAt", "Хранится до"],
        ] as const)
      : []),
  ];
  return (
    <section className="ticket-kanban-sort-panel" aria-label="Сортировка канбана">
      <strong className="ticket-kanban-sort-title">
        <ArrowUpDown size={17} />
        Сортировка
      </strong>
      <SingleSelect
        label="Сортировать по"
        value={field}
        options={fields.map(([value, label]) => ({ value, label }))}
        onChange={(next) => onChange(`${next}-${direction}`)}
        active={field !== (trash ? "removedAt" : "id")}
      />
      <SingleSelect
        label="Порядок"
        value={direction}
        options={[
          { value: "asc", label: "По возрастанию" },
          { value: "desc", label: "По убыванию" },
        ]}
        onChange={(next) => onChange(`${field}-${next}`)}
        searchable={false}
        active={direction !== "desc"}
        renderOption={(option) => (
          <span className="ticket-kanban-sort-direction">
            {option.value === "asc" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            {option.label}
          </span>
        )}
      />
    </section>
  );
}
