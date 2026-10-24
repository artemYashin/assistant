import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarDays, ShieldCheck, X } from "lucide-react";
import { api } from "./api.js";
import { calendarStatus, type CalendarItem } from "../server/calendar-model.js";
import { eventTime } from "./calendar-time.js";
import { statusLabels } from "./CalendarPage.js";

function ReminderToast({
  items,
  onClose,
  onOpen,
}: {
  items: CalendarItem[];
  onClose: () => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  useEffect(() => {
    const el = ref.current!;
    const started = Date.now();
    const raise = (modal?: HTMLDialogElement) => {
      if (el.matches(":popover-open")) el.hidePopover();
      const parent =
        modal ||
        (host.closest("dialog:modal") as HTMLDialogElement | null) ||
        [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(
          -1,
        ) ||
        document.body;
      parent.appendChild(host);
      el.showPopover();
      const progress = el.querySelector<HTMLElement>(
        ".calendar-toast-progress",
      );
      if (progress)
        progress.style.animationDelay = `-${Date.now() - started}ms`;
    };
    raise();
    const timer = setTimeout(onClose, 10000);
    // Native dialogs/popovers share the browser top layer, beyond any z-index.
    const observer = new MutationObserver((records) => {
      const changed = records.filter(
        (r) => r.type === "attributes" && r.target instanceof HTMLDialogElement,
      );
      if (!host.isConnected || changed.length)
        raise(
          changed
            .map((r) => r.target as HTMLDialogElement)
            .filter((d) => d.open)
            .at(-1),
        );
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    const onToggle = (event: Event) => {
      if (event.target !== el && (event as ToggleEvent).newState === "open")
        raise();
    };
    document.addEventListener("toggle", onToggle, true);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("toggle", onToggle, true);
      if (el.matches(":popover-open")) el.hidePopover();
      host.remove();
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      popover="manual"
      className="calendar-toast"
      role="status"
      aria-live="polite"
    >
      <button
        className="calendar-toast-close icon-button"
        aria-label="Закрыть уведомление"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <div className="calendar-inline">
        <Bell size={20} />
        <strong>Обратите внимание</strong>
      </div>
      {items.slice(0, 3).map((item) => (
        <button
          className="calendar-toast-item"
          key={item.id}
          onClick={() => onOpen(item)}
        >
          {item.title}
        </button>
      ))}
      {items.length > 3 && (
        <small>И ещё {items.length - 3} напоминаний в уведомлениях</small>
      )}
      <div className="calendar-toast-progress" />
    </div>,
    host,
  );
}
export function CalendarNotifications({
  settings,
  pending,
}: {
  settings: any;
  pending: number;
}) {
  const [items, setItems] = useState<CalendarItem[]>([]),
    [toasts, setToasts] = useState<CalendarItem[]>([]),
    [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const panel = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const zone = settings?.syncSchedule?.timeZone || "UTC";
  const closeToast = useRef(() => setToasts([])).current;
  const go = (item: CalendarItem) => {
    panel.current?.close();
    setToasts([]);
    navigate("/calendar?event=" + encodeURIComponent(item.id));
  };
  useEffect(() => {
    if (!settings) return;
    let alive = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const data = await api("/calendar");
        if (!alive) return;
        setItems(data.items.filter((i: CalendarItem) => !i.completed));
        setError("");
        const due: CalendarItem[] = await api(
          "/calendar/notifications/claim",
          "POST",
          {},
        );
        if (!alive) return;
        if (due.length) {
          setToasts(due);
          setVersion((n) => n + 1);
          if (
            settings.calendarNotifications?.browser &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            try {
              const note = new Notification(
                due.length === 1
                  ? due[0].title
                  : `Напоминания Orbit: ${due.length}`,
                {
                  body:
                    due.length === 1
                      ? eventTime(due[0].start, due[0].end, zone)
                      : due
                          .slice(0, 3)
                          .map((i) => i.title)
                          .join("\n"),
                  tag: "orbit-reminders",
                },
              );
              note.onclick = () => {
                window.focus();
                go(due[0]);
                note.close();
              };
            } catch {
              setError(
                "Системное уведомление не удалось показать. Напоминания доступны здесь.",
              );
            }
          }
        }
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        running = false;
      }
    };
    poll();
    const timer = setInterval(poll, 15000);
    window.addEventListener("orbit-calendar-changed", poll);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("orbit-calendar-changed", poll);
    };
  }, [
    !!settings,
    settings?.calendarNotifications?.browser,
    JSON.stringify(settings?.calendarNotifications),
    zone,
  ]);
  return (
    <>
      <button
        className="icon-button"
        title="Уведомления"
        aria-label={`Уведомления: ${pending + items.length}`}
        onClick={() => {
          panel.current?.showModal();
        }}
      >
        <Bell size={18} />
        {(pending > 0 || items.length > 0) && (
          <i className="notification-dot" />
        )}
      </button>
      <dialog ref={panel} className="calendar-notification-panel">
        <div className="developer-dialog-heading">
          <h2>Уведомления</h2>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => panel.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {pending > 0 && (
          <button
            className="calendar-notification-row"
            onClick={() => {
              panel.current?.close();
              navigate("/approvals");
            }}
          >
            <ShieldCheck size={20} />
            <span>
              Ожидают подтверждения <b>{pending}</b>
            </span>
          </button>
        )}
        <h3>
          <CalendarDays size={17} />
          Напоминания <span className="badge">{items.length}</span>
        </h3>
        {items.map((item) => (
          <button
            className="calendar-notification-row"
            key={item.id}
            onClick={() => go(item)}
          >
            <CalendarDays size={18} />
            <span>
              <strong>{item.title}</strong>
              <small>{eventTime(item.start, item.end, zone)}</small>
            </span>
            <span className={"calendar-state " + calendarStatus(item)}>
              {statusLabels[calendarStatus(item)]}
            </span>
          </button>
        ))}
        {!items.length && !pending && (
          <p className="muted">Новых уведомлений нет.</p>
        )}
      </dialog>
      {!!toasts.length && (
        <ReminderToast
          key={version}
          items={toasts}
          onClose={closeToast}
          onOpen={go}
        />
      )}
    </>
  );
}
