import { DailyCompletionButton } from "./DailyCompletionButton.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ConfirmButton } from "./ConfirmButton.js";
import { Bell, Check, CalendarDays, ShieldCheck, X } from "lucide-react";
import { api } from "./api.js";
import { calendarStatus, type CalendarItem } from "../server/calendar-model.js";
import { eventTime } from "./calendar-time.js";
import { statusLabels } from "./CalendarPage.js";

function ReminderToast({
  items,
  onClose,
  onDismiss,
  onOpen,
}: {
  items: CalendarItem[];
  onClose: () => void;
  onDismiss: (id: string) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  useEffect(() => {
    const el = ref.current!;
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
    };
    raise();
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
      observer.disconnect();
      document.removeEventListener("toggle", onToggle, true);
      if (el.matches(":popover-open")) el.hidePopover();
      host.remove();
    };
  }, []);
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
        aria-label="Закрыть все уведомления"
        title="Закрыть все уведомления"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <div className="calendar-inline">
        <Bell size={20} />
        <strong>Обратите внимание</strong>
      </div>
      <div className="calendar-toast-items">
        {items.map((item) => (
          <div className="calendar-toast-row" key={item.id}>
            <button
              type="button"
              className="calendar-toast-item"
              onClick={() => onOpen(item)}
            >
              {item.title}
            </button>
            <DailyCompletionButton item={item} compact />
            <ConfirmButton
              className="icon-button calendar-toast-complete"
              ariaLabel={`${item.repeatDaily ? "Завершить всю серию" : "Завершить"}: ${item.title}`}
              title="Завершить напоминание?"
              message={`«${item.title}». ${item.repeatDaily ? "Будет завершена вся ежедневная серия. " : ""} Уведомления прекратятся; напоминание можно вернуть в незавершённые в календаре.`}
              confirmLabel="Завершить"
              onConfirm={async () => {
                await api("/calendar/" + item.id + "/complete", "POST", {});
                window.dispatchEvent(new Event("orbit-calendar-changed"));
              }}
            >
              {item.repeatDaily ? (
                <span aria-hidden="true">✓✓</span>
              ) : (
                <Check size={16} />
              )}
            </ConfirmButton>
            <button
              type="button"
              className="icon-button calendar-toast-dismiss"
              aria-label={`Закрыть уведомление: ${item.title}`}
              title="Закрыть это уведомление"
              onClick={() => onDismiss(item.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
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
  const panel = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const zone = settings?.syncSchedule?.timeZone || "UTC";
  const closeToast = useRef(() => setToasts([])).current;
  const go = (item: CalendarItem) => {
    panel.current?.close();
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
        const active = data.items.filter(
          (i: CalendarItem) =>
            !i.completed && calendarStatus(i) !== "today_completed",
        ) as CalendarItem[];
        setItems(active);
        setToasts((previous) =>
          previous.flatMap((item) => {
            const current = active.find(
              (candidate) => candidate.id === item.id,
            );
            return current ? [current] : [];
          }),
        );
        setError("");
        const due: CalendarItem[] = await api(
          "/calendar/notifications/claim",
          "POST",
          {},
        );
        if (!alive) return;
        if (due.length) {
          setToasts((previous) => [
            ...new Map(
              [...previous, ...due].map((item) => [item.id, item]),
            ).values(),
          ]);
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
        className="icon-button calendar-notifications-trigger"
        title="Уведомления"
        aria-label={`Уведомления: ${pending + items.length}`}
        onClick={() => {
          panel.current?.showModal();
        }}
      >
        <Bell size={18} />
        {(pending > 0 || items.length > 0) && (
          <span className="calendar-notification-count" aria-hidden="true">
            {pending + items.length}
          </span>
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
              {item.client && (
                <small>
                  {[item.client, item.project].filter(Boolean).join(" / ")}
                </small>
              )}
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
          items={toasts}
          onClose={closeToast}
          onOpen={go}
          onDismiss={(id) =>
            setToasts((current) => current.filter((item) => item.id !== id))
          }
        />
      )}
    </>
  );
}
