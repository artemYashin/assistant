# Проверка реализации

Проверено 19 октября 2026 года в Linux/WSL, Node.js 20.19.2.

- Чистый `npm ci` в отдельной временной папке: успешно.
- `npm run build`: TypeScript, production-сборка React/Vite и сервер — успешно.
- `npm test`: 53 теста, 53 успешно.
- `npm run test:sdk`: настоящий runtime GitHub Copilot SDK запускается, инструмент чтения памяти выполняется; shell и инструмент подтверждения отклоняются. Используется фиктивный токен, запрос к модели не отправляется.
- `docker compose config --quiet`: конфигурация валидна.
- `python3 -m py_compile voice/app.py`: успешно.
- Запуск production Node-сервера: успешно; `/api/health`, `/api/auth/session` и страница `/` возвращают HTTP 200. До создания пароля приватные API недоступны.

Тесты покрывают авторизацию и CSRF для отправки, неизменность текста/получателя, параллельные и повторные подтверждения, истечение черновиков, неопределённую доставку, восстановление после перезапуска, шифрование секретов, изоляцию памяти, выбор Microsoft-аккаунта, смену аккаунта, формат Graph-запроса, Azure URL/PAT/проект, пагинацию Teams, дедупликацию и обновление упоминаний, сохранение источника Azure при смене настроек во время запроса.

Дополнительно проверены дедупликация usage-отчётов, неизвестные значения и кеш, периоды отчёта, сохранение после перезапуска, несколько вызовов модели на запрос, остановка по токенам/инструментам/времени и вручную, запрет параллельных запросов, авторизация отчёта и CSRF остановки. Эти сценарии используют подмену клиента модели; реальное получение usage от корпоративной модели пока не проверено.

## Не проверено в этой среде

- Сборка и запуск Docker-образов: установлен Docker CLI, но Docker daemon недоступен. Apple Silicon и Intel Mac требуют отдельного запуска.
- Полный вход в GitHub/Microsoft, ответы модели, чтение корпоративных чатов и Azure DevOps: пользовательские учётные данные не предоставлены. HTTP-интеграции протестированы с подменой внешнего fetch.
- Реальная запись микрофона, загрузка Whisper-модели и распознавание: voice-контейнер здесь не запускался.
- Визуальный и интерактивный browser QA: desktop automation дважды завершилась ошибкой `sandboxCwd is not a local file URI: file:///home/artem/assistant`. HTTP 200 не считается визуальной проверкой.

Порядок проверки с рабочими аккаунтами приведён в README. Запуск и настройку выполнить на Mac из каталога проекта командой `docker compose up --build -d`.

Расширенный поиск упоминаний: проверены обычные числа разной длины, скрытые и нестандартные ссылки, URL-кодирование, HTML-атрибуты/сущности, дедупликация; кандидат не попадает в трекер при HTTP 404 или несовпадении Azure-проекта.

Обновление UX подключений и контекстов: проверены создание/переключение контекстов, восстановление выбора из SQLite, доступ к старой истории, CSRF и изоляция проектов. Вход без Client ID проверен с подменой CLI: выдача кода, повторный запрос во время входа, сохранение токена, обработка ошибок, удаление временной конфигурации и сокрытие диагностики команды токена. Проверен вариант CLI без флага `--insecure-storage` (совместимость со старой версией в Debian Bookworm). Реальная авторизация GitHub CLI и загрузка доступных корпоративному аккаунту моделей не проверены. Browser QA и сборка Docker по-прежнему требуют проверки в среде с работающими браузером и Docker daemon.

Добавлены проверки PR: фильтр личного required reviewer, все PR, разделение проектов, дедупликация версий, черновики, реальный текстовый diff, неполные данные, дневной лимит, остановка повторов после ошибок/перезапуска, проверка устаревшей версии перед LLM. Отдельно проверены отсутствие инструментов/истории в PR-ревью и учёт токенов. Для задач проверены WIQL-фильтры и экранирование, типы/статусы, пагинация комментариев, запрет посторонних attachment URL, проксирование изображений и блокировка после смены подключения. Проверен сквозной путь «номер тикета в чате → чтение API → сохранённая карточка в истории». Teams по умолчанию не опрашивается; новые API требуют входа и CSRF для изменений. Все внешние API/LLM в этих тестах подменены, корпоративные PR и изображения ещё требуют интеграционной проверки.

