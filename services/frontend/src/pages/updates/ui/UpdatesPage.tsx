import { Bug, CirclePlus, RefreshCw, Sparkles } from "lucide-react";
import releases from "../../../shared/config/releases/index.js";
import "./updates.css";

const kinds = {
  feature: { label: "Новое", icon: CirclePlus },
  improvement: { label: "Улучшение", icon: Sparkles },
  fix: { label: "Исправление", icon: Bug },
};

export function UpdatesPage() {
  return (
    <section className="updates-page" aria-label="История обновлений">
      <header className="updates-heading">
        <RefreshCw size={24} aria-hidden="true" />
        <div>
          <h1>Что нового</h1>
          <p className="muted">
            Возможности и изменения в работе Orbit. Версия этой сборки — {releases[0].version}.
          </p>
        </div>
      </header>
      {releases.map((release, index) => (
        <article className="updates-release" key={release.version}>
          <header>
            <span className="updates-version">v{release.version}</span>
            {index === 0 && <span className="updates-current">Текущая версия</span>}
            <time dateTime={release.date}>
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "long",
                timeZone: "UTC",
              }).format(new Date(release.date + "T12:00:00Z"))}
            </time>
          </header>
          <h2>{release.title}</h2>
          <ul>
            {release.changes.map((change, i) => {
              const { label, icon: Icon } = kinds[change.kind as keyof typeof kinds];
              return (
                <li key={i}>
                  <span className={`updates-kind updates-kind-${change.kind}`}>
                    <Icon size={15} aria-hidden="true" />
                    {label}
                  </span>
                  <p>{change.text}</p>
                </li>
              );
            })}
          </ul>
        </article>
      ))}
      <p className="muted">
        История ведётся с версии 0.2.0. Небольшие изменения оформления не перечисляются.
      </p>
    </section>
  );
}
