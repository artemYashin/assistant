import { OverviewUsage } from "../../widgets/overview-usage/index.js";
import { OverviewActivity } from "../../widgets/overview-activity/index.js";
import { type Page } from "../../shared/config/routes/index.js";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  GitPullRequest,
  Github,
  RefreshCw,
  Ticket,
} from "lucide-react";
import { api } from "../../shared/api/http/index.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<
  WorkspaceState,
  | "page"
  | "context"
  | "connected"
  | "setPage"
  | "busy"
  | "run"
  | "tickets"
  | "overview"
  | "memories"
>;

export function OverviewBlock({
  page,
  context,
  connected,
  setPage,
  busy,
  run,
  tickets,
  overview,
  memories,
}: Props) {
  return (
    <>
      {page === "overview" && (
        <>
          <div className="page-heading">
            <div>
              <h1>Обзор</h1>
              <p>Тикеты, pull requests и знания вашего рабочего пространства.</p>
            </div>
            <div className="overview-toolbar">
              <div className="overview-connections" aria-label="Подключения">
                {[
                  { name: "Copilot", icon: Github },
                  { name: "DevOps", icon: Ticket },
                ].map((item, index) => (
                  <button
                    type="button"
                    key={item.name}
                    className={`overview-connection${connected[index] ? " is-connected" : ""}`}
                    onClick={() => setPage("settings")}
                    title={`${item.name}: ${connected[index] ? (index === 1 ? "подключение настроено" : "подключено") : "не подключено"}`}
                    aria-label={`${item.name}: ${connected[index] ? "подключение настроено" : "не подключено"}. Открыть настройки`}
                  >
                    <item.icon size={15} /> {item.name}{" "}
                    {connected[index] ? <Check size={14} /> : <ArrowUpRight size={14} />}
                  </button>
                ))}
              </div>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "sync",
                    () => api("/sync", "POST", {}),
                    "Синхронизация завершена. Статус — ниже.",
                  )
                }
              >
                <RefreshCw size={16} className={busy === "sync" ? "spin" : ""} />
                Обновить
              </button>
            </div>
          </div>
          <div className="stats-grid overview-stats">
            {[
              {
                label: "Тикеты",
                value: tickets.length,
                icon: Ticket,
                target: "tickets",
                note: "в локальном трекере, без корзины",
              },
              {
                label: "Pull requests",
                value: overview.pullRequests ?? 0,
                icon: GitPullRequest,
                target: "pullrequests",
                note: "активные в выбранном контексте",
              },
              {
                label: "В памяти",
                value: memories.length,
                icon: BookOpen,
                target: "memory",
                note: "в выбранном контексте",
              },
            ].map((s) => (
              <button className="stat-card" key={s.label} onClick={() => setPage(s.target as Page)}>
                <span>
                  {s.label}
                  <s.icon size={18} />
                </span>
                <strong>{s.value.toString().padStart(2, "0")}</strong>
                <small>
                  {s.note}
                  <ArrowUpRight size={14} />
                </small>
              </button>
            ))}
          </div>
          <OverviewUsage usage={overview.usage} />
          <section className="panel activity-panel">
            <div className="section-heading">
              <h2>Последняя активность</h2>
            </div>
            <OverviewActivity
              context={context}
              audit={overview.activity || []}
              requests={overview.usage?.recent || []}
              tickets={tickets}
            />
          </section>
        </>
      )}
    </>
  );
}