Смена статусов: проверены точное имя/RFT, неизвестные статусы, другой проект, отмена перед записью, последовательность GET → states → PATCH с test /rev → GET, несовпадение и недоступность проверки, неопределённый PATCH, уже установленный статус, обновление локального трекера и дедупликация записей внутри ответа. Проверено отсутствие права записи у запроса только на чтение. Реальные переходы в корпоративном Azure не выполнялись.

Исправление зависимости voice: `requests` указан явно, в Dockerfile добавлен импорт приложения при сборке. Установка `voice/requirements.txt` в чистое Python 3.12 окружение, `pip check` и импорт `app` с проверкой `health()` успешно выполнены. Модель не скачивалась. `docker compose config --quiet` и `git diff --check` прошли; Docker daemon по-прежнему недоступен.

Диагностика внешнего API: HTML вместо JSON, невалидный JSON, HTTP 403 и ошибка DNS проверены с подменой fetch. Интерфейс получает понятную ошибку и код диагностики; лог содержит только код, сервис, hostname, HTTP-статус, категорию формата и безопасный код сетевой ошибки, без токенов, query, тела ответа или текста исключения. 55 тестов и production-сборка прошли. Реальный корпоративный прокси не проверен. Логи: `docker compose logs --since=5m orbit`.

Текст HTML-ошибки теперь выводится в поле `pageText` записи `[upstream]` в логах orbit, включая HTTP 4xx/5xx. Читается не более 64 КиБ, выводится до 6000 символов с отметкой обрезки. Удаляются HTML-теги/атрибуты, скрипты, стили, комментарии, известные credentials запроса, query/fragment видимых URL и распространённые формы токенов. JSON-тела не логируются. Проверены читаемый текст, редактирование секретов и ограничение объёма; 57 тестов и production-сборка успешны. Произвольный текст страницы может содержать корпоративные сведения, поэтому лог предназначен для локальной диагностики.

UI: устранён конфликт `.assistant` между панелью и сообщением — панель использует `.assistant-panel`, включая media queries. Выровнены отступы форм, импорта, PR и карточек, размеры checkbox и перенос длинных кнопок; в шапке чата показаны уровни памяти. Проверка Chromium/Playwright с подменой API: разделы обзор, настройки, тикеты, память, PR, входящие, подтверждения, Teams и использование LLM открываются без JS-ошибок и горизонтального переполнения при 1440×900; настройки также проверены при 390×844. Короткое сообщение ассистента занимает 70.6 px; checkbox — 16 px. Просмотрены скриншоты настроек и PR. Это проверка тестовых данных, а не корпоративных интеграций. 57 тестов и production-сборка прошли.

Просмотр из таблицы тикетов: кнопка «Посмотреть» загружает свежую полную карточку и раскрывает её под строкой, «Скрыть» закрывает; ошибка показывает повтор загрузки. Chromium с подменой API: проверены открытие, описание/комментарии, закрытие, ошибка и наличие кнопки повтора; скриншот просмотрен. Production-сборка прошла, корпоративный API не вызывался.

Диагностика voice: ошибки загрузки Whisper и распознавания (включая итерацию сегментов) теперь логируются с этапом, типом исключения, очищенным сообщением, местами вызовов и reference; UI получает безопасную подсказку и reference. Запись длиннее 150 секунд возвращает 422. Четыре Python unittest прошли с подменой модели; production-сборка прошла. Первый npm test выявил нестабильность существующего PR-теста (head/new-head), повторный полный запуск: 57/57 успешно. Реальное аудио пользователя и загрузка модели в его сети не проверены; причина его 503 пока не установлена. Python-тесты: `PYTHONPATH=voice python -m unittest discover -s voice -p 'test_*.py'` в окружении с voice dependencies.

