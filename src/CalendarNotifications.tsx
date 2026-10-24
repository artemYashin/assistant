import { InitialsAvatar } from "./InitialsAvatar.js";
import { DailyCompletionButton } from "./DailyCompletionButton.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ConfirmButton } from "./ConfirmButton.js";
import { Bell, Check, CalendarDays, ShieldCheck, X } from "lucide-react";
import { api } from "./api.js";
import { calendarStatus, type CalendarItem } from "../server/calendar-model.js";
import { dailyOccurrence } from "../server/calendar-repeat.js";
import { eventTime, wallTime } from "./calendar-time.js";
import { calendarStatusLabel } from "./calendar-status.js";

const notificationKey = (item: CalendarItem) =>
  `${item.id}:${item.occurrenceDay || ""}`;

function ReminderToast({
  items,
  developers,
  zone,
  onClose,
  onDismiss,
  onOpen,
}: {
  items: CalendarItem[];
  developers: { id: string; name: string }[];
  zone: string;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [items]);
  // Refresh at actual status boundaries, independently of API polling/batch delivery.
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const current = Date.now();
    const future = items
      .flatMap((item) => [item.start, item.end, item.ticket?.deadline, item.warningStart])
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value))
      .filter((time) => time > now);
    const next = future.length ? Math.min(...future) : null;
    const timer =
      next === null
        ? undefined
        : window.setTimeout(
            refresh,
            Math.min(2147483647, Math.max(1, next - current)),
          );
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [items, now]);
  const instant = new Date(now).toISOString();
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
          <div className="calendar-toast-row" key={notificationKey(item)}>
            <button
              type="button"
              className="calendar-toast-item"
              onClick={() => onOpen(item)}
            >
              <span className="calendar-toast-badges">
                <span
                  className={
                    "calendar-state " +
                    calendarStatus({ ...item, repeatDaily: false }, instant)
                  }
                >
                  {calendarStatusLabel(
                    { ...item, repeatDaily: false },
                    instant,
                  )}
                </span>
                {item.ticket && (
                  <span className="calendar-ticket-badge">
                    Тикет #{item.ticket.id}
                  </span>
                )}
              </span>
              <span className="calendar-toast-title">{item.title}</span>
              <small className="calendar-toast-time">
                {item.ticket
                  ? "Дедлайн: " + eventTime(item.ticket.deadline, null, zone)
                  : eventTime(item.start, item.end, zone)}
                {item.repeatDaily ? " · ежедневно" : ""}
              </small>
              {item.ticket && (
                <small className="calendar-toast-people">
                  {item.developerIds.length ? (
                    <>
                      <span>Поручено:</span>
                      {item.developerIds.map((id) => {
                        const name =
                          developers.find((d) => d.id === id)?.name ||
                          "Недоступный разработчик";
                        return (
                          <span className="calendar-toast-person" key={id}>
                            <InitialsAvatar name={name} />
                            <span>{name}</span>
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    "Локальные разработчики не назначены"
                  )}
                </small>
              )}
            </button>
            <DailyCompletionButton item={item} compact />
            {!item.repeatDaily && (
              <ConfirmButton
                className="icon-button calendar-toast-complete"
                ariaLabel={`Завершить: ${item.title}`}
                title="Завершить напоминание?"
                message={`«${item.title}». Уведомления прекратятся; напоминание можно вернуть в незавершённые в календаре.`}
                confirmLabel="Завершить"
                onConfirm={async () => {
                  await api("/calendar/" + item.id + "/complete", "POST", {});
                  window.dispatchEvent(new Event("orbit-calendar-changed"));
                }}
              >
                <Check size={16} />
              </ConfirmButton>
            )}
            <button
              type="button"
              className="icon-button calendar-toast-dismiss"
              aria-label={`Закрыть уведомление: ${item.title}`}
              title="Закрыть это уведомление"
              onClick={() => onDismiss(notificationKey(item))}
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
  const [developers, setDevelopers] = useState<{ id: string; name: string }[]>(
    [],
  );
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
        setDevelopers(data.developers);
        setToasts((previous) =>
          previous.flatMap((item) => {
            const current = (data.items as CalendarItem[]).find(
              (candidate) => candidate.id === item.id,
            );
            if (!current || current.completed) return [];
            const occurrence = current.repeatDaily
              ? dailyOccurrence(
                  current,
                  item.occurrenceDay ||
                    wallTime(
                      new Date().toISOString(),
                      current.repeatZone || "UTC",
                    ).slice(0, 10),
                )
              : current;
            return occurrence && !occurrence.completed ? [occurrence] : [];
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
              [...previous, ...due].map((item) => [
                notificationKey(item),
                item,
              ]),
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
            key={notificationKey(item)}
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
              {calendarStatusLabel(item)}
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
          developers={developers}
          zone={zone}
          onClose={closeToast}
          onOpen={go}
          onDismiss={(id) =>
            setToasts((current) =>
              current.filter((item) => notificationKey(item) !== id),
            )
          }
        />
      )}
    </>
  );
}
