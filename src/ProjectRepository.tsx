import { useEffect, useState } from "react";
import { api } from "./api.js";
export function ProjectRepository({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved?: () => void;
}) {
  const [ignoredPaths, setIgnoredPaths] = useState("");
  const [diffBudget, setDiffBudget] = useState(160000);
  const [loaded, setLoaded] = useState(false);
  const [repo, setRepo] = useState(""),
    [all, setAll] = useState(false),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setRepo("");
    setLoaded(false);
    setIgnoredPaths("");
    setDiffBudget(160000);
    setMessage("");
    api("/pr/projects")
      .then((items: any[]) => {
        if (!live) return;
        const m =
          items.find(
            (m) =>
              m.client === context.client &&
              m.project === context.project &&
              m.enabled,
          ) ||
          items.find(
            (m) => m.client === context.client && m.project === context.project,
          );
        if (m) {
          const rules = JSON.parse(m.review_files || "{}");
          setIgnoredPaths((rules.ignoredPaths || []).join("\n"));
          setDiffBudget(rules.diffBudget || 160000);
          setRepo(m.repository || "");
          setAll(m.mode === "all");
          setEnabled(!!m.enabled);
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  if (!context.client || !context.project)
    return (
      <p className="muted">
        Выберите заказчика и проект для настройки репозитория.
      </p>
    );
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await api("/pr/projects", "POST", {
            ...context,
            repository: repo.trim(),
            mode: all ? "all" : "required",
            enabled,
            reviewFiles: {
              ignoredPaths: ignoredPaths
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean),
              diffBudget,
            },
          });
          setMessage(
            "Репозиторий сохранён. Запустите синхронизацию или дождитесь следующего опроса.",
          );
          onSaved?.();
        } catch (e: any) {
          setMessage(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        Git-репозиторий · {context.client} / {context.project}
      </h3>
      <label>
        Git-репозиторий
        <input
          required
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="Точное имя или ID репозитория"
          maxLength={200}
        />
      </label>
      <p className="muted">
        Проект Azure DevOps, организация/коллекция и PAT берутся из общих
        настроек Azure. Синхронизируются только активные PR этого репозитория.
        Смена репозитория сохраняет старые результаты ревью.
      </p>
      <label>
        Исключить из ревью и View Diff (один путь или шаблон на строку)
        <textarea
          rows={6}
          value={ignoredPaths}
          maxLength={30100}
          onChange={(e) => setIgnoredPaths(e.target.value)}
          placeholder={
            "src/api/generated/\nsrc/api/client.ts\n**/*.generated.ts"
          }
        />
      </label>
      <p className="muted">
        Пути от корня репозитория. * — часть имени, ** — любые папки. Путь с /
        на конце исключает всю папку. Настройки общие для ревью и View Diff,
        включая просмотр отдельных коммитов. До 100 правил.
      </p>
      <label>
        Общий лимит diff для ревью и просмотра (символы)
        <input
          type="number"
          min={40000}
          max={400000}
          step={1000}
          value={diffBudget}
          onChange={(e) => setDiffBudget(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        По умолчанию 160 000 символов; на один файл — не больше четверти лимита.
        Увеличение расходует больше токенов. При пропуске файлов ревью укажет
        причину. Лимит 100 файлов применяется после исключений.
      </p>
      <label className="check-option">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        Все активные PR (без галочки — только лично назначенные вам как required
        reviewer)
      </label>
      <label className="check-option">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Синхронизировать PR
      </label>
      <button className="secondary" disabled={busy || !loaded}>
        {busy ? "Сохраняю…" : "Сохранить репозиторий проекта"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