Карточка тикета: общая для lookup, таблицы и чата иерархия — бейджи типа/статуса, метаданные автора/исполнителя/дат, отдельные секции описания, комментариев, вложений и сворачиваемых полей. Chromium с подменой API: проверены оба способа открытия, отображение автора, закрытие и ошибка; карточка lookup не переполняется при 390px. Скриншот таблицы просмотрен. Production-сборка прошла.

Markdown чата: сообщения пользователя и ассистента выводятся через react-markdown + remark-gfm; поддерживаются выделение, списки, цитаты, код и таблицы. HTML не исполняется, допускаются ссылки HTTP(S)/mailto; Markdown-изображения выводятся ссылками без автоматической загрузки. Проверки серверного React-рендера покрывают форматирование, блокировку javascript/HTML и отсутствие img. 59 тестов и production-сборка прошли.

Ручные PR и локальный трекер (19 октября 2026): синхронизация PR больше не создаёт ревью; репозиторий задаётся в контексте проекта. Миграция отменяет старую автоматическую очередь один раз. Проверены ручная постановка, дедупликация версий, сохранение результатов, изоляция памяти по проектам, общий/клиентский/проектный контекст ревью без истории чата, суточный лимит попыток (ручной повтор не обнуляет счётчик). Локальный разработчик загружается из Core Teams API и хранится отдельно; API-тест подтверждает отсутствие PATCH/DELETE Azure, сохранение назначения после sync, исключение удалённых тикетов из импорта и явное восстановление по номеру, авторизацию и валидацию цветов. 61 Node-тест, production build и SDK smoke прошли. Python diagnostics tests ранее: 4/4. Chromium с подменой API: обе карточки, отдельные раскрывающиеся секции, отсутствие внешнего аккордеона, кнопка ручного ревью, настройки репозитория и сохранённый Markdown-результат. Просмотрены скриншоты таблицы и PR; реальный корпоративный Azure/LLM не вызывался.

Перед публикацией: стандартный порт изменён с 3000 на 43871 в Compose, Dockerfile, сервере, origin allowlist, Vite proxy, примере окружения и README. Повторно прошли 61 Node-тест, 4 Python-теста voice, production build, docker compose config и git diff --check. У main убран автоматический margin.

PR используют Azure Project только из общих настроек: поле убрано из формы и POST-схемы, сервер подставляет настроенный проект. Старое подключение к другому проекту блокируется до повторного сохранения репозитория; история ревью остаётся. Тест проверяет наследование проекта, смену подключения и пустую настройку. 62 теста и production-сборка прошли.

Compose явно задаёт PORT=43871, не полагаясь на ENV образа. Проверена результирующая JSON-конфигурация: PORT, опубликованный порт, target и healthcheck используют 43871. Для обновления существующего контейнера: `docker compose up --build --force-recreate -d orbit`.

Размер чата: перетаскиваемая левая граница, клавиатурные стрелки/Home/End и двойной щелчок для сброса; ширина ограничена размером окна. Кнопка в шапке сворачивает панель, верхняя кнопка разворачивает. Состояние и ширина хранятся в localStorage; скрытие не размонтирует чат и сохраняет черновик. Chromium с подменой API: проверены drag, клавиатура, сохранение черновика, ширины и свёрнутого состояния после reload. Production-сборка прошла.

Локальный разработчик: массовая загрузка команд заменена поиском Azure Identities General по явному запросу (имя/email), минимум 2 символа, без wildcard. Cloud endpoint vssps.dev.azure.com, custom server — URL коллекции. Результаты: до 20 активных людей, без групп, с email; UI не запрашивает каталог при загрузке или каждом символе. Проверены фильтр/кодирование, cloud host, лимит/усечение, сохранение предыдущих выборов, смена подключения во время запроса; локальное назначение не пишет Azure. 63 теста и сборка прошли. Chromium с mock API подтвердил отсутствие запросов до Enter и выбор разработчика. Реальный корпоративный Identity API требует проверки с PAT Identity Read.

