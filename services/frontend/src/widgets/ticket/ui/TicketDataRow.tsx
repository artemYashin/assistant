import { TicketDate } from "../../../entities/ticket/index.js";
import { ArchiveRestore, LoaderCircle, ChevronDown, ChevronRight } from "lucide-react";
import { CopyTicketId } from "../../../entities/ticket/index.js";
import { TicketTableRow } from "./TicketCard.js";
import { TicketMetadata } from "../../../features/edit-ticket/index.js";
import { LocalDeveloper, TicketStatus } from "../../../features/edit-ticket/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { AzureAssignee } from "../../../features/edit-ticket/index.js";

export function TicketDataRow({
  ticket: t,
  columns,
  settings,
  context,
  checked,
  onToggle,
  onChange,
  onRemove,
  onRestore,
  restoring = false,
  highlighted = false,
  hierarchy,
}: any) {
  const local = t.imported !== false || t.inTrash;
  const tone = t.inTrash ? "trash" : t.imported === false ? "new" : undefined;
  const date = (v: string | number) => <TicketDate value={v} />;
  return (
    <TicketTableRow
      id={t.id}
      rowSelected={settings?.ticketClickAction === "select" ? checked : undefined}
      onRowActivate={
        settings?.ticketClickAction === "select"
          ? onToggle
          : settings?.ticketClickAction === "popup"
            ? () =>
                window.dispatchEvent(
                  new CustomEvent("orbit-show-ticket-details", {
                    detail: {
                      source: t.source,
                      tickets: [
                        { id: t.id, title: t.title || `#${t.id}`, type: t.type, state: t.state },
                      ],
                    },
                  }),
                )
            : undefined
      }
      columns={columns.count}
      columnOrder={columns.order}
      hideActions={columns.hidden("actions")}
      tone={tone}
      highlighted={highlighted}
      onRemove={onRemove}
      actions={
        <>
          {local && (
            <TicketMetadata ticket={t} context={context} field="notes" onChange={onChange} />
          )}
          {onRestore && (
            <button
              type="button"
              className="secondary"
              disabled={restoring}
              title="Восстановить тикет"
              aria-label={`Восстановить тикет #${t.id}`}
              onClick={onRestore}
            >
              {restoring ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArchiveRestore size={17} />
              )}
            </button>
          )}
        </>
      }
    >
      <td className="ticket-selection-column">
        <div className={hierarchy ? "ticket-hierarchy-selection" : undefined}>
          {hierarchy &&
            (hierarchy.children > 0 ? (
              <button
                type="button"
                className="ticket-hierarchy-toggle"
                aria-label={`${hierarchy.expanded ? "Свернуть" : "Развернуть"} подзадачи тикета #${t.id}`}
                aria-expanded={hierarchy.expanded}
                title={`${hierarchy.children} дочерних тикетов в текущих результатах`}
                onClick={(event) => {
                  event.stopPropagation();
                  hierarchy.onToggle();
                }}
              >
                {hierarchy.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <span className="ticket-hierarchy-spacer" aria-hidden="true" />
            ))}
          <input
            className="ticket-checkbox"
            type="checkbox"
            aria-label={`Выбрать тикет #${t.id}`}
            checked={checked}
            onChange={onToggle}
          />
        </div>
      </td>
      <td className="ticket-identity-column">
        <div className="ticket-id-type">
          <span className="ticket-id-with-copy">
            <a className="ticket-link" href={t.url} target="_blank" rel="noreferrer">
              #{t.id}
            </a>
            <CopyTicketId id={t.id} />
          </span>
          <StatusBadge
            state={t.type || "Тип не указан"}
            kind="type"
            colors={settings?.typeColors}
          />
        </div>
      </td>
      <td className="ticket-title-column">
        <div
          className={hierarchy?.depth ? "ticket-hierarchy-title" : undefined}
          style={hierarchy?.depth ? { marginLeft: Math.min(hierarchy.depth, 8) * 16 } : undefined}
        >
          <b className="ticket-title-clamp" title={t.title}>
            {t.title}
          </b>
        </div>
      </td>
      <td data-column="state" hidden={columns.hidden("state")}>
        <TicketStatus
          id={t.id}
          source={t.source}
          state={t.state}
          colors={settings?.statusColors}
          onChange={onChange}
        />
      </td>
      <td data-column="priority" hidden={columns.hidden("priority")}>
        {local ? (
          <TicketMetadata ticket={t} context={context} field="priority" onChange={onChange} />
        ) : (
          "N/A"
        )}
      </td>
      <td
        data-column="azurePriority"
        hidden={columns.hidden("azurePriority")}
        title="Приоритет Azure DevOps · только чтение"
      >
        {t.azurePriority ?? "—"}
      </td>
      <td data-column="localDeadline" hidden={columns.hidden("localDeadline")}>
        {local ? (
          <TicketMetadata ticket={t} context={context} field="localDeadline" onChange={onChange} />
        ) : (
          "—"
        )}
      </td>
      <td data-column="tags" hidden={columns.hidden("tags")}>
        {local ? (
          <TicketMetadata ticket={t} context={context} field="tags" onChange={onChange} />
        ) : (
          "N/A"
        )}
      </td>
      <td data-column="azureTags" hidden={columns.hidden("azureTags")}>
        <span className="ticket-tag-list azure-ticket-tags" title="Azure теги · только чтение">
          {t.azureTags?.length
            ? t.azureTags.map((tag: string) => (
                <span className="badge" key={tag}>
                  {tag}
                </span>
              ))
            : "—"}
        </span>
      </td>
      <td data-column="assigned" hidden={columns.hidden("assigned")}>
        <AzureAssignee ticket={t} onChange={onChange} />
      </td>
      <td data-column="developer_name" hidden={columns.hidden("developer_name")}>
        {local ? <LocalDeveloper ticket={t} context={context} onChange={onChange} /> : "N/A"}
      </td>
      <td data-column="created_at" hidden={columns.hidden("created_at")}>
        {date(t.created_at)}
      </td>
      <td data-column="changed_at" hidden={columns.hidden("changed_at")}>
        {date(t.changed_at)}
      </td>
      <td data-column="added_at" hidden={columns.hidden("added_at")}>
        {local ? date(t.added_at) : "N/A"}
      </td>
      {columns.order.includes("removedAt") ? (
        <>
          <td data-column="removedAt" hidden={columns.hidden("removedAt")}>
            {date(t.removedAt)}
          </td>
          <td data-column="expiresAt" hidden={columns.hidden("expiresAt")}>
            {date(t.expiresAt)}
          </td>
        </>
      ) : null}
      {columns.order.includes("synced_at") && (
        <td data-column="synced_at" hidden={columns.hidden("synced_at")}>
          {local ? date(t.synced_at) : "N/A"}
        </td>
      )}
    </TicketTableRow>
  );
}
