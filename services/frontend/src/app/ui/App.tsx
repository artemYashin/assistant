import { installDialogBackdropDismiss } from "../../shared/lib/dialog/index.js";
import { useEffect, useState } from "react";
import { api, setCsrf } from "../../shared/api/http/index.js";
import "../../style.css";
import { Mark } from "./Mark.js";
import { Workspace } from "./Workspace.js";

export function App() {
  useEffect(() => installDialogBackdropDismiss(document), []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/auth/session")
      .then(async (session) => {
        if (!session.authenticated) session = await api("/auth/local", "POST", {});
        setCsrf(session.csrf);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!ready)
    return (
      <div className="loading-page">
        <Mark />
        <p>{error || "Подключаем рабочее пространство…"}</p>
        {error && <button onClick={() => window.location.reload()}>Повторить</button>}
      </div>
    );
  return <Workspace />;
}