### Type/status colors and PR presentation (2026-10-19)

- Added validated `typeColors` settings alongside existing `statusColors`; API tests cover rejecting invalid CSS colors and saving/reading both maps together.
- Native color selectors and reset controls sit beside auto-import type/status checkboxes. Colors affect table and detail badges independently of import filters.
- PR cards show author first, labeled context badges, and collapsed commit/repository identifiers.
- `npm run build` passed; `npm test` passed (63 tests). Playwright with mocked APIs verified changing/resetting type colors without changing the import checkbox, mobile overflow, manual PR review action, and saved Markdown history. Desktop screenshots inspected. Live Azure integration was not exercised.

### PR descriptions, referenced tickets, and review layout (2026-10-19)

- Added backward-compatible description/error columns. PR sync fetches full descriptions when list text reaches Azure's 400-character truncation threshold.
- Regression tests cover full descriptions, deduplication, malformed references, cross-project rejection, missing items, preserving local deletion, changed references, and independent import failures.
- `npm test`: 65 passed. Build passed. Playwright with mocked APIs verified description/ticket accordions, review blocks/history, explicit review action, and mobile overflow; desktop screenshot inspected. Real Azure credentials were not used.

### Sticky page header and chat alignment (2026-10-19)

- Header now stays at the viewport top. Header height and assistant offset share one CSS variable (70px desktop, 60px mobile); assistant uses remaining dynamic viewport height.
- Build passed. Playwright with mocked APIs checked header/chat coordinates at page top, mid-scroll and bottom at widths 1440 and 390, plus collapse/reopen while scrolled. Chat remained directly below the header and flush with the viewport bottom.

### PR import is read-only in Azure (2026-10-19)

- Inspected the PR sync → importPrTickets → saveTicket path: only Azure reads and local SQLite persistence.
- Added a regression test recording every outbound request across two syncs. The only non-GET request is the documented read-only POST /wit/workitemsbatch with IDs/errorPolicy; no mutation endpoints or agent calls occur. The original Active state is retained locally, and an existing ticket is not imported twice.
- `npm test`: 66 passed. Azure API semantics verified against Microsoft Get Work Items Batch documentation; no live Azure writes performed.

### Inline PR description images (2026-10-19)

- Authenticated same-origin image route only accepts Markdown image references present in the saved PR description and recognized attachment download endpoints on the configured Azure collection. Current connection is checked before/after fetch. PAT remains on server; only GET is used, redirects rejected, binary signatures checked, body limited to 20 MB.
- Tests cover inline/reference Markdown images, relative paths, foreign hosts/collections, wrong PR/repository, unsupported endpoints, credential URLs, executable schemes, HTML/SVG response rejection, oversize payloads, stored-reference requirement, connection changes, and unauthenticated route access.
- Build passed; 72 tests passed. Playwright with mocked APIs confirmed zero image requests while collapsed, inline rendering after expansion, error fallback, size constraint and mobile overflow. Live corporate Azure attachments were not available for verification.

### Repository settings location (2026-10-19)

- Removed the duplicate Git repository form from the PR page. It remains in the customer/project manager opened from the top context selector; the empty-state hint points there.
- Build passed. Playwright verified the form is absent on the PR page and appears once after opening «Заказчики и проекты».

### Ticket filters and visible work item types (2026-10-19)

- Added combined type, assignee and state filters with reset/count. Assignee choices distinguish Azure assignment from local developer delegation. Search also matches type and local developer; options use the entire loaded ticket list so filtering does not hide other choices.
- Added a dedicated type column with configured badge color and an explicit type label in the full card; expanded table detail spans all six columns.
- Playwright with mocked tickets verified combined filters, zero results/reset, Azure/local/unassigned selection, search, sorting, detail expansion and mobile overflow. Desktop screenshot inspected. Build passed.

