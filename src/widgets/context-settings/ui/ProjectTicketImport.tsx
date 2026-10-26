import { SyncScheduleSettings } from "../../../entities/schedule/index.js";
import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { useEffect, useState } from "react";
import { TicketImportSettings } from "./TicketImportSettings.js";
import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";
import { api } from "../../../shared/api/http/index.js";
export function ProjectTicketImport({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api(
      "/context/ticket-import?" + new URLSearchParams(context),
      "GET",
      undefined,
      controller.signal,
    )
      .then(setForm)
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [context.client, context.project]);
  if (!context.client || !context.project)
    return (
      <p className="muted">
        Выберите заказчика и проект для настройки автоматического импорта.
      </p>
    );
  return (
    <form
      className="project-import-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!form) return;
        setBusy(true);
        setMessage("");
        try {
          const {
            azureAutoImport,
            azureImportAssignees,
            azureTypes,
            azureStates,
            typeColors,
            statusColors,
            syncSchedule,
            syncSeconds,
          } = form;
          await api("/context/ticket-import", "PUT", {
            context,
            azureAutoImport,
            azureImportAssignees,
            azureTypes,
            azureStates,
            typeColors,
            statusColors,
            syncSchedule,
            syncSeconds,
          });
          setMessage("Настройки импорта проекта сохранены.");
          onSaved();
        } catch (error: any) {
          setMessage(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {form && (
        <fieldset disabled={busy} className="project-import-fields">
          <div className="settings-group">
            <h3>Автоматическая синхронизация</h3>
            <SyncScheduleSettings
              value={form.syncSchedule}
              onChange={(syncSchedule) =>
                setForm((previous: any) => ({ ...previous, syncSchedule }))
              }
            />
            <label>
              Обновлять тикеты и PR каждые, минут
              <NumberInput
                min={1}
                max={60}
                step="any"
                value={form.syncSeconds / 60}
                onChange={(e) =>
                  setForm((previous: any) => ({
                    ...previous,
                    syncSeconds: Math.round(Number(e.target.value) * 60),
                  }))
                }
              />
            </label>
            <p className="muted">
              Расписание выбранного проекта. Интервал от 1 до 60 минут
              отсчитывается после завершения прохода. Часовой пояс задаётся в
              «Настройки → Календарь». Ручная синхронизация доступна вне
              расписания.
            </p>
          </div>
          <TicketImportSettings
            form={form}
            set={(key, value) =>
              setForm((previous: any) => ({ ...previous, [key]: value }))
            }
          />
          <ContextSaveButton type="submit" busy={busy} />
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
