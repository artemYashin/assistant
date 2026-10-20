import { useEffect, useState } from "react";
import { api } from "./api.js";

export function ProjectAzureSettings({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  const [inherit, setInherit] = useState(true);
  const [parent, setParent] = useState({ azureUrl: "", azureProject: "" });
  const [project, setProject] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    api(`/context/azure?${new URLSearchParams(context)}`)
      .then((result) => {
        if (live) {
          setProject(result.azureProject);
          setUrl(result.azureUrl);
          setInherit(result.inherit);
          setParent(result.parent);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (live) setMessage(error.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  return (
    <form
      className="context-create-form context-azure-settings"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await api("/context/azure", "PUT", {
            ...context,
            azureProject: project.trim(),
            azureUrl: url.trim(),
            inherit,
          });
          setMessage(
            "Проект Azure DevOps сохранён. Если он изменился, укажите и сохраните репозиторий в разделе «Репозиторий».",
          );
          onSaved();
        } catch (error: any) {
          setMessage(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={inherit}
          disabled={!loaded || busy}
          onChange={(event) => setInherit(event.target.checked)}
        />
        {context.project
          ? "Использовать настройки заказчика"
          : "Использовать общие настройки"}
      </label>
      {inherit ? (
        <p className="muted">
          {parent.azureUrl || "URL не задан"} ·{" "}
          {parent.azureProject || "Проект не задан"}
        </p>
      ) : (
        <>
          <label>
            URL организации / коллекции
            <input
              type="url"
              value={url}
              required
              disabled={!loaded || busy}
              maxLength={2000}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            Проект в Azure DevOps
            <input
              value={project}
              disabled={!loaded || busy}
              required
              maxLength={200}
              placeholder="Например, RACID"
              onChange={(event) => setProject(event.target.value)}
            />
          </label>
        </>
      )}
      <p className="muted">
        Название Project, содержащего Boards и Repos. PAT задаётся в общих
        настройках приложения.
      </p>
      <button
        className="primary"
        disabled={
          !loaded || busy || (!inherit && (!project.trim() || !url.trim()))
        }
      >
        {busy ? "Сохраняю…" : "Сохранить"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
