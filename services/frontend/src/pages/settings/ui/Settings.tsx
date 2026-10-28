import { CalendarDateField } from "../../../entities/calendar/index.js";
import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { CalendarSettings } from "../../../features/configure-calendar/index.js";
import { CalendarDays } from "lucide-react";
import { AzurePatPermissions } from "../../../entities/azure/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { VoiceBinding } from "../../../features/voice-input/index.js";
import { useEffect, useId, useState } from "react";
import {
  AudioLines,
  BookOpen,
  Check,
  Command,
  GitPullRequest,
  Github,
  LockKeyhole,
  Mic,
  Settings2,
  Sparkles,
  Ticket,
} from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { Badge } from "../../../shared/ui/badge/index.js";
import { Field } from "../../../shared/ui/field/index.js";
import { PageHeading } from "../../../shared/ui/page-heading/index.js";
import { LoginCode } from "./LoginCode.js";

export function Settings({ settings, context, run, busy }: any) {
  const [settingsTab, setSettingsTab] = useState("workspace");
  const settingsTabId = useId();
  const settingsTabs = [
    { id: "workspace", label: "Рабочее пространство", icon: Settings2 },
    { id: "copilot", label: "Copilot", icon: Github },
    { id: "azure", label: "Azure DevOps", icon: Ticket },
    { id: "ai", label: "AI Assistant", icon: Sparkles },
    { id: "hotkeys", label: "Горячие клавиши", icon: Command },
    { id: "review", label: "Code Review", icon: GitPullRequest },
    { id: "memory", label: "Память", icon: BookOpen },
    { id: "calendar", label: "Календарь", icon: CalendarDays },
  ];
  const [form, setForm] = useState<any>({ ...settings, azurePat: "" }),
    [githubFlow, setGithubFlow] = useState<any>(null),
    [models, setModels] = useState<any[]>([]),
    [modelsLoading, setModelsLoading] = useState(false),
    [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    if (!settings.githubConnected && githubFlow?.status !== "connected") return;
    let active = true;
    setModelsLoading(true);
    api("/copilot/models")
      .then((value) => {
        if (active) {
          setModels(value);
          setConnectionError("");
        }
      })
      .catch((e) => {
        if (active) setConnectionError(e.message);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settings.githubConnected, githubFlow?.status]);
  const set = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));
  async function save() {
    const {
      githubConnected,
      azurePatSet,
      kanbanStateOrder,
      kanbanGroups,
      kanbanHiddenStates,
      kanbanFilterColumnsByStatus,
      kanbanHideEmptyColumns,
      ...values
    } = form;
    await api("/settings", "PUT", {
      ...values,
      client: context.client,
      project: context.project,
    });
    set("azurePat", "");
    window.dispatchEvent(new Event("orbit-calendar-changed"));
  }
  useEffect(() => {
    if (githubFlow?.status !== "pending") return;
    const t = setInterval(() => {
      api("/connect/github/poll", "POST", {})
        .then(setGithubFlow)
        .catch((e) => setConnectionError(e.message));
    }, 6000);
    return () => clearInterval(t);
  }, [githubFlow?.status]);
  useEffect(() => {
    if (githubFlow?.status === "connected")
      run("connected", () => Promise.resolve(), "Подключение сохранено");
  }, [githubFlow?.status, run]);
  return (
    <>
      <PageHeading
        title="Настройте Orbit под себя"
        subtitle="Подключения, предпочтения и правила вашего рабочего пространства."
      />
      <div className="settings-stack settings-tabs-layout">
        <div className="settings-tab-list" role="tablist" aria-label="Разделы настроек">
          {settingsTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`${settingsTabId}-${id}`}
              type="button"
              role="tab"
              aria-selected={settingsTab === id}
              aria-controls={`${settingsTabId}-${id}-panel`}
              tabIndex={settingsTab === id ? 0 : -1}
              className={`settings-tab is-${id}`}
              onClick={() => setSettingsTab(id)}
              onKeyDown={(event) => {
                const available = settingsTabs;
                const at = available.findIndex((tab) => tab.id === id);
                const next =
                  event.key === "ArrowRight"
                    ? (at + 1) % available.length
                    : event.key === "ArrowLeft"
                      ? (at + available.length - 1) % available.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? available.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setSettingsTab(available[next].id);
                document.getElementById(`${settingsTabId}-${available[next].id}`)?.focus();
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-workspace-panel`}
          aria-labelledby={`${settingsTabId}-workspace`}
          hidden={settingsTab !== "workspace"}
        >
          <div className="section-heading">
            <h2>
              <Settings2 size={22} />
              Рабочее пространство
            </h2>
          </div>
          <Field
            label="Режим работы"
            hint="Общий режим для этой установки. Данные и настройки скрытых элементов сохраняются. Это настройка интерфейса и ассистента, а не права доступа."
          >
            <select
              value={form.workMode || "lead"}
              onChange={(e) => set("workMode", e.target.value)}
            >
              <option value="lead">Lead — все возможности</option>
              <option value="developer">Разработчик — без локальных поручений и отпусков</option>
            </select>
          </Field>
          <p className="muted">
            Смена режима доступна после завершения ответа ассистента и ревью. Сохраните настройки
            для применения.
          </p>
          <Field
            label="Действие при клике на тикет"
            hint="В таблицах «Тикеты», «Azure тикеты» и «Корзина». Сохраните настройки для применения. Кнопки и ссылки в строке выполняют свои обычные действия."
          >
            <select
              value={form.ticketClickAction || "inline"}
              onChange={(event) => set("ticketClickAction", event.target.value)}
            >
              <option value="popup">Открыть деталку в попапе</option>
              <option value="inline">Открыть деталку под тикетом</option>
              <option value="select">Выбрать</option>
            </select>
          </Field>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-copilot-panel`}
          aria-labelledby={`${settingsTabId}-copilot`}
          hidden={settingsTab !== "copilot"}
        >
          <div className="section-heading">
            <h2>
              <Github size={22} />
              GitHub Copilot
            </h2>
            <Badge tone={settings.githubConnected ? "green" : "muted"}>
              {settings.githubConnected ? "Вход выполнен" : "Не подключён"}
            </Badge>
          </div>
          <div className="settings-group">
            <h3>Подключение</h3>
            <p>
              Модель работает через официальный Copilot SDK с вашей подпиской. Доступ зависит от
              политики вашей организации.
            </p>
            <p>
              Нажмите «Войти через GitHub», откройте ссылку и введите одноразовый код. На странице
              GitHub подтвердите вход GitHub CLI. Создавать OAuth App не нужно.
            </p>

            <div className="card-actions">
              <button
                className="secondary"
                disabled={!!busy || githubFlow?.status === "pending"}
                onClick={() =>
                  run("github", async () => {
                    await save();
                    setGithubFlow(await api("/connect/github", "POST", {}));
                  })
                }
              >
                <Github size={16} />
                Войти через GitHub
              </button>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "models",
                    async () => {
                      await save();
                      setModels(await api("/copilot/models"));
                      setConnectionError("");
                    },
                    "Copilot доступен; список моделей получен",
                  )
                }
              >
                Проверить и загрузить модели
              </button>
            </div>
            <LoginCode flow={githubFlow} />
            {modelsLoading && <p role="status">Загружаем доступные модели…</p>}
          </div>
          <div className="settings-group">
            <h3>Модели</h3>
            <div className="form-grid settings-model-grid">
              {(["model", "reviewModel"] as const).map((key) => (
                <Field
                  key={key}
                  label={key === "model" ? "Модель чата" : "Модель PR-ревью"}
                  hint="Выберите доступную модель и сохраните настройки. Список загружается после входа; его можно обновить кнопкой выше."
                >
                  <select
                    value={form[key] || ""}
                    onChange={(e) => set(key, e.target.value)}
                    aria-label={key === "model" ? "Модель чата" : "Модель PR-ревью"}
                    disabled={modelsLoading}
                  >
                    <option value="">
                      {key === "model" ? "По умолчанию в Copilot" : "Та же, что для чата"}
                    </option>
                    {form[key] && !models.some((m) => m.id === form[key]) && (
                      <option value={form[key]} disabled>
                        {form[key]} — сохранена, доступность не подтверждена
                      </option>
                    )}
                    {models.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-calendar-panel`}
          aria-labelledby={`${settingsTabId}-calendar`}
          hidden={settingsTab !== "calendar"}
        >
          <CalendarSettings form={form} set={set} />
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-azure-panel`}
          aria-labelledby={`${settingsTabId}-azure`}
          hidden={settingsTab !== "azure"}
        >
          <div className="section-heading">
            <h2>
              <Ticket size={22} />
              Azure DevOps
            </h2>
            <Badge tone={settings.azurePatSet ? "green" : "muted"}>
              {settings.azurePatSet ? "PAT сохранён" : "Не настроен"}
            </Badge>
          </div>
          <div className="settings-group">
            <h3>Подключение и доступ</h3>
            <p className="muted">
              URL организации / коллекции и проект Azure настраиваются в меню «Заказчики и проекты»
              → «Подключение Azure»: глобально или отдельно для выбранного проекта. Здесь задаются
              PAT и срок его действия. Расписание синхронизации — в «Заказчики и проекты →
              Автоматический импорт».
            </p>
            <Field
              label="Personal Access Token"
              hint="Пустое поле сохраняет текущий ключ. Токен не возвращается в браузер."
            >
              <input
                type="password"
                autoComplete="new-password"
                value={form.azurePat}
                onChange={(e) => set("azurePat", e.target.value)}
                placeholder={
                  settings.azurePatSet ? "Ключ сохранён · введите новый для замены" : "Вставьте PAT"
                }
              />
            </Field>
            <CalendarDateField
              label="Дата истечения PAT"
              dateOnly
              value={form.azurePatExpiresOn || ""}
              onChange={(value) => set("azurePatExpiresOn", value)}
              zone={form.syncSchedule.timeZone}
            />
            <p className="muted">
              Дата необязательна до первой настройки. Срок считается с 00:00 выбранного дня в
              часовом поясе календаря. За 7 дней появится обязательное напоминание. При замене
              токена обновите дату; настроенную дату можно заменить, но нельзя очистить.
            </p>
            <AzurePatPermissions />
          </div>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-ai-panel`}
          aria-labelledby={`${settingsTabId}-ai`}
          hidden={settingsTab !== "ai"}
        >
          <div className="section-heading">
            <h2>
              <Sparkles size={22} />
              AI Assistant
            </h2>
          </div>
          <div className="settings-group">
            <h3>Общие настройки</h3>
            <Field
              label="Инструкции ассистенту"
              hint="Предпочтения дополняют системные правила. Сохранение памяти требует подтверждения в разделе «Подтверждения»."
            >
              <textarea
                rows={5}
                value={form.instructions}
                maxLength={12000}
                onChange={(e) => set("instructions", e.target.value)}
              />
            </Field>
            <div className="form-grid">
              <Field
                label="Лимит времени ответа, секунд"
                hint="От 15 до 600 секунд, по умолчанию 300. При превышении приложение отменяет запрос и завершает runtime."
              >
                <NumberInput
                  min="15"
                  max="600"
                  value={form.llmTimeoutSeconds}
                  onChange={(e) => set("llmTimeoutSeconds", Number(e.target.value))}
                />
              </Field>
              <Field
                label="Максимум вызовов инструментов на запрос"
                hint="Прерывает повторяющиеся циклы чтения данных или создания черновиков."
              >
                <NumberInput
                  min="1"
                  max="100"
                  value={form.llmMaxToolCalls}
                  onChange={(e) => set("llmMaxToolCalls", Number(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label="Порог входных + выходных токенов чата на запрос"
              hint="От 1 000 до 1 000 000. Проверяется после получения отчёта SDK; возможен перерасход за уже выполненный вызов. Это не жёсткий платёжный лимит."
            >
              <NumberInput
                min="1000"
                max="1000000"
                value={form.llmMaxTokens}
                onChange={(e) => set("llmMaxTokens", Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="settings-group assistant-code-settings">
            <h3>Code Repository</h3>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.assistantCodeAccess ?? true}
                onChange={(event) => set("assistantCodeAccess", event.target.checked)}
              />
              Разрешить ассистенту читать и искать код репозитория
            </label>
            <p className="muted">
              Только чтение локально загруженных веток текущего проекта. Ассистент не изменяет файлы
              и не запускает загрузку из Azure.
            </p>
            <Field
              label="Ожидание подготовки Git, секунд"
              hint="До 120 секунд, по умолчанию 20. Если загрузка уже идёт, ассистент подождёт её завершения. 0 — не ждать. Учитывается общий лимит времени ответа ассистента."
            >
              <NumberInput
                className="assistant-code-wait"
                min="0"
                max="120"
                step="1"
                disabled={form.assistantCodeAccess === false}
                value={form.assistantCodeWaitSeconds ?? 20}
                onChange={(event) => set("assistantCodeWaitSeconds", Number(event.target.value))}
              />
            </Field>
          </div>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-hotkeys-panel`}
          aria-labelledby={`${settingsTabId}-hotkeys`}
          hidden={settingsTab !== "hotkeys"}
        >
          <div className="section-heading">
            <h2>
              <Command size={22} />
              Горячие клавиши
            </h2>
          </div>
          <div className="settings-group">
            <h3>Навигация и ввод</h3>
            <div className="voice-settings-row">
              <strong>Открыть или закрыть боковой чат</strong>
              <div className="voice-settings-controls">
                <VoiceBinding
                  value={form.chatToggleKey ?? "KeyC"}
                  otherKey={form.voiceCurrentKey ?? "KeyM"}
                  otherKeys={[
                    form.voiceNewKey ?? "KeyN",
                    form.voiceInputKey ?? "Ctrl+KeyI",
                    form.ticketOpenKey ?? "KeyT",
                    form.ticketCreateKey ?? "KeyY",
                  ]}
                  onChange={(value) => set("chatToggleKey", value)}
                />
                <div className="voice-press-select" data-voice-binding>
                  <SingleSelect
                    searchable={false}
                    label="Режим нажатия"
                    value={form.chatTogglePress ?? "single"}
                    onChange={(value) => set("chatTogglePress", value)}
                    options={[
                      { value: "single", label: "Одинарное нажатие" },
                      { value: "double", label: "Двойное нажатие" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="voice-settings-row">
              <strong>Открыть тикет по номеру</strong>
              <div className="voice-settings-controls">
                <VoiceBinding
                  value={form.ticketOpenKey ?? "KeyT"}
                  otherKey={form.chatToggleKey ?? "KeyC"}
                  otherKeys={[
                    form.voiceCurrentKey ?? "KeyM",
                    form.voiceNewKey ?? "KeyN",
                    form.voiceInputKey ?? "Ctrl+KeyI",
                    form.ticketCreateKey ?? "KeyY",
                  ]}
                  onChange={(value) => set("ticketOpenKey", value)}
                />
                <div className="voice-press-select" data-voice-binding>
                  <SingleSelect
                    searchable={false}
                    label="Режим нажатия"
                    value={form.ticketOpenPress ?? "single"}
                    onChange={(value) => set("ticketOpenPress", value)}
                    options={[
                      { value: "single", label: "Одинарное нажатие" },
                      { value: "double", label: "Двойное нажатие" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="voice-settings-row">
              <strong>Создать тикет</strong>
              <div className="voice-settings-controls">
                <VoiceBinding
                  value={form.ticketCreateKey ?? "KeyY"}
                  otherKey={form.chatToggleKey ?? "KeyC"}
                  otherKeys={[
                    form.voiceCurrentKey ?? "KeyM",
                    form.voiceNewKey ?? "KeyN",
                    form.voiceInputKey ?? "Ctrl+KeyI",
                    form.ticketOpenKey ?? "KeyT",
                  ]}
                  onChange={(value) => set("ticketCreateKey", value)}
                />
                <div className="voice-press-select" data-voice-binding>
                  <SingleSelect
                    searchable={false}
                    label="Режим нажатия"
                    value={form.ticketCreatePress ?? "single"}
                    onChange={(value) => set("ticketCreatePress", value)}
                    options={[
                      { value: "single", label: "Одинарное нажатие" },
                      { value: "double", label: "Двойное нажатие" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="voice-settings-row">
              <strong>Начать голосовой ввод в активное поле</strong>
              <div className="voice-settings-controls">
                <VoiceBinding
                  value={form.voiceInputKey ?? "Ctrl+KeyI"}
                  otherKey={form.chatToggleKey ?? "KeyC"}
                  otherKeys={[
                    form.voiceCurrentKey ?? "KeyM",
                    form.voiceNewKey ?? "KeyN",
                    form.ticketOpenKey ?? "KeyT",
                    form.ticketCreateKey ?? "KeyY",
                  ]}
                  onChange={(value) => set("voiceInputKey", value)}
                />
                <div className="voice-press-select" data-voice-binding>
                  <SingleSelect
                    searchable={false}
                    label="Режим нажатия"
                    value={form.voiceInputPress ?? "single"}
                    onChange={(value) => set("voiceInputPress", value)}
                    options={[
                      { value: "single", label: "Одинарное нажатие" },
                      { value: "double", label: "Двойное нажатие" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <p className="muted">
              Для диктовки выберите текстовое поле и нажмите Ctrl+I. Этот бинд работает внутри поля.
              Enter — вставить текст, Esc — отменить. Крестик отключает бинд.
            </p>
            <p className="muted">
              По умолчанию C — боковой чат, T — открытие тикета. Буквы и цифры не срабатывают при
              вводе текста. В открытых диалогах горячая клавиша отключена.
            </p>
          </div>
          <div className="settings-group voice-settings-block">
            <h3>
              <Mic size={17} />
              Голосовой помощник
            </h3>
            <p className="muted">
              Открывает сайдбар и начинает запись. В полях ввода обычные буквы и цифры не запускают
              запись. Специальные клавиши, пробел и сочетания с модификаторами работают и при вводе
              текста. Привязки не зависят от раскладки.
            </p>
            {(["Current", "New"] as const).map((kind) => (
              <div className="voice-settings-row" key={kind}>
                <strong>
                  {kind === "Current"
                    ? "Открыть текущий чат и начать запись"
                    : "Создать новый чат и начать запись"}
                </strong>
                <div className="voice-settings-controls">
                  <VoiceBinding
                    value={form[`voice${kind}Key`] ?? (kind === "Current" ? "KeyM" : "KeyN")}
                    otherKey={
                      form[kind === "Current" ? "voiceNewKey" : "voiceCurrentKey"] ??
                      (kind === "Current" ? "KeyN" : "KeyM")
                    }
                    otherKeys={[
                      form.chatToggleKey ?? "KeyC",
                      form.voiceInputKey ?? "Ctrl+KeyI",
                      form.ticketOpenKey ?? "KeyT",
                      form.ticketCreateKey ?? "KeyY",
                    ]}
                    onChange={(value) => set(`voice${kind}Key`, value)}
                  />
                  <div className="voice-press-select" data-voice-binding>
                    <SingleSelect
                      searchable={false}
                      label="Режим нажатия"
                      value={form[`voice${kind}Press`] ?? "double"}
                      onChange={(value) => set(`voice${kind}Press`, value)}
                      options={[
                        { value: "double", label: "Двойное нажатие" },
                        { value: "single", label: "Одинарное нажатие" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ))}
            <small className="muted">
              Enter — закончить и отправить запись; Esc — отменить. Для назначения модификатора
              нажмите и отпустите его; для сочетания удерживайте его и нажмите нужную клавишу.
              Некоторые системные сочетания перехватывает ОС или браузер.
            </small>
            <div className="inline-note">
              <AudioLines size={18} />
              <span>
                Голос распознаётся локально контейнером Whisper. Первая запись запускает загрузку
                модели. Распознанный текст можно отредактировать перед отправкой.
              </span>
            </div>
          </div>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-review-panel`}
          aria-labelledby={`${settingsTabId}-review`}
          hidden={settingsTab !== "review"}
        >
          <div className="section-heading">
            <h2>
              <GitPullRequest size={22} />
              Code Review
            </h2>
          </div>
          <div className="settings-group">
            <h3>Лимиты ревью</h3>
            <Field
              label="Лимит времени ответа ревью, секунд"
              hint="От 15 до 86 400 секунд, по умолчанию 600. На один запрос к модели, включая запуск Copilot и инструменты; при продолжении после уточнений отсчёт начинается заново. Подготовка Git и сбор diff не входят. Не зависит от лимита чата."
            >
              <NumberInput
                min="15"
                max="86400"
                step="1"
                value={form.reviewTimeoutSeconds ?? 600}
                onChange={(event) => set("reviewTimeoutSeconds", Number(event.target.value))}
              />
            </Field>
            <Field
              label="Лимит токенов ревью по умолчанию"
              hint="Отдельный бюджет входных + выходных токенов на всё ревью, включая продолжения. Используется автоматически и подставляется в форму запуска, где его можно изменить. Остановка по отчётам SDK, возможен перерасход за последний вызов."
            >
              <NumberInput
                min="1000"
                max="100000000"
                step="1"
                value={form.reviewMaxTokens ?? 1000000}
                onChange={(event) => set("reviewMaxTokens", Number(event.target.value))}
              />
            </Field>
            <Field
              label="Максимум вызовов инструментов на ревью"
              hint="От 1 до 1 000, по умолчанию 30. Общий лимит на всё ревью, включая продолжения после ответов. Не зависит от лимита чата. Для продолжения после достижения лимита увеличьте это значение."
            >
              <NumberInput
                min="1"
                max="1000"
                step="1"
                value={form.reviewMaxToolCalls ?? 30}
                onChange={(event) => set("reviewMaxToolCalls", Number(event.target.value))}
              />
            </Field>
          </div>
        </section>
        <section
          className="panel settings-card"
          role="tabpanel"
          id={`${settingsTabId}-memory-panel`}
          aria-labelledby={`${settingsTabId}-memory`}
          hidden={settingsTab !== "memory"}
        >
          <div className="section-heading">
            <h2>
              <BookOpen size={22} />
              Память
            </h2>
          </div>
          <div className="settings-group">
            <h3>Язык записей</h3>
            <Field
              label="Предпочтительный язык памяти"
              hint="Ассистент будет использовать этот язык для новых предложений. Существующие записи не переводятся; язык ответов в чате не меняется."
            >
              <input
                value={form.memoryLanguage ?? "English"}
                onChange={(event) => set("memoryLanguage", event.target.value)}
                maxLength={100}
                required
                placeholder="English"
              />
            </Field>
          </div>
        </section>
        {connectionError && <div className="error">{connectionError}</div>}
        <div className="save-bar">
          <span>
            <LockKeyhole size={16} /> Сохраняются изменения всех вкладок
          </span>
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => run("save", save, "Настройки сохранены")}
          >
            <Check size={17} />
            Сохранить настройки
          </button>
        </div>
      </div>
    </>
  );
}
