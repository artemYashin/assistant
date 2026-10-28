import { createPortal } from "react-dom";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
type Group = {
  id: string;
  name: string;
  states: string[];
  color?: string | null;
  defaultState: string;
};
import { StatusBadge } from "../../../entities/ticket/index.js";
import { useStatusSort } from "../model/useStatusSort.js";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Folder, GripVertical, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";

export function ProjectKanban({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved: () => void;
}) {
  const checkboxId = useId();
  const [order, setOrder] = useState<string[] | null>(null);
  const [hideEmptyColumns, setHideEmptyColumns] = useState(false);
  const [filterColumnsByStatus, setFilterColumnsByStatus] = useState(false);
  const [hiddenStates, setHiddenStates] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Group | null>(null);
  const groupDialog = useRef<HTMLDialogElement>(null);
  const groupOpen = draft !== null;
  useEffect(() => {
    if (groupOpen) groupDialog.current?.showModal();
  }, [groupOpen]);
  const [catalogStates, setCatalogStates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      client: context.client,
      project: context.project,
    }).toString();
    Promise.all([
      api(`/context/kanban?${query}`, "GET", undefined, controller.signal),
      api(`/tickets/filter-options?${query}`, "GET", undefined, controller.signal),
    ])
      .then(([saved, catalog]) => {
        if (!controller.signal.aborted) {
          const loadedGroups: Group[] = saved.groups || [];
          const members = new Set(loadedGroups.flatMap((group) => group.states));
          const available = [
            ...new Set<string>([
              ...saved.order.filter((id: string) => !id.startsWith("group:")),
              ...(saved.hiddenStates || []),
              ...catalog.states.filter(Boolean),
              ...members,
            ]),
          ];
          setCatalogStates(available);
          setGroups(loadedGroups);
          setDraft(null);
          setOrder(
            [
              ...new Set<string>([
                ...saved.order,
                ...loadedGroups.map((group) => group.id),
                ...available,
              ]),
            ].filter((id) => !members.has(id)),
          );
          setColors(saved.statusColors || {});
          setHiddenStates(saved.hiddenStates || []);
          setFilterColumnsByStatus(saved.filterColumnsByStatus ?? false);
          setHideEmptyColumns(saved.hideEmptyColumns ?? false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [context.client, context.project]);
  function move(from: number, to: number) {
    setOrder((previous) => {
      if (!previous || from < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    setMessage("");
  }
  const sort = useStatusSort(move);
  if (!context.client || !context.project)
    return <p className="muted">Выберите заказчика и проект для настройки канбана.</p>;
  return (
    <form
      className="project-import-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!order || busy || sort.dragging || draft) return;
        setBusy(true);
        setError("");
        setMessage("");
        try {
          await api("/context/kanban", "PUT", {
            context,
            order,
            groups,
            hiddenStates,
            filterColumnsByStatus,
            hideEmptyColumns,
          });
          setMessage("Настройки канбана сохранены.");
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сохранить настройки.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Канбан · столбцы</h3>
      <div className="project-kanban-options">
        <label className="project-kanban-filter-toggle">
          <input
            type="checkbox"
            aria-label="Фильтр статуса скрывает столбцы канбана"
            checked={filterColumnsByStatus}
            disabled={busy || sort.dragging || !!draft}
            onChange={(event) => {
              setFilterColumnsByStatus(event.target.checked);
              setMessage("");
            }}
          />
          <span>
            <strong>Фильтр статуса скрывает столбцы канбана</strong>
            <small>Показывать только столбцы выбранных в фильтре статусов.</small>
          </span>
        </label>
        <label className="project-kanban-filter-toggle">
          <input
            type="checkbox"
            aria-label="Скрывать пустые столбцы"
            checked={hideEmptyColumns}
            disabled={busy || sort.dragging || !!draft}
            onChange={(event) => {
              setHideEmptyColumns(event.target.checked);
              setMessage("");
            }}
          />
          <span>
            <strong>Скрывать пустые столбцы</strong>
            <small>Скрывать столбцы без карточек с учётом текущего поиска и фильтров.</small>
          </span>
        </label>
      </div>
      <button
        type="button"
        className="secondary"
        disabled={busy || sort.dragging || !order || !!draft}
        onClick={() => {
          setDraft({ id: `group:${crypto.randomUUID()}`, name: "", states: [], defaultState: "" });
          setMessage("");
        }}
      >
        <Folder size={16} aria-hidden="true" />
        Добавить группу
      </button>
      <p className="muted">
        Сверху вниз — порядок столбцов слева направо. Перетаскивайте за ручку. Нажмите на строку,
        чтобы показать или скрыть столбец.
      </p>
      {draft &&
        createPortal(
          <dialog
            ref={groupDialog}
            className="developer-dialog project-kanban-group-dialog"
            aria-label={
              groups.some((group) => group.id === draft.id) ? "Изменить группу" : "Добавить группу"
            }
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            }}
          >
            <div className="developer-dialog-heading">
              <h3>
                {groups.some((group) => group.id === draft.id)
                  ? "Изменить группу"
                  : "Добавить группу"}
              </h3>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть редактор группы"
                onClick={() => setDraft(null)}
              >
                <X size={18} />
              </button>
            </div>
            <section className="project-kanban-group-editor">
              <label>
                Название группы
                <input
                  value={draft.name}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <div className="project-kanban-group-color">
                <label>
                  Цвет группы
                  <input
                    type="color"
                    value={draft.color || "#587746"}
                    onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                  />
                </label>
                <StatusBadge
                  state={draft.name || "Группа"}
                  colors={draft.color ? { [draft.name || "Группа"]: draft.color } : {}}
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={!draft.color}
                  onClick={() => setDraft({ ...draft, color: null })}
                >
                  Сбросить цвет
                </button>
              </div>
              <MultiSelect
                label="Статусы группы"
                floating
                placeholder="Выберите статусы"
                disabled={busy}
                value={draft.states}
                options={catalogStates
                  .filter(
                    (state) =>
                      !groups.some(
                        (group) => group.id !== draft.id && group.states.includes(state),
                      ),
                  )
                  .map((state) => ({ value: state, label: state }))}
                renderOption={(option) => <StatusBadge state={option.value} colors={colors} />}
                renderSelected={(option) => <StatusBadge state={option.value} colors={colors} />}
                onChange={(states) =>
                  setDraft({
                    ...draft,
                    states,
                    defaultState: states.includes(draft.defaultState)
                      ? draft.defaultState
                      : states[0] || "",
                  })
                }
              />
              <SingleSelect
                label="Статус по умолчанию при переносе"
                floating
                value={draft.defaultState}
                disabled={busy || !draft.states.length}
                options={draft.states.map((state) => ({ value: state, label: state }))}
                renderOption={(option) => <StatusBadge state={option.value} colors={colors} />}
                onChange={(defaultState) => setDraft({ ...draft, defaultState })}
              />
              <div className="project-kanban-group-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busy || !draft.name.trim() || !draft.states.length || !draft.defaultState
                  }
                  onClick={() => {
                    const previous = groups.find((group) => group.id === draft.id);
                    const next = { ...draft, name: draft.name.trim() };
                    setGroups([...groups.filter((group) => group.id !== draft.id), next]);
                    setOrder((current) => {
                      const rows = current || [];
                      const insertion = rows.findIndex(
                        (id) => id === draft.id || draft.states.includes(id),
                      );
                      const remaining = rows.filter(
                        (id) => id !== draft.id && !draft.states.includes(id),
                      );
                      remaining.splice(Math.max(0, insertion), 0, draft.id);
                      return [
                        ...new Set([
                          ...remaining,
                          ...(previous?.states || []).filter(
                            (state) => !draft.states.includes(state),
                          ),
                        ]),
                      ];
                    });
                    setDraft(null);
                    setMessage("");
                  }}
                >
                  Применить группу
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Отмена
                </button>
                {groups.some((group) => group.id === draft.id) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      const group = groups.find((item) => item.id === draft.id)!;
                      setGroups(groups.filter((item) => item.id !== draft.id));
                      setOrder((current) =>
                        (current || []).flatMap((id) => (id === draft.id ? group.states : [id])),
                      );
                      setDraft(null);
                      setMessage("");
                    }}
                  >
                    Разгруппировать
                  </button>
                )}
              </div>
            </section>
          </dialog>,
          document.body,
        )}
      <div className="project-kanban-order" ref={sort.list}>
        {order?.map((state, index) => {
          const group = groups.find((item) => item.id === state);
          const members = group?.states || [state];
          const hidden = members.every((member) => hiddenStates.includes(member));
          const toggle = (visible: boolean) => {
            setHiddenStates((previous) =>
              visible
                ? previous.filter((item) => !members.includes(item))
                : [...new Set([...previous, ...members])],
            );
            setMessage("");
          };
          return (
            <div
              key={state}
              onClick={(event) => {
                if (
                  !busy &&
                  !sort.dragging &&
                  !draft &&
                  !(event.target as HTMLElement).closest("button,input,label")
                )
                  toggle(hidden);
              }}
              className={`project-kanban-order-row${sort.isActive(index) ? " is-dragging" : ""}${hidden ? " is-hidden" : ""}`}
              style={sort.style(index)}
            >
              <button
                type="button"
                className="icon-button project-kanban-drag-handle"
                aria-label={`Перетащить: ${group?.name || state}`}
                title="Перетащите для изменения порядка. Escape — отмена"
                disabled={busy || !!draft}
                {...sort.handlers(index)}
              >
                <GripVertical size={15} />
              </button>
              <input
                id={`${checkboxId}-${index}`}
                type="checkbox"
                aria-label={`Показывать в канбане: ${group?.name || state}`}
                checked={!hidden}
                ref={(input) => {
                  if (input)
                    input.indeterminate =
                      !hidden && members.some((member) => hiddenStates.includes(member));
                }}
                disabled={busy || sort.dragging || !!draft}
                onChange={(event) => toggle(event.target.checked)}
              />
              <span className="project-kanban-status">
                {group ? (
                  <>
                    <span className="project-kanban-group-name">
                      <StatusBadge
                        state={group.name}
                        icon={<Folder size={14} aria-hidden="true" />}
                        colors={group.color ? { [group.name]: group.color } : {}}
                      />
                    </span>
                    <span className="project-kanban-group-badges">
                      {members.map((member) => (
                        <StatusBadge key={member} state={member} colors={colors} />
                      ))}
                    </span>
                  </>
                ) : (
                  <StatusBadge state={state} colors={colors} />
                )}
              </span>
              {group && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || sort.dragging || !!draft}
                  onClick={() => setDraft({ ...group, states: [...group.states] })}
                >
                  Изменить
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Выше: ${group?.name || state}`}
                disabled={busy || sort.dragging || !!draft || index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Ниже: ${group?.name || state}`}
                disabled={busy || sort.dragging || !!draft || index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown size={16} />
              </button>
            </div>
          );
        })}
      </div>
      {order?.length === 0 && (
        <p className="muted">
          Статусы пока не загружены. Подключите Azure и загрузите справочник типов и статусов.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <ContextSaveButton type="submit" busy={busy} disabled={!order || sort.dragging || !!draft} />
    </form>
  );
}
