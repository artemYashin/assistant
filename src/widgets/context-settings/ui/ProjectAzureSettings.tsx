import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";
import { useEffect, useState } from "react";
import { Folder, Globe, Users } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";

function AzureConnectionForm({
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
    setLoaded(false); setMessage("");
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
            "Подключение Azure сохранено. Если оно изменилось, проверьте и сохраните настройки в разделе «Репозиторий».",
          );
          onSaved();
        } catch (error: any) {
          setMessage(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!!context.client && <label className="checkbox-row azure-inherit-toggle">
        <input
          type="checkbox"
          checked={inherit}
          disabled={!loaded || busy}
          onChange={(event) => setInherit(event.target.checked)}
        />
        <Globe size={16} aria-hidden="true" />
        <span>Использовать глобальные настройки Azure</span>
      </label>}
      <p className="muted">{!context.client ? "Подключение по умолчанию для заказчиков и проектов, использующих глобальные настройки." : inherit ? "Ниже показано глобальное подключение. Снимите галочку, чтобы задать отдельный URL и проект Azure." : "Отдельное подключение для выбранного заказчика или проекта Orbit."}</p>
        <>
          <label>
            URL организации / коллекции
            <input
              type="url"
              value={inherit ? parent.azureUrl : url}
              required
              disabled={!loaded || busy || inherit}
              maxLength={2000}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            Проект в Azure DevOps
            <input
              value={inherit ? parent.azureProject : project}
              disabled={!loaded || busy || inherit}
              required
              maxLength={200}
              placeholder="Например, RACID"
              onChange={(event) => setProject(event.target.value)}
            />
          </label>
        </>
      {/\.mcas\./i.test(inherit ? parent.azureUrl : url) && <p role="status" className="error">Это адрес корпоративного прокси MCAS. Для API обычно нужен исходный адрес организации, например https://dev.azure.com/DevOpsAD. Уточните доступ к нему по правилам вашей компании.</p>}
      {/%[0-9a-f]{2}/i.test(inherit ? parent.azureProject : project) && <p role="status" className="error">В поле проекта укажите обычное название, не часть URL: например HSE Cockpit с пробелом вместо HSE%20Cockpit.</p>}
      <p className="muted">
        Название Project, содержащего Boards и Repos. PAT задаётся в общих
        настройках приложения.
      </p>

      {message && <p role="status">{message}</p>}
      <div className="context-save-actions">
        <ContextSaveButton type="submit" busy={busy} disabled={!loaded || (!inherit && (!project.trim() || !url.trim()))} />
      </div>
    </form>
  );
}

export function ProjectAzureSettings({ context, onSaved }: { context: { client: string; project: string }; onSaved: () => void }) {
  const [global, setGlobal] = useState(!context.client);
  const scope = global || !context.client ? { client: "", project: "" } : context;
  return <>
    <div className="context-manager-nav" aria-label="Область подключения Azure">
      <button type="button" aria-pressed={global || !context.client} onClick={() => setGlobal(true)}><Globe size={16} aria-hidden="true" />Глобальные настройки</button>
      {!!context.client && <button type="button" aria-pressed={!global} onClick={() => setGlobal(false)}>{context.project ? <Folder size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}{context.project ? "Выбранный проект" : "Выбранный заказчик"}</button>}
    </div>
    <AzureConnectionForm key={JSON.stringify(scope)} context={scope} onSaved={onSaved} />
  </>;
}
