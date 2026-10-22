import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitBranch, Check, Copy } from "lucide-react";
export function BranchLabel({
  kind,
  value,
  client, project, onNavigate, disabled = false,
}: {
  kind: "source" | "target" | "ветка";
  value?: string;
  client: string; project: string; onNavigate?: () => void; disabled?: boolean;
}) {
  const name = value?.replace(/^refs\/heads\//, "") || "";
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    setStatus("idle");
  }, [value]);
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <span
      className="pr-branch"
      title={`${kind} branch: ${value || "пока не загружена"}`}
    >
      <small>{kind}</small>
      <span className="pr-branch-value">
        {name && client && project && !disabled ? <Link className="pr-branch-link" to={`/code?${new URLSearchParams({ client, project, branch: name })}`} onClick={onNavigate} title={`Открыть ветку ${name}`}><GitBranch size={14} aria-hidden="true" /><span>{name}</span></Link> : <span className="pr-branch-link is-unavailable"><GitBranch size={14} aria-hidden="true" /><span>{name || "—"}</span></span>}
        <button
          type="button"
          className="text-button"
          disabled={!name}
          aria-label={`Скопировать ${kind} ветку ${name}`}
          title={
            status === "copied" ? "Скопировано" : "Скопировать название ветки"
          }
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(name);
              setStatus("copied");
            } catch {
              setStatus("error");
            }
          }}
        >
          {status === "copied" ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </span>
      <small role="status">
        {status === "copied"
          ? "Скопировано"
          : status === "error"
            ? "Не удалось скопировать"
            : ""}
      </small>
    </span>
  );
}

