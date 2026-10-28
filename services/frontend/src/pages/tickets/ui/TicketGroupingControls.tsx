import { useRef } from "react";
import { List, ListTree, Settings2, X, LoaderCircle, RefreshCw } from "lucide-react";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import type { useTicketGrouping } from "../model/useTicketGrouping.js";
import "./ticket-grouping.css";

export function TicketGroupingControls({
  grouping,
  types,
  colors,
}: {
  grouping: ReturnType<typeof useTicketGrouping>;
  types: string[];
  colors?: Record<string, string>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { preferences, update } = grouping;
  const allTypes = [...new Set([...types, ...preferences.parentTypes])].sort((a, b) =>
    a.localeCompare(b),
  );
  return (
    <>
      <div className="ticket-grouping-control">
        <div className="ticket-grouping-switch" role="group" aria-label="Группировка таблицы">
          <button
            type="button"
            aria-pressed={preferences.mode === "list"}
            onClick={() => update({ ...preferences, mode: "list" })}
          >
            <List size={15} />
            Список
          </button>
          <button
            type="button"
            aria-pressed={preferences.mode === "grouped"}
            onClick={() => update({ ...preferences, mode: "grouped" })}
          >
            <ListTree size={15} />
            Группировка
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Настройки группировки"
          aria-label="Настройки группировки"
          onClick={() => dialog.current?.showModal()}
        >
          <Settings2 size={17} />
        </button>
        {preferences.mode === "grouped" && (
          <button
            type="button"
            className="icon-button"
            title="Обновить связи"
            aria-label="Обновить связи"
            disabled={grouping.loading}
            onClick={grouping.refreshRelations}
          >
            <RefreshCw size={17} />
          </button>
        )}
        {preferences.mode === "grouped" && grouping.loading && (
          <LoaderCircle size={15} className="spin" aria-label="Загрузка дочерних тикетов" />
        )}
      </div>
      {preferences.mode === "grouped" && !preferences.parentTypes.length && (
        <span className="muted">Выберите родительские типы в настройках группировки.</span>
      )}
      {preferences.mode === "grouped" && grouping.error && (
        <span className="error" role="alert">
          {grouping.error}{" "}
          <button type="button" className="text-button" onClick={grouping.refreshRelations}>
            <RefreshCw size={14} />
            Повторить загрузку связей
          </button>
        </span>
      )}
      <dialog ref={dialog} className="ticket-grouping-dialog" aria-label="Настройки группировки">
        <header>
          <h3>Настройки группировки</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          Выберите типы родительских задач. Раскрытие показывает только прямые дочерние тикеты —
          включая неимпортированные и корзину, без фильтров страницы.
        </p>
        <MultiSelect
          floating
          label="Родительские типы задач"
          placeholder="Выберите типы"
          options={allTypes.map((type) => ({ value: type, label: type }))}
          value={preferences.parentTypes}
          onChange={(parentTypes) => update({ ...preferences, parentTypes })}
          renderOption={(option) => (
            <StatusBadge kind="type" state={option.label} colors={colors} />
          )}
          renderSelected={(option) => (
            <StatusBadge kind="type" state={option.label} colors={colors} />
          )}
        />
        <p className="muted">
          Один уровень вложенности. Настройки сохраняются автоматически для текущего заказчика,
          проекта и подключения Azure во всех трёх таблицах. Импортировать или восстанавливать детей
          для просмотра не нужно.
        </p>
        <footer>
          <button type="button" className="primary" onClick={() => dialog.current?.close()}>
            Готово
          </button>
        </footer>
      </dialog>
    </>
  );
}