### Page routing and PR-to-ticket navigation (2026-10-19)

- React Router browser history with stable paths for all sections, sidebar links, unknown-page state, direct ticket ID/source URLs. The persistent workspace retains the chat across navigation. Existing Express SPA fallback serves deep links.
- PR description and ticket accordions expose local ticket links; focused ticket bypasses stale text/field filters, highlights and expands the exact row, scrolls below the sticky header. Different Azure sources cannot open a same-number ticket. Missing tickets remain explicit and can be added manually.
- Build and 74 tests passed. Playwright with mocked APIs verified direct load, reload, back/forward, both PR links, exact ID expansion/highlight/scroll, return to all tickets, sidebar paths, mismatched source and unknown URL.

### Voice PyAV metadata_errors compatibility (2026-10-19)

- Reproduced the reported TypeError with installed PyAV 19.0.1 and faster-whisper 1.2.0 using a generated WAV, without a model or network calls.
- Pinned `av==16.1.0`; the same real decoder test now passes. Added WebM/Opus encode/decode regression using the browser audio container/codec. Docker image build executes both real decoder tests as the unprivileged service user.
- Six Python voice tests passed with the pinned dependencies. Full model inference and a Docker runtime build were not exercised in this environment.

### PR sorting and filters (2026-10-19)

- Added a backward-compatible creation date column, populated from Azure creationDate, normalized to UTC, preserved when a later response omits it. API selection orders by creation date before the 300-item limit.
- UI defaults to newest creation; supports oldest, number, title ordering, combined draft/current-review-readiness filters, result count/reset and empty state. Unknown dates sort last.
- Build and 77 tests passed, including date persistence/order and combined filter cases. Playwright verified date sorting, draft/readiness combination, empty/reset states, mobile overflow and no mutation/LLM requests from filtering.

### Chat cleanup and local tracker tools (2026-10-19)

- Added authenticated, CSRF-protected DELETE conversation scoped to the current customer/project; rejects active agent work to avoid repopulating a cleared conversation. UI confirmation preserves memory and draft text; stale history loads cannot undo cleanup.
- Agent add/remove local tools require a current command with the ticket ID, deduplicate repeated actions per turn, reject opposite actions in the same turn, honor cancellation/source changes and remain unavailable during PR review. Add uses verified Azure GET plus local save; remove shares the UI's SQLite tombstone transaction. Auto-prefetch is skipped for local list commands.
- Build and 80 tests passed. Tests cover scoped cleanup/auth/CSRF/active request, preserved memory, real connector GET-only add/restore, no network on removal, duplicate calls and intent checks. Existing source-change test now verifies the stricter behavior: discard a stale import entirely.
- Playwright confirmed clear cancel/accept, scoped request, persistence after reload, and no header overflow at 280px chat width.

### Voice build cache and scoped memory wording (2026-10-19)

- Voice Dockerfile uses the stable Dockerfile frontend and a locked BuildKit pip cache mount. Removed --no-cache-dir; the requirements layer remains before source COPY, preserving normal layer reuse. Cache is builder-managed and excluded from the image.
- Updated system policy, save_memory tool description and body schema guidance to omit redundant current-project/client prefixes while preserving names essential to the actual fact. Existing records are untouched.
- TypeScript check, Compose configuration validation and diff whitespace check passed. Docker daemon is unavailable here, so a real cold/warm build comparison was not performed. LLM phrasing is instructed, not validated by a live model call.

### Ticket rich-text spacing (2026-10-19)

- Replaced regex-only HTML stripping in the ticket card with inert-template text extraction. Collapses source HTML whitespace/NBSP padding and repeated editor blank lines, preserves block boundaries and preformatted code indentation. Plain-text newlines are preserved with excess blank lines capped. No raw Azure HTML is inserted into the visible document.
- Build passed. Browser checks covered Azure-style nested blocks, NBSP runs, empty div/br sequences, reproduction steps, code indentation, plain text and ignored script/image markup. Expanded card screenshot inspected.

