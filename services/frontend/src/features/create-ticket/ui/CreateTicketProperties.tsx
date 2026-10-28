import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";
import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { TagsEditor } from "../../../shared/ui/tags-editor/index.js";
import { CalendarDateField } from "../../../entities/calendar/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import {
  developerOnVacation,
  developerVacationStatus,
  nextVacationDay,
} from "../../../entities/developer/index.js";

export type CreateProperties = {
  state: string;
  priority: string;
  azurePriority: string;
  tags: string;
  azureTags: string;
  developerIds: string[];
  localDeadline: string;
};
export const emptyProperties: CreateProperties = {
  state: "",
  priority: "1",
  azurePriority: "",
  tags: "",
  azureTags: "",
  developerIds: [],
  localDeadline: "",
};
export function CreateTicketProperties({
  value,
  onChange,
  fields,
  states,
  settings,
  developers,
  knownTags,
  knownAzureTags,
  management,
  disabled,
}: {
  value: CreateProperties;
  onChange: (value: CreateProperties) => void;
  fields: string[];
  states: string[];
  settings: any;
  developers: any[];
  knownTags: string[];
  knownAzureTags: string[];
  management: boolean;
  disabled: boolean;
}) {
  const set = <K extends keyof CreateProperties>(key: K, next: CreateProperties[K]) =>
    onChange({ ...value, [key]: next });
  const now = new Date().toISOString();
  return (
    <>
      {fields.includes("System.State") && (
        <SingleSelect
          floating
          label="Статус Azure"
          value={value.state}
          options={[
            { value: "", label: "По умолчанию Azure" },
            ...states.map((state) => ({ value: state, label: state })),
          ]}
          onChange={(state) => set("state", state)}
          disabled={disabled}
          renderOption={(option) =>
            option.value ? (
              <StatusBadge state={option.value} colors={settings?.statusColors} />
            ) : (
              option.label
            )
          }
        />
      )}
      <label>
        Локальный приоритет
        <NumberInput
          value={value.priority}
          min={1}
          step={1}
          max={Number.MAX_SAFE_INTEGER}
          disabled={disabled}
          onChange={(event) => set("priority", event.target.value)}
        />
      </label>
      {fields.includes("Microsoft.VSTS.Common.Priority") && (
        <label>
          Azure приоритет
          <NumberInput
            value={value.azurePriority}
            min={1}
            step={1}
            max={Number.MAX_SAFE_INTEGER}
            placeholder="По умолчанию Azure"
            disabled={disabled}
            onChange={(event) => set("azurePriority", event.target.value)}
          />
        </label>
      )}
      <TagsEditor
        label="Локальные теги"
        value={value.tags}
        onChange={(tags) => set("tags", tags)}
        disabled={disabled}
        known={knownTags}
      />
      {fields.includes("System.Tags") && (
        <TagsEditor
          label="Azure теги"
          known={knownAzureTags}
          forbidSemicolon
          maxTags={100}
          maxLength={400}
          value={value.azureTags}
          onChange={(tags) => set("azureTags", tags)}
          disabled={disabled}
        />
      )}
      {management && (
        <MultiSelect
          floating
          label="Локальное поручение"
          placeholder="Не назначено"
          options={developers.map((p) => ({ value: p.id, label: p.name }))}
          value={value.developerIds}
          onChange={(ids) => set("developerIds", ids)}
          disabled={disabled}
          renderOption={(option) => {
            const person = developers.find((p) => p.id === option.value);
            const vacation = person && developerOnVacation(person, now);
            const soon =
              person &&
              developerVacationStatus(person, now) === "upcoming" &&
              person.vacationWarningStart &&
              Date.parse(now) >= Date.parse(person.vacationWarningStart);
            return (
              <span className="create-ticket-person">
                <InitialsAvatar name={option.label} />
                <span>
                  {option.label}
                  {(vacation || soon) && (
                    <small className="local-developer-vacation">
                      {vacation ? "В отпуске" : "Скоро в отпуск"} · {person.vacationStart} —{" "}
                      {person.vacationEnd} · Возвращение {nextVacationDay(person.vacationEnd)}
                    </small>
                  )}
                </span>
              </span>
            );
          }}
        />
      )}
      <CalendarDateField
        label="Локальный дедлайн"
        zone={settings?.syncSchedule?.timeZone || "UTC"}
        value={value.localDeadline}
        onChange={(date) => set("localDeadline", date)}
        disabled={disabled}
      />
    </>
  );
}
