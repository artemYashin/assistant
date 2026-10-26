export function TicketDate({ value }: { value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return <>—</>;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <>—</>;
  return <time className="ticket-table-date" dateTime={date.toISOString()} title={date.toLocaleString("ru-RU")}>
    <span>{date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
    <small>{date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small>
  </time>;
}