### Compact PR card layout (2026-10-19)

- Current review output and coverage are collapsed by default. Card border is now 2px with a stronger neutral green tone, keeping the existing subtle shadow.
- Review status sits directly after the PR badge (gray idle, green completed, amber queued/running, red error/interrupted); draft is separate. Review action and version dropdown move to the top toolbar. Technical identifiers use an anchored overlay and no longer expand the card's vertical flow.
- Build passed. Playwright checked collapsed result/toggle, badge states, toolbar action, unchanged card height when opening version details and mobile overflow with chat collapsed. Desktop screenshot inspected.

### PR source/target branches (2026-10-19)

- Added backward-compatible source_branch/target_branch columns populated from Azure sourceRefName/targetRefName and refreshed during sync.
- Compact source → target badges below the title omit refs/heads/ visually, retain full names in tooltips, and ellipsize long names. PR grid item min-width prevents mobile overflow.
- Build and 81 tests passed. Browser checks verified branch labels, single-line height, long branch names and mobile overflow.

### Compact PR context menu (2026-10-19)

- Customer, Orbit project, Azure project and repository moved from vertical card content into a collapsed «Контекст» dropdown in the top-right action group. Historical records show repository ID when the configured repository name no longer applies.
- Build passed. Browser checks confirmed hidden-by-default details, correct context on expansion, unchanged card height, and mobile overflow checks.

## Local ticket listing and separate Copilot models

- Replaced the chat tool's silent 100-row limit and full-row serialization with compact ID-paginated results, exact type/state filters, total count, hasMore and nextAfterId. Each page fits below the generic 24,000-character tool guard; long display fields are explicitly marked as shortened. Listing remains scoped to the configured Azure connection and never calls Azure. Pagination is a live view, not a snapshot across simultaneous syncs.
- Chat instructions distinguish Bug type from workflow state, request continuation pages and prohibit describing partial results as complete. Existing token, time and tool-call budgets still apply.
- Settings expose separate chat and PR-review model selectors using the same Copilot model catalogue. Empty review selection inherits the chat model for backward compatibility. The selected model is passed to the session and usage ledger.
- Validation: production build and all 83 Node tests passed. New tests cover 250 tickets, filters, source isolation, page size/continuation, shortened titles, empty results, separate session models and usage records. Live Copilot/Azure calls were not exercised.

## Compact local assignment and identity lookup

- Local assignment now has its own table column (name or N/A, edit and clear icons). Search opens a native modal dialog; it no longer increases every ticket row's height. Expanded ticket spans all seven columns.
- Empty General identity searches retry once with DisplayName for names or MailAddress for email, using the same query. No directory enumeration or Azure writes. The root cause in the user's tenant remains unverified; Microsoft documents General as also matching display names.
- Production build and all 84 Node tests passed, including explicit name/mail fallback coverage. Browser checks with mocked API cover the separate column, initially hidden search, edit modal, empty search, Escape dismissal and disabled removal for unassigned tickets.

## Inline ticket images

- Ticket rich text now preserves HTML image positions in description, reproduction steps, acceptance criteria and newly fetched comments. Only same-collection image attachments already listed in the card are mapped to the authenticated local attachment endpoint; arbitrary remote image URLs are not loaded. HTML is still parsed inertly and never inserted as executable markup.
- Comments retain rich source alongside plain text. Previously cached comments need a fresh ticket fetch to recover formatting. Markdown image comments use the shared Markdown renderer with local attachment previews.
- Existing PR description Markdown previews remain inline. The attachment accordion remains available as a separate index.
- Before push: all 84 Node tests and the production build passed. Inline ticket image placement was reviewed in code; live Azure image loading was not exercised.
- Status badges now use fit-content width and nowrap, matching task-type badges.
- Ticket row actions use eye/eye-off and trash icons, accessible names and hover titles, with an 8px gap. Final pre-push validation: 84 tests and production build passed.
