import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { GitBranch, GitPullRequest, Sparkles, Download } from "lucide-react";
import { PrReviewerPicker, type ReviewerPerson } from "../../../entities/azure-user/index.js";
import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";
import { useEffect, useState } from "react";
import { api } from "../../../shared/api/http/index.js";
export function ProjectRepository({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved?: () => void;
}) {
  const [tab, setTab] = useState<"git" | "pr" | "review">("git");
  const [required, setRequired] = useState<ReviewerPerson[]>([]);
  const [createdBy, setCreatedBy] = useState<ReviewerPerson[]>([]);
  const [optional, setOptional] = useState<ReviewerPerson[]>([]);
  const [ignoredPaths, setIgnoredPaths] = useState("");
  const [mainBranch, setMainBranch] = useState("");
  const [fetchDepth, setFetchDepth] = useState(1);
  const [codeSyncMinutes, setCodeSyncMinutes] = useState(30);
  const [fetchTimeoutMinutes, setFetchTimeoutMinutes] = useState(5);
  const [diffBudget, setDiffBudget] = useState(160000);
  const [loaded, setLoaded] = useState(false);
  const [repo, setRepo] = useState(""),
    [all, setAll] = useState(false),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setRepo("");
    setAll(false);
    setEnabled(true);
    setRequired([]);
    setOptional([]);
    setCreatedBy([]);
    setLoaded(false);
    setIgnoredPaths("");
    setDiffBudget(160000);
    setFetchTimeoutMinutes(5);
    setCodeSyncMinutes(30);
    setFetchDepth(1);
    setMainBranch("");
    setMessage("");
    api("/pr/projects")
      .then((items: any[]) => {
        if (!live) return;
        const m =
          items.find(
            (m) =>
              m.client === context.client &&
              m.project === context.project &&
              m.enabled,
          ) ||
          items.find(
            (m) => m.client === context.client && m.project === context.project,
          );
        if (m) {
          setCodeSyncMinutes(m.code_sync_minutes ?? 30);
          setFetchDepth(m.fetch_depth ?? 1);
          setMainBranch(m.main_branch || "");
          setFetchTimeoutMinutes((m.fetch_timeout_seconds || 300) / 60);
          const rules = JSON.parse(m.review_files || "{}");
          setIgnoredPaths((rules.ignoredPaths || []).join("\n"));
          setDiffBudget(rules.diffBudget || 160000);
          setRepo(m.repository || "");
          setAll(m.mode === "all");
          if (m.reviewer_filter) {
            const filter = JSON.parse(m.reviewer_filter);
            setRequired(filter.required.filter((p: ReviewerPerson) => p.id !== "$self"));
            setCreatedBy((filter.createdBy || []).filter((p: ReviewerPerson) => p.id !== "$self"));
            setOptional(filter.optional.filter((p: ReviewerPerson) => p.id !== "$self"));
          }
          setEnabled(!!m.enabled);
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  if (!context.client || !context.project)
    return (
      <p className="muted">
        Выберите заказчика и проект для настройки репозитория.
      </p>
    );
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!repo.trim()) { setTab("git"); setMessage("Укажите Git-репозиторий на вкладке Git."); return; }
        setBusy(true);
        setMessage("");
        try {
          await api("/pr/projects", "POST", {
            ...context,
            repository: repo.trim(),
            mode: all ? "all" : "required",
            enabled,
            reviewerFilter: { required, optional, createdBy },
            codeSyncMinutes,
            fetchDepth,
            mainBranch,
            fetchTimeoutSeconds: Math.round(fetchTimeoutMinutes * 60),
            reviewFiles: {
              ignoredPaths: ignoredPaths
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean),
              diffBudget,
            },
          });
          setMessage(
            "Репозиторий сохранён. Запустите синхронизацию или дождитесь следующего опроса.",
          );
          onSaved?.();
        } catch (e: any) {
          setMessage(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        Репозиторий · {context.client} / {context.project}
      </h3>
      <nav className="repository-tabs" aria-label="Настройки репозитория">
        <button type="button" aria-pressed={tab === "git"} onClick={() => setTab("git")}><GitBranch size={16} />Git</button>
        <button type="button" aria-pressed={tab === "pr"} onClick={() => setTab("pr")}><GitPullRequest size={16} />Pull request</button>
        <button type="button" aria-pressed={tab === "review"} onClick={() => setTab("review")}><Sparkles size={16} />AI review</button>
      </nav>
      {tab === "git" && <div className="stack repository-tab-body">
      <label>
        Git-репозиторий
        <input
          required
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="Точное имя или ID репозитория"
          maxLength={200}
        />
      </label>
      <p className="muted">
        Проект Azure DevOps задаётся в разделе «Подключение Azure», организация/коллекция
        и PAT — в общих настройках Azure. Синхронизируются только активные PR
        этого репозитория. Смена репозитория сохраняет старые результаты ревью.
      </p>
      <section>
      <h4 className="repository-section-title"><Download size={16} />Просмотр кода · загрузка репозитория</h4>
      <div className="repository-fetch-settings">
        <div className="repository-fetch-field">
          <label htmlFor="repository-fetch-1">Основная ветка для ассистента</label>
          <p id="repository-fetch-1-description" className="muted">Например, dev или main. Чат использует её, если вы явно не попросили другую ветку. Выбор ветки в просмотре кода на чат не влияет.</p>
          <input id="repository-fetch-1" aria-describedby="repository-fetch-1-description" value={mainBranch} onChange={event => setMainBranch(event.target.value)} maxLength={500} placeholder="По умолчанию — основная ветка репозитория" />
        </div>
        <div className="repository-fetch-field">
          <label htmlFor="repository-fetch-2">Глубина истории Git, коммитов</label>
          <p id="repository-fetch-2-description" className="muted">По умолчанию 1. Значение 0 — полная история всех веток и теги: существующий кэш докачивается без повторного клонирования. 1–1000 — ограниченная история выбранной ветки. Полная история может ускорить переключение веток, но первая загрузка требует больше времени и места; LFS и подмодули не скачиваются. Применяется при следующем получении данных Git; сохранение настройки само по себе ничего не скачивает.</p>
          <NumberInput id="repository-fetch-2" aria-describedby="repository-fetch-2-description" min={0} max={1000} step={1} required value={fetchDepth} onChange={event => setFetchDepth(Number(event.target.value))} />
        </div>
        <div className="repository-fetch-field">
          <label htmlFor="repository-fetch-3">Частота синхронизации Git, минуты</label>
          <p id="repository-fetch-3-description" className="muted">По умолчанию 30 минут; 0 — только вручную. Фоновая проверка обновляет список веток и проверяет последнюю открытую ветку уже загруженного репозитория. Учитываются разрешённые часы и дни общей синхронизации. Открытый снимок обновляется кнопкой Pull.</p>
          <NumberInput id="repository-fetch-3" aria-describedby="repository-fetch-3-description" min={0} max={1440} step={1} required value={codeSyncMinutes}
            onChange={event => setCodeSyncMinutes(Number(event.target.value))} />
        </div>
        <div className="repository-fetch-field">
          <label htmlFor="repository-fetch-4">Тайм-аут Git, минуты</label>
          <p id="repository-fetch-4-description" className="muted">От 1 до 120 минут, по умолчанию 5. Применяется к первому скачиванию, получению веток и Pull на странице кода. Сервис не выполняет push.</p>
          <NumberInput id="repository-fetch-4" aria-describedby="repository-fetch-4-description" min={1} max={120} step={1} required value={fetchTimeoutMinutes}
            onChange={event => setFetchTimeoutMinutes(Number(event.target.value))} />
        </div>
      </div>
      </section>
      <label>
        Исключить из ревью и View Diff (один путь или шаблон на строку)
        <textarea
          rows={6}
          value={ignoredPaths}
          maxLength={30100}
          onChange={(e) => setIgnoredPaths(e.target.value)}
          placeholder={
            "src/api/generated/\nsrc/api/client.ts\n**/*.generated.ts"
          }
        />
      </label>
      <p className="muted">
        Пути от корня репозитория. * — часть имени, ** — любые папки. Путь с /
        на конце исключает всю папку. Настройки общие для ревью и View Diff,
        включая просмотр отдельных коммитов. До 100 правил.
      </p>
      </div>}
      {tab === "review" && <div className="stack repository-tab-body">
      <label>
        Общий лимит diff для ревью и просмотра (символы)
        <NumberInput
          min={40000}
          max={400000}
          step={1000}
          value={diffBudget}
          onChange={(e) => setDiffBudget(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        По умолчанию 160 000 символов; на один файл — не больше четверти лимита.
        Увеличение расходует больше токенов. При пропуске файлов ревью укажет
        причину. Лимит 100 файлов применяется после исключений.
      </p>
      </div>}
      {tab === "pr" && <div className="stack repository-tab-body">
      <div className="repository-pr-toggles">
        <label className="repository-pr-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span><strong>Синхронизировать PR</strong><small>Обновлять активные pull request этого репозитория при синхронизации.</small></span>
        </label>
        <label className="repository-pr-toggle">
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
          <span><strong>Все активные PR</strong><small>Импортировать независимо от ревьюеров и автора. Снимите галочку, чтобы выбрать людей ниже.</small></span>
        </label>
      </div>
      <div className="pr-reviewer-columns pr-import-people-columns">
        <PrReviewerPicker title="Required" people={required} onChange={setRequired} disabled={all || busy || !loaded} context={context} />
        <PrReviewerPicker title="Optional" people={optional} onChange={setOptional} disabled={all || busy || !loaded} context={context} />
        <PrReviewerPicker title="Created by" userPicker people={createdBy} onChange={setCreatedBy} disabled={all || busy || !loaded} context={context} />
      </div>
      <p className="muted">Импортировать PR, где хотя бы один выбранный человек назначен ревьюером в указанной роли или указан автором в Created by. Все три списка работают как ИЛИ. Пустые списки без галочки «Все» не импортируют PR.</p>
      </div>}

      {message && <p role="status">{message}</p>}
      <div className="context-save-actions"><ContextSaveButton type="submit" busy={busy} disabled={!loaded} /></div>
    </form>
  );
}
