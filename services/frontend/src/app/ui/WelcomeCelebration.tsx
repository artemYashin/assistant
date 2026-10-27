import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, PartyPopper, Sparkles, X } from "lucide-react";
import "./welcome-celebration.css";

function ticketWord(count: number) {
  const last = count % 10;
  const tens = count % 100;
  return last === 1 && tens !== 11
    ? "тикет"
    : last >= 2 && last <= 4 && (tens < 12 || tens > 14)
      ? "тикета"
      : "тикетов";
}

export function WelcomeCelebration({
  ready,
  count,
  onViewTickets,
}: {
  ready: boolean;
  count: number;
  onViewTickets: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (ready && !dismissed) dialog.current?.showModal();
  }, [ready, dismissed]);
  if (!ready || dismissed) return null;
  const close = () => {
    dialog.current?.close();
    setDismissed(true);
  };
  return (
    <dialog
      ref={dialog}
      className="welcome-celebration"
      aria-labelledby="welcome-title"
      onClose={() => setDismissed(true)}
      onCancel={close}
    >
      <div className="welcome-fireworks" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((burst) => (
          <div
            key={burst}
            className="welcome-firework"
            style={{
              left: `${[18, 80, 48, 12, 87][burst]}%`,
              top: `${[23, 20, 12, 65, 68][burst]}%`,
            }}
          >
            {Array.from({ length: 28 }, (_, index) => {
              const angle = (index / 28) * Math.PI * 2;
              const distance = 75 + (index % 3) * 28;
              return (
                <i
                  key={index}
                  style={
                    {
                      "--spark-x": `${Math.cos(angle) * distance}px`,
                      "--spark-y": `${Math.sin(angle) * distance}px`,
                      "--spark-delay": `${burst * 0.45}s`,
                      "--spark-color": ["#76e6b1", "#ffd76b", "#98bcff", "#f7a7dc"][index % 4],
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="welcome-card">
        <button
          className="icon-button welcome-close"
          type="button"
          aria-label="Закрыть приветствие"
          onClick={close}
        >
          <X size={20} />
        </button>
        <div className="welcome-symbol">
          <PartyPopper size={38} />
        </div>
        <p className="welcome-eyebrow">ORBIT · ХОРОШИЙ ДЕНЬ ДЛЯ ХОРОШИХ ДЕЛ</p>
        <h1 id="welcome-title">
          Привет! <Sparkles size={32} aria-hidden="true" />
        </h1>
        <p className="welcome-count">
          {count ? (
            <>
              Сегодня у тебя{" "}
              <strong>
                {count.toLocaleString("ru-RU")} {ticketWord(count)}
              </strong>
              .
            </>
          ) : (
            "Сегодня твой список тикетов пуст. Чистый старт!"
          )}
        </p>
        <p className="welcome-caption">
          {count
            ? "Давай их посмотрим. По одному — и всё получится."
            : "Можно выдохнуть. Или найти себе новое приключение."}
        </p>
        <p className="welcome-scope">В локальном списке текущего Azure-подключения, без корзины.</p>
        <button
          type="button"
          className="primary welcome-action"
          autoFocus
          onClick={() => {
            close();
            onViewTickets();
          }}
        >
          {count ? "Давай посмотрим" : "Открыть тикеты"} <ArrowRight size={18} />
        </button>
        <button type="button" className="text-button" onClick={close}>
          Продолжить с текущей страницы
        </button>
      </div>
    </dialog>
  );
}
