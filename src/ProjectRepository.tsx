import { useEffect, useState } from "react";
import { api } from "./api.js";
export function ProjectRepository({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved?: () => void;
}) {
  const [project, setProject] = useState(""),
    [repo, setRepo] = useState(""),
    [all, setAll] = useState(false),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setProject("");
    setRepo("");
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
          setProject(m.azure_project);
          setRepo(m.repository || "");
          setAll(m.mode === "all");
          setEnabled(!!m.enabled);
        }
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
            azure_project: project.trim(),
            repository: repo.trim(),
            mode: all ? "all" : "required",
            enabled,
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
      <div className="form-grid">
        <label>
          Azure DevOps Project
          <input
            required
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="Название проекта Azure"
            maxLength={200}
          />
        </label>
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
      </div>
      <p className="muted">
        Организация/коллекция и PAT берутся из настроек Azure. Синхронизируются
        только активные PR этого репозитория. Смена репозитория сохраняет старые
        результаты ревью.
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
      <button className="secondary" disabled={busy}>
        {busy ? "Сохраняю…" : "Сохранить репозиторий проекта"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
