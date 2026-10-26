import { hasLocalManagement } from "../../../server/work-mode.js";
import { Link } from "react-router-dom";
import { pagePaths } from "../../shared/config/routes/index.js";
import { Settings2, Sparkles, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navigation } from "../config/navigation.js";
import { Mark } from "./Mark.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<WorkspaceState,
  "settings"
  | "sidebarCollapsed"
  | "setSidebarCollapsed"
  | "page"
  | "memoryProposals"
  | "unreadRelease"
>;

export function WorkspaceSidebar({
  settings,
  sidebarCollapsed,
  setSidebarCollapsed,
  page,
  memoryProposals,
  unreadRelease,
}: Props) {
  return (<aside
        className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
        aria-label="Основная навигация"
      >
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          aria-expanded={!sidebarCollapsed}
          aria-label={
            sidebarCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"
          }
          title={sidebarCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={19} />
          ) : (
            <PanelLeftClose size={19} />
          )}
          <span className="sidebar-text">Свернуть меню</span>
        </button>
        <div className="brand">
          <Mark />
          <b>
            orbit<span>personal workspace</span>
          </b>
        </div>
        <div className="nav-title">РАБОЧИЙ ДЕНЬ</div>
        <nav>
          {navigation
            .filter((n) => !["inbox"].includes(n.id) && (n.id!=="developers" || hasLocalManagement(settings)))
            .map((n) => (
              <Link
                key={n.id}
                to={pagePaths[n.id]}
                title={n.label}
                aria-label={n.label}
                aria-current={page === n.id ? "page" : undefined}
                className={page === n.id ? "active" : ""}
              >
                <n.icon
                  size={19}
                  className={`sidebar-icon sidebar-icon-${n.id}`}
                />
                <span className="sidebar-text">{n.label}</span>
                {n.id === "approvals" &&
                    memoryProposals.filter((p) => p.status === "pending")
                      .length >
                    0 && (
                    <span className="nav-count">
                      {memoryProposals.filter((p) => p.status === "pending")
                          .length}
                    </span>
                  )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link
            to={pagePaths.settings}
            title="Настройки"
            aria-label="Настройки"
            aria-current={page === "settings" ? "page" : undefined}
            className={page === "settings" ? "active" : ""}
          >
            <Settings2
              size={19}
              className="sidebar-icon sidebar-icon-settings"
            />
            <span className="sidebar-text">Настройки</span>
          </Link>
          <Link
            to={pagePaths.updates}
            title="Что нового"
            aria-label="Что нового"
            aria-current={page === "updates" ? "page" : undefined}
            className={page === "updates" ? "active" : ""}
          >
            <Sparkles size={19} className="sidebar-icon sidebar-icon-updates" />
            <span className="sidebar-text">Что нового</span>
            {unreadRelease && <span className="updates-unread" role="status" aria-label="Есть непрочитанное обновление" title="Есть непрочитанное обновление" />}
          </Link>

        </div>
      </aside>);
}
