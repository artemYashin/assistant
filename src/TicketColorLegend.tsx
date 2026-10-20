export function TicketColorLegend() {
  return (
    <div
      className="ticket-color-legend"
      role="group"
      aria-label="Обозначения фона тикетов"
    >
      <span>
        <i className="ticket-color-swatch is-imported" aria-hidden="true" />
        Импортирован
      </span>
      <span>
        <i className="ticket-color-swatch is-new" aria-hidden="true" />
        Не добавлен
      </span>
      <span>
        <i className="ticket-color-swatch is-trash" aria-hidden="true" />
        Удалён
      </span>
    </div>
  );
}
