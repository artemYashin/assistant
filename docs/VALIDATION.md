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

## PR tools in chat

- Added scoped, paginated local PR listing and reading of synchronized descriptions/current-version review results. PR identity includes monitor/repository/number to avoid ambiguous numeric IDs. PR-number prompts no longer trigger ticket prefetch.
- Explicit review commands can enqueue the existing manual review workflow, preserving draft/scope/credential checks, idempotence, daily budget, separate review model and memory context. Chat receives actual job status; the worker starts after the active chat ends. No Azure writes or automatic polling loops are introduced.
- Pre-push validation: all 85 tests and production build passed. New coverage checks pagination/default arguments, context isolation, explicit request guard, queue deduplication and draft rejection. Live Copilot tool selection and Azure review execution not exercised.

## Reverse ticket-to-PR links

- Shared ticket cards now include related open PRs found by the existing #ticket parser in synchronized descriptions. Matching uses the ticket's Azure source/project, enabled monitors and current in-scope PRs; closed/out-of-scope PRs disappear after a successful sync. No Azure mutations.
- The card shows title/link, author, context, draft label and sync time, with a stale-data warning when the monitor has an error. The UI explains that coverage is limited by configured repositories/reviewer filters and the last sync.
- Tests/build deferred until push as requested.
- Reverse PR links navigate internally using monitor/repository/number URL parameters. The PR page loads the exact target independently of list limits and context filters, highlights it and scrolls/focuses it once; polling does not repeatedly move focus. Missing targets have an explicit message and a link back to the current project's full list. Global chat/project selection is unchanged. Tests/build remain deferred until push.
- Pre-push validation: all 86 tests and production build passed. Added assertions for reverse links, source isolation, exact ticket IDs, inactive monitors/out-of-scope exclusion, draft inclusion, exact PR lookup beyond the 300-row list limit, and encoded internal links. Draft cards have a gray background and dashed border; focused drafts retain focus highlighting. Live browser focus behavior and Azure sync were not exercised in this validation.

## Global ticket lookup dialog

- Moved full ticket lookup from the Tickets page to a header button available across sections. A native modal contains the number field and shared full card, supports Escape/close and restores focus; its close button remains visible while scrolling.
- Following internal PR links closes the dialog to reveal the target. Changing Azure connection remounts lookup to avoid showing a previous source. A new lookup clears the previous result; closing discards the dialog's local lookup state.
- Tests/build deferred until push per user request.

## Accordion headers

- All native summary headers share a custom rotating chevron, subtle hover and keyboard focus styles. Header text selection is disabled (including WebKit); content selection is unchanged. Reduced-motion preferences disable animation. Tests/build deferred until push.
- Pre-push validation for global ticket lookup and accordion styling: all 86 Node tests and production build passed. Browser interaction was not exercised in this validation.

## Ticket header sorting

- Replaced the separate sort dropdown with keyboard-accessible table header buttons and direction indicators/aria-sort. The ticket column offers ID and title separately; type, status, Azure assignee, local assignee and sync date are also sortable. Default remains newest IDs first. Tests/build deferred until push.

## Ticket multi-select filters

- Replaced native single selects for type, status and assignee with custom searchable checkbox menus, selection counts, per-filter reset and Done controls. Escape/outside click/Tab departure close the menu. Azure and local assignees remain separate groups; unassigned local tickets can be selected explicitly.
- Selected values are ORed within one filter, while filters and text search combine with AND. Empty selection means all values. Global reset clears all arrays; deep-linked tickets continue to bypass filters.
- Tests/build deferred until push as requested.
- Pre-push validation for header sorting and custom multi-selects: all 86 Node tests and the production build passed. Browser interactions were not exercised in this validation.

## Ticket navigation from chat

- Ticket list/detail tools now supply canonical source-scoped local URLs. The assistant policy requests a navigation link per displayed ticket; Markdown renders only validated internal ticket URLs as router links styled as compact buttons. Existing history retains links as Markdown.
- Shared ticket cards also expose a direct navigation action, independent of model formatting. Navigation uses the existing ticket focus route; untracked tickets still require explicit local addition on that page, never an implicit Azure write.
- Tests/build deferred until push per user request; live model link formatting not exercised.

## Multi-select checkbox dismissal fix

- Removed blur-based dismissal: clicking label text can blur the search input with a null relatedTarget before the browser forwards the click to the checkbox, unmounting it too early. Dismissal now uses outside pointerdown or actual focusin outside the component; internal label clicks remain open and keyboard Tab departure still closes it.
- Tests/build deferred until push per user request.
- Pre-push validation: all 88 Node tests and production build passed, including internal Markdown ticket navigation and invalid-link rejection. Filter order is Type → Status → Assignee. Browser checkbox interaction and live model formatting were not exercised in this validation.

## Context selector and manager redesign

- Replaced client/project native selects (including project owner creation) with searchable custom single-select menus. They support arrow-key navigation, Enter, Escape, outside pointer/focus dismissal and selected-state indicators.
- Context manager now separates Overview, Add and Repository. Overview groups projects under customer accordions; Add shows one creation form at a time; Repository shows only the selected project's settings. Context switching still persists immediately and creation selects the new context.
- Validation: all 88 Node tests and production build passed. Headless Chromium with mocked API verified client/project switching, search, arrow-key selection, single-form creation layout, repository section, no remaining native selects in context UI, and mobile document width. Screenshot inspected; checkbox alignment adjusted. Live Azure/Copilot not exercised.

## Custom PR filters and sorting

- PR type, review readiness and sort controls now reuse the searchable SingleSelect used for customer/project selection. Existing options, defaults, reset and filtering semantics remain. Filters are disabled when showing a directly linked PR because the target view bypasses them.
- Validation: all 88 Node tests and production build passed. Mocked-API Chromium checks passed for date sorting, combined filters, empty/reset states, mobile overflow and absence of mutation requests during filtering.

## Review clarification and proposed memory

- Added durable review-question batches and an awaiting_answers review state. All nonempty answers must be submitted atomically; only then is the same version requeued, once. Prior answers are included in the next review. Existing daily/tool/token/time budgets apply; at most three clarification rounds per version. Changed/out-of-scope/draft/disabled PRs cannot be requeued with old answers. Questions can be dismissed without a rerun.
- Actual PR reviews now expose only ask_review_questions and propose_memory, under the same tool budget. No Teams sends, state changes, arbitrary tools, or direct memory writes are available during review. The review prompt focuses on concrete defects, evidence and uncertainty. Legacy tool-less review calls remain supported.
- Memory proposals retain their original scope/context, require explicit UI approval, deduplicate pending/existing exact records and are atomically accepted/rejected. Chat direct saves require explicit current-message memory intent; system instructions request clear paraphrases without changing meaning. Pending proposals are not included in memory context.
- Inbox and Approvals moved to the sidebar bottom and remain active with counts. Teams is disabled in navigation; stored connection settings are unchanged. Added question forms and memory approval cards; PR cards link to Inbox when waiting.
- TypeScript check passed. Added lifecycle, approval and tool-boundary regression tests, but did not run tests/build per user's request to reserve tests for push. Live LLM behavior and browser flows are not verified yet.

## Status editors and local developer directory

- Added status editors to table and full ticket cards, using live type-specific Azure states and the existing revision-guarded PATCH + verification GET workflow. Source checks prevent writes after an Azure connection change. Card status is on its own labelled row; local browser events update visible cards/table. Chat retains its explicit-intent verified status tool.
- Added local developer directory scoped to general/client/project, bulk name entry, rename and retirement, plus multi-person local assignments. Existing Azure-derived assignments migrate once into local records. Retirement does not erase current assignments. Legacy one-person API remains compatible, but new UI and chat tools use only local directory data.
- Chat can read local developers and replace local assignments with explicit ticket/name intent; add/remove instructions must preserve other assignees. Source scoping, membership checks and per-turn duplicate guards apply. No Azure assignment writes.
- TypeScript check passed. Added regression tests for directory scope, multiple assignees, retirement, migration, chat intent and status API CSRF/source checks. Tests/build and browser interaction deferred until push per user preference.

## Memory proposals from clarification answers

- Review policy explicitly evaluates previousQuestionsAndAnswers for durable knowledge, asks for a standalone paraphrase preserving conditions, the narrowest appropriate scope and a reason identifying the supporting answer. It excludes uncertain/temporary/secret content and asks to avoid existing knowledge. Existing propose_memory approval and exact-record deduplication apply; no extra model invocation was added.
- Inspected answer injection and review tool availability. Prompt-only change; tests/build deferred until push. Live model proposal quality remains unverified.

## Pre-push validation of review feedback and local assignments

- All 96 Node tests passed, including review clarification/re-review lifecycle, memory proposal approvals, local developer migration and multi-person assignments, and status API protection. Production build passed (TypeScript, Vite and server compilation).
- Vite reports the existing bundle-size warning (main chunk above 500 kB). Browser interaction and live Azure/Copilot behavior were not exercised for this batch.

## Inbox within Pull Requests

- Moved Inbox to a URL-backed tab at `/pull-requests?tab=inbox`, retaining pending counts and existing question/suggestion actions. Legacy `/inbox` redirects with history replacement; overview actions and review cards open the tab. Direct PR focus links continue to open the list.
- Approvals is back in the main sidebar navigation with its pending count; Teams remains disabled at the bottom.
- TypeScript check and diff whitespace check passed. Tests/build deferred until push as requested; browser interaction not exercised.

## Accordion header hit areas

- Shared summary headers now span the available width with padding and a 44px minimum height. PR description/history/review and customer accordion headers include their container padding in the native click target; ticket section top spacing is part of the summary. Expanded content remains separate, preserving normal text selection and controls.
- Diff whitespace check passed. Tests and browser checks deferred until push per user preference.

## Accordion icons and review action

- Added decorative semantic Lucide icons to every summary header: descriptions, reproduction steps, acceptance criteria, comments, attachments, linked PRs, raw fields, review history/results, context/version menus, customers/developers and OAuth settings. Existing disclosure chevrons and full header hit areas remain.
- PR review launch has a purple accent, focus/hover/disabled styles and state-specific icons and labels for queued, running, awaiting answers and completed reviews.
- TypeScript and whitespace checks passed. Tests and visual browser checks deferred until push.

## Pre-push validation of navigation and accordion polish

- All 96 Node tests and production build passed. Diff whitespace check passed. Vite retains the bundle-size warning (main chunk above 500 kB).
- This batch includes the PR Inbox tab, primary-sidebar Approvals, larger accordion hit areas, semantic icons and the accented review action. Browser visual/interaction checks were not performed for this batch.

## Preserve PR scroll when launching review

- Review launch and manual sync no longer empty the PR list while refetching the same query. Existing keyed cards stay mounted, avoiding page-height collapse and retaining accordion state. Scope/target changes still clear the old list.
- TypeScript and whitespace checks passed. Tests/browser checks deferred until push per user preference.

## Running review spinner

- Running review button now uses the existing spin animation class. The application's reduced-motion preference continues to disable animation. Whitespace check passed; tests deferred until push.

## Pre-push validation of PR refresh fixes

- All 96 Node tests and production build passed. Whitespace check passed. Vite retains the existing main-bundle size warning. Browser scroll/animation behavior was not exercised in this validation.

## Explicit PR merge and linked-ticket transitions

- Added a UI-only prepare/confirm workflow with durable plans and one-shot claims per PR source version. Live commits, source, membership, linked/description ticket IDs and selected per-ticket states are checked before mutation. Prepared plans expire after 15 minutes. Existing auth/Origin/CSRF middleware protects endpoints.
- Merge PATCH explicitly disables policy bypass, branch deletion and automatic work-item transitions. A separate bounded GET loop must confirm completed status and the expected source commit before any ticket writes. Existing revision-guarded state transitions verify each ticket with GET. Partial and ambiguous results are persisted; no merge retry or rollback is attempted. Agent tools remain unchanged.
- Dialog offers actual type-specific states, an intersection for apply-to-all, Resolved only when present, merge strategy selection and explicit confirmation. Errors and per-ticket outcomes remain visible; operation status can be reread after a network error.
- Added regression tests for linked/mentioned IDs, duplicate submissions, stale commits, incompatible states, merge failure preventing ticket writes and partial results. TypeScript passed; tests/build deferred until push per user preference. No live Azure merge or browser interaction performed.

## Separate merge-only action

- PR cards expose Merge and Merge with status changes separately. Merge-only plans skip work-item links and state reads entirely, persist their mode and reject ticket selections on confirmation. Both modes disable automatic Azure work-item transitions and preserve the one-shot merge guard.
- Added a regression case asserting merge-only performs no work-item reads/writes and rejects injected ticket selections. TypeScript passed; tests deferred until push. No live merge performed.

## Side-by-side PR diff viewer

- Added a read-only diff endpoint using live PR commit IDs and the existing bounded merge-base diff loader. Validates known PR/repository and current Azure credentials; no agent/model call or Azure mutation.
- Added View Diff per card and a large modal with file navigation, side-by-side change rows, line numbers, additions/deletions, rename paths, missing-newline notices, loading/error/retry and explicit coverage warnings. Code is escaped React text. Mobile retains side-by-side via horizontal scrolling.
- Added parser cases for replacements, unequal line counts, new/deleted/renamed files and missing final newline, plus a service read-only/no-LLM test. TypeScript passed; tests/build deferred until push per user preference. Live Azure/browser checks not performed.

## Ticket trash and navigation order

- Reordered primary navigation as requested. Ticket tabs use `/tickets` and `/tickets?tab=trash`; direct ticket focus URLs continue to show the active table.
- Removal atomically saves a separate local snapshot and removes the active-list row while retaining local developer associations and the auto-import exclusion marker. Repeated removal does not reset the 30-day retention clock. Restore is source-guarded and local-only. Explicit track removes its trash snapshot after successful import.
- Expiry purges trash snapshots and inactive assignment records at startup, sync, trash reads/restores and explicit track/removal. Exclusion markers remain; old pre-feature removals have no recoverable snapshot.
- Added regression tests for snapshots, assignments, restoration, repeated removal, source mismatch and exact expiry boundary. TypeScript/whitespace checks passed; tests/build deferred until push. Browser interaction not exercised.

## Workspace registry available to chat and pre-push validation

- Chat now receives a fresh compact workspace snapshot per request and a read-only get_workspace_context tool with pagination and optional known-context selection. It includes context registry, scoped/inherited developer names and IDs, repository, Azure project and PR selection mode; secrets are never projected. Pages are limited to 10 entries per list to stay below ordinary tool output limits.
- Added scope, registry, repository, pagination and secret-exclusion regression coverage. All 108 Node tests and the production build passed for the full batch (merge workflows, diff viewer, trash, sidebar and chat context). Diff whitespace check passed.
- Vite retains its main-chunk-size warning. Live Azure writes, live Copilot behavior and browser visual/interaction checks were not performed; no real PRs were merged during development.

## Trash table parity

- Replaced trash cards with the ticket table styling, configured type/status badges, text search including local developer names, custom multi-select filters (type, state, Azure/local assignee), sortable column headings, visible count and filter reset. Retained snapshot assignees, expiry/removal timestamps and per-row restore; default sort is newest removal first.
- All 108 Node tests and production build passed (existing Vite bundle-size warning). Mocked-API Chromium verified search, checkbox filtering, header sorting, restore request/removal, no JS errors and mobile document width. No live Azure requests performed.

## PR conflict and CI health

- Synchronization stores mergeStatus and bounded policy evaluations per PR, including Build Validation, required flags and stale-build markers. Policy fetch errors are isolated from normal PR synchronization and displayed as unavailable. Evaluations use the preview API version and up to 500 records; incomplete scans are not presented as passing.
- Cards display conflict and build-policy CI badges with an expandable list of all enabled policies, timestamp and stale/out-of-scope warnings. Non-policy external statuses are not included. No new model calls or writes to Azure.
- Added policy classification/rendering regression coverage for failed builds, stale success and unavailable data. TypeScript/whitespace checks passed. Tests/build deferred until push; live Azure policy responses and browser interactions not verified.

## Retry rejected merge after PAT permissions change

- Upstream HTTP errors retain a structured status internally. Explicit 401/403 rejection plus a verified still-active PR becomes a retryable rejected result. Preparing a new confirmation rechecks live PR state and safely releases only a prior permission-denied claim, including legacy persisted unconfirmed results containing the known HTTP 401/403 diagnostic. No automatic PATCH retry; old confirmations remain idempotent.
- Duplicate claims now persist a reference to the original operation, and result checks follow that reference instead of incorrectly returning prepared. Timeouts, HTTP 5xx, running, successful and partial operations retain their protection.
- Added regression cases for legacy permission-error recovery and ambiguous-result blocking/reference resolution. TypeScript/whitespace checks passed. Tests deferred until push; no real Azure mutation performed.

## Pre-push validation: PR health and permission-denied retry

- All 111 Node tests and production build passed, including recovery of persisted permission errors, duplicate-operation result resolution, ambiguous merge protection and policy health rendering. Whitespace check passed.
- Vite retains the existing main-bundle size warning. No live Azure merge or browser interaction performed for this batch.

## Hide completed PRs from the main list

- Default PR list now requires current active-scan membership and an enabled monitor. Confirmed local merges already clear membership; externally completed PRs disappear after the next successful active-only Azure scan. Historical reviews remain stored and available through explicit PR links. Failed scans still preserve previous membership.
- Added regression coverage for disappearance after a successful scan and direct history access. TypeScript/whitespace checks passed; tests deferred until push.

## Correct CI success classification

- Fixed a false pending result caused by treating internal policy context.isExpired/buildIsNotCurrent flags as authoritative over evaluation.status. Azure documents approved as fulfilled and context as internal data. Rendering now uses evaluation status directly, including already persisted health records; only queued/running mean pending. notApplicable builds and deleted/disabled policies do not block success.
- Updated regression coverage for approved with internal/cached stale flags, actual queued checks, unknown/rejected states and notApplicable. TypeScript/whitespace checks passed; tests deferred until push. User's actual Azure response was not available; existing sync interval still determines freshness.

## Pre-push validation: active PR list and CI classification

- All 113 Node tests and production build passed, including active-list/history separation and approved policy status with stale metadata. Diff whitespace check passed. Vite retains the existing main-bundle size warning; live Azure and browser interactions were not exercised for this batch.

## PR author placement

- Moved author and creation timestamp together directly below the toolbar/status row, before the title, CI checks and branches. The metadata row wraps on narrow screens. Whitespace check passed; tests deferred until push.

## PR card hierarchy and grouped actions

- Updated requested hierarchy: PR/review/draft badges, then linked number/title, then author/date, then branches. Action buttons now occupy a separate bordered row. Context/version disclosures use a two-column metadata grid with inline content instead of overlapping dropdown panels; narrow screens stack these sections and wrap actions. CI, description, tickets and review sections follow below.
- TypeScript and whitespace checks passed. Tests/browser checks deferred until push.

## Pre-push validation: PR card hierarchy

- All 113 Node tests and production build passed. Mocked-API Chromium checks passed for PR sorting/filtering/reset, mobile overflow and absence of mutation requests. Inspected the desktop screenshot: badges, title, author/date, branches, actions and paired metadata disclosures appear in the requested order. Vite retains the existing bundle-size warning.

## Manual local PR-ticket links

- Added source-validated, idempotent local PR-ticket associations with link/unlink UI. Missing tickets are loaded through the existing read-only Azure track path; removed tickets require explicit restore first. Manual links are unioned with description mentions and included in reverse active-PR lookup; synchronization does not overwrite them.
- Merge-and-transition preparation includes manual links and revalidates the union on confirmation. Plain merge still skips work-item operations. Linking/unlinking itself never writes to Azure; removal preserves the ticket and any description-derived association.
- Added regression coverage for local link deduplication, sync persistence, reverse lookup, source guard and unlink. TypeScript/whitespace checks passed. Tests/build deferred until push; browser/live Azure checks not run.

## Pre-push validation: manual PR-ticket links

- All 114 Node tests and production build passed, including manual association persistence, reverse lookup, deduplication, unlink and source checks. Whitespace check passed. Vite retains the existing bundle-size warning. Browser/live Azure interactions were not exercised for this batch.

### Настройки вопросов и контекст требований ревью
- Добавлен диалог запуска, сохранение режима вопросов и флага чтения тикетов для повторной проверки.
- TypeScript: npm run check — успешно. git diff --check — успешно.
- Добавлены тесты отключения вопросов, загрузки нескольких страниц комментариев и остановки при недоступных комментариях. Тесты пока не запускались: по договорённости выполняются перед push.
- Живые Azure/Copilot и браузерная проверка этого изменения не выполнялись.

### Завершение без ответов и повторные ревью
- Добавлено атомарное завершение ревью при игнорировании вопросов без вызова LLM.
- Миграция снимает ограничение одного отчёта на версию, сохраняя существующие отчёты и связи вопросов. Список PR и инструмент чтения выбирают последний запуск.
- Комментарий ревьюеру ограничен 4000 символами, хранится в параметрах запуска и передаётся модели.
- npm run check и git diff --check прошли. Добавлен сценарий игнорирования, повторного запуска, сохранения истории и защиты от дублирования очереди. Тесты отложены до push по просьбе пользователя.

### Проверка перед push — 2026-10-19
- npm test: все 118 тестов прошли, включая настройки ревью, пагинацию комментариев, остановку при неполных данных, игнорирование вопросов и сохранение истории повторных запусков.
- Обновлено прежнее ожидание cancelled на completed для игнорирования вопросов.
- npm run build: успешно; остаётся предупреждение Vite о JS-бандле больше 500 kB.
- git diff --check: успешно. Живые Azure/Copilot не вызывались.

### Компактная карточка PR, коммиты и пути diff — 2026-10-20
- npm test: 120 тестов прошли. Добавлены проверки пагинации истории коммитов, отсутствия мутаций/LLM и сокращения каталогов без изменения имени файла.
- npm run build: успешно; прежнее предупреждение Vite о размере JS-бандла >500 kB.
- Playwright с моками API: открытие/закрытие контекста, версии, истории ревью, подробностей Azure, истории коммитов и View Diff; сокращённый путь, полное имя файла, разные цвета +/-; нет ошибок страницы и POST-запросов.
- git diff --check: успешно. Живой Azure не вызывался.

### Diff отдельного коммита и действия PR
- Добавлены ссылки на коммиты Azure и diff относительно первого родителя с проверкой принадлежности PR.
- Кнопка ревью перенесена первой и увеличена; иконка контекста заменена на Info.
- npm run check и git diff --check прошли. Добавлен тест родительского сравнения, принадлежности и отсутствия вызовов LLM; запуск тестов отложен до push по просьбе пользователя.
- Живой Azure и браузер в этой доработке не проверялись.

### Размещение служебных кнопок PR
- Бейджи конфликтов/CI сверху справа, три информационные кнопки отдельной строкой под ними.
- Версия изменений: Info; контекст: Layers; история ревью: History + ClipboardCheck, с сохранением доступных названий и подсказок.
- npm run check и git diff --check прошли; тесты отложены до push.

### Локальные заметки, приоритеты и теги тикетов
- Отдельная SQLite-таблица с ключом source/id, частичные обновления, валидация диапазона и тегов. Нет Azure-записей.
- Таблица и корзина: столбцы/фильтры/сортировка; заметки в диалоге, отображение в карточке.
- Количество приоритетов настраивается в контексте заказчика/проекта, с наследованием и сбросом переопределения.
- Чат получает новые поля, фильтры и инструмент постраничного чтения заметок.
- npm run check и git diff --check прошли. Добавлены тесты изоляции, валидации, наследования, частичных обновлений, фильтров и корзины; запуск отложен до push по просьбе пользователя.
- Браузерная проверка и живые интеграции для этой доработки не запускались.

### Дата и бейдж результата PR
- Дата создания перенесена между названием и автором.
- Только бейдж результата ревью: idle — бледно-красный; completed — насыщеннее зелёный. Бейджи CI, состояние выполнения и фон карточки не изменены.
- npm run check и git diff --check прошли. Тесты отложены до push.

### Итоговая проверка перед push — 2026-10-20
- npm test: все 123 теста прошли.
- npm run build: успешно. Прежнее предупреждение Vite о JS-бандле >500 kB.
- Playwright с моками API: сохранение заметок, тегов и приоритета, фильтрация по тегу, сортировка по приоритету.
- Playwright PR: диалоги контекста/версии/истории/CI, история коммитов, Azure-ссылка, diff отдельного коммита и возврат к истории, сокращённые пути и цвета строк; первая кнопка ревью, дата между названием/автором, служебные кнопки под бейджами.
- Ошибок JavaScript в проверенных сценариях нет. Живые Azure/Copilot не вызывались.
- git diff --check: успешно.

### Изменение локальных метаданных через чат
- Добавлен update_local_ticket_metadata только для чата, с проверками текущей команды/номера/полей и источника.
- Операции append/replace/clear заметок, add/remove/replace/clear тегов, установка приоритета; неизменённые поля сохраняются.
- Дедупликация одинаковых вызовов по полям в пределах сообщения, локальный audit без содержимого заметок.
- npm run check и git diff --check прошли. Добавлены тесты сохранения полей, дедупликации, запретов, валидации приоритета, смены подключения и отсутствия сетевых запросов; запуск отложен до push.

### Дата последней синхронизации
- Тикеты: source-scoped timestamp записывается после успешного полного обновления/импорта; пустой проход без обращения к Azure его не обновляет.
- PR: существующий synced_at монитора, отдельная строка на репозиторий в выбранном контексте. Смена репозитория/режима сбрасывает timestamp.
- Формат даты/времени — ru-RU, часовой пояс браузера; отсутствие даты показано явно.
- npm run check и git diff --check прошли; тесты отложены до push.

### Исключения файлов и бюджет diff ревью
- Настройки репозитория: до 100 root-relative glob-правил и общий бюджет diff 40–400 тыс. символов.
- Исключения до загрузки содержимого/лимита 100 файлов, пагинация списка с ограничениями; ручной View Diff сохраняет доступ к исключённым файлам.
- Общий бюджет по умолчанию 160 тыс., не более четверти на файл; конкретные причины пропусков в coverage.
- npm run check и git diff --check прошли. Добавлены тесты glob, исключений до чтения/лимита и сохранения бюджета для небольших файлов. Запуск тестов отложен до push по договорённости.

### Компактная верхняя панель
- Удалена постоянная подсказка о сохранении контекста; состояние сохранения остаётся на кнопке.
- Селекты контекста ограничены 220 px на широком экране, адаптивно переносятся на узком.
- Панель выделена фоном и границей как второй уровень шапки.
- Над фильтрами PR оставлены дата синхронизации, короткий интервал опроса и сообщения об ошибках/отключённом опросе; длинные пояснения убраны.
- npm run check и git diff --check прошли. Тесты отложены до push.

### Группы действий и просмотр результата PR
- Слева: Review → View Diff → Коммиты; справа: Merge и Merge со сменой статусов, через space-between с адаптивным переносом.
- Контрастные тёмные подписи на сером/зелёном/оранжевом фоне.
- Результат вынесен в диалог по кнопке глаза рядом со статусом; история рядом только при числе непустых сохранённых отчётов >1.
- Последний отчёт предыдущей версии доступен с явной пометкой, даже если текущая версия ещё не проверена.
- npm run check и git diff --check прошли; тесты отложены до push.

### Сворачиваемая навигация
- Добавлена кнопка сворачивания/разворачивания левого сайдбара; компактная ширина 64 px.
- Подписи скрываются, иконки сохраняют доступные имена и подсказки; счётчик подтверждений виден.
- Выбор сохраняется в localStorage с существующей безопасной обёрткой; по умолчанию на узком экране меню свёрнуто.
- npm run check и git diff --check прошли. Тесты отложены до push.

### Приоритет новых тикетов P1
- Новый локальный приоритет по умолчанию — P1 в API, чате, таблице и фильтрах.
- Одноразовая миграция материализует прежний P2 у существующих тикетов и корзины, не меняя явно сохранённые значения.
- npm run check и git diff --check прошли; тест миграции добавлен, запуск отложен до push.

### Итоговая проверка накопленных изменений — 2026-10-20
- npm test: все 130 тестов прошли, включая локальные изменения через чат, миграцию P1, исключения файлов и бюджет diff.
- npm run build: успешно; прежнее предупреждение Vite о размере JS-бандла >500 kB.
- Playwright с моками: сворачивание сайдбара и сохранение после reload, порядок действий PR, попап результата, условная история нескольких ревью, отсутствие старого аккордеона и подсказки о сохранении.
- git diff --check: успешно.
- Локальный сервер, запущенный по ошибочно понятой просьбе, остановлен.

### Прокрутка модальных окон
- Пока открыт нативный modal dialog, overflow страницы заблокирован; у диалога overscroll-behavior: contain.
- scrollbar-gutter: stable сохраняет место полосы прокрутки, чтобы фон не сдвигался при открытии.
- CSS автоматически снимает блокировку после закрытия последнего модального окна, включая вложенные окна.
- git diff --check прошёл. Браузерные проверки и тесты отложены до push по договорённости.

### Единый диалог Merge
- Убрана вторая кнопка; moveTickets по умолчанию false, опциональная галочка внутри диалога.
- Отдельная read-only проверка связей без чтения статусов, создания плана или изменений Azure.
- При переключении режима план сбрасывается и готовится заново; отправка блокируется до готовности.
- Список тикетов оформлен карточками с названиями, текущими/целевыми статусами и общим селектом.
- npm run check и git diff --check прошли. Добавлен тест read-only discovery; тесты и браузерная проверка отложены до push.

### Общие настройки diff и ревью
- Исправлено расхождение: View Diff и diff коммита теперь используют исключения проекта и тот же бюджет (по умолчанию 160 000). Ранее просмотр обходил исключения и использовал 80 000.
- Исключения применяются до чтения содержимого и расходования бюджета; добавлена проверка точного пути /src/api/generatedApi.ts в регрессионный тест.
- В окне просмотра показаны фактический общий/пофайловый бюджет, расход и число исключённых файлов.
- npm run check и git diff --check прошли; запуск тестов отложен до push по просьбе пользователя.

### Создание PR, компактные таблицы и итоговая проверка — 2026-10-20
- Добавлены поиск веток Azure и явная форма создания PR; API проверяет контекст, существование веток, совпадение source/target и уже открытые PR. Регрессионный тест проверяет отсутствие лишних записей и состав POST.
- Таблицы active/trash используют fixed layout, ограничение заголовка пятью строками, ellipsis для бейджей и перенос элементов управления. Вариант с верхней горизонтальной прокруткой удалён по просьбе пользователя.
- Playwright с моками: поиск/выбор веток, заполнение и создание PR одним POST; таблицы active/trash с широким чатом, длинными заголовками и Ready for Development помещаются без горизонтального overflow. Просмотрен снимок таблицы.
- npm test: 132/132 успешно. npm run build: успешно, прежнее предупреждение Vite о JS-бандле >500 kB.
- При проверке diff исправлена остановка на повторяющихся страницах Azure; тест исключений дополнен необходимой синхронизацией fixture перед View Diff.
- Реальные PR в Azure не создавались; корпоративное подключение не проверялось.

### Компактная шапка карточки тикета
- Номер и название объединены; навигация в локальный трекер и Azure перенесена в правую часть шапки с переносом на узких экранах.
- Тип, статус, локальный приоритет и теги собраны в компактную сетку с подписями; убраны отдельные вертикальные блоки и двойные отступы статуса. Заметки остаются самостоятельной секцией.
- Уменьшены отступы между секциями и в метаданных. npm run check и git diff --check прошли. Тесты отложены до следующего push по договорённости; браузерная проверка пока не выполнялась.

- Название проекта убрано из шапки карточки по просьбе пользователя.

### Закрытые вопросы ревью и проверка перед push
- Неактуальные, отвеченные и проигнорированные блоки имеют серый фон, метку «Закрыто · ответ не требуется» и причину. Вместо disabled textarea — статический сохранённый ответ.
- Актуальность pending-вопросов теперь учитывает состояние самого ревью (оно должно ожидать ответов), помимо версии и области синхронизации PR.
- Накопленные изменения компактной карточки тикета включены; название проекта убрано.
- npm test: 132/132 успешно. Production build успешно, прежнее предупреждение Vite о JS-бандле >500 kB. git diff --check прошёл. Браузерная проверка этих последних изменений не проводилась.

### Визуальное разделение секций тикета
- Аккордеоны карточки получили полную рамку, скругления и отдельную белую область содержимого. Открытый заголовок выделен контрастным серым фоном и нижней границей.
- Playwright с моками: раскрытие/сворачивание описания и цвет открытого заголовка; просмотрен снимок карточки. Ошибок страницы нет.
- npm test: 132/132 успешно; production build успешно (прежнее предупреждение о размере бандла). git diff --check прошёл.

### Источники связей PR и выборочная смена статусов
- Найдено расхождение: карточка использовала описание и локальные связи, Merge дополнительно читал Azure workitems. Теперь синхронизация сохраняет связи Azure локально; карточка, обратные связи и review учитывают также #номера в названии. Источники подписаны, ошибки обновления связей видимы. Merge обновляет кеш связей после проверки.
- Удаление локальной связи не удаляет Azure-связь и упоминания; UI объясняет оставшиеся источники. Записей в тикеты при чтении/синхронизации связей нет.
- В Merge «Не менять статус» по умолчанию для каждого тикета; явный null проверяется сервером в полном списке выбора и пропускает чтение доступных статусов на этапе execute и изменение статуса. Проверка неизменности полного списка связей сохранена.
- Добавлены регрессионные тесты сохранения Azure-связей после удаления локальной и пропуска status write. Запуск отложен до push по просьбе пользователя. npm run check и git diff --check прошли.

### Вкладка завершённых PR
- Три вкладки с иконками: Активные / Завершённые / Входящие.
- GET /pr/completed читает только выбранную страницу одного настроенного репозитория: $top=21, $skip=page*20. UI выводит 20 карточек, Назад/Далее, автора, дату завершения, ветки, ссылку Azure и сохранённое ревью.
- TTL кеша 60 секунд, до 50 страниц, дедупликация concurrent запросов, максимум 4 разных загрузки одновременно; нет фонового опроса, автоматической подгрузки следующих страниц или LLM.
- Добавлен тест ограниченной выдачи, пагинации, кеша и объединения запросов. Тесты отложены до push по просьбе пользователя. npm run check и git diff --check прошли. Реальная Azure-история и браузер пока не проверялись.

### Полные карточки завершённых и хранение 30 дней
- Переиспользуется карточка активных PR с readOnly-режимом: Completed + замок, описание/изображения, связи, ревью/история, кнопки diff/коммиты. Изменяющие действия скрыты.
- Страница Azure ограничена последними 30 днями по Closed; 20 записей. При первой загрузке последовательно дочитываются связи и обрезанное описание; полный снимок сохраняется в SQLite, повторная загрузка использует его.
- Срок истечения — closedDate + 30 дней, показан в карточке. purgeCompleted вызывается при старте, sync и чтении истории; удаляет PR, reviews/questions, локальные связи, кеш связей и merge plans/attempts. Самостоятельные тикеты и Azure не затрагиваются. Merge через Orbit сразу регистрирует срок хранения.
- Тест страниц дополнен данными completed, проверкой сохранения полного описания и очистки. npm run check и git diff --check прошли; тесты и браузерная проверка отложены до push.

### Иконка изменения статуса в таблице
- Для ячеек основного списка принудительно сохранена одна строка status badge + edit, включая узкий container breakpoint. Бейдж сокращается, кнопка не сжимается и не переносится. Раскрытая карточка не затронута.
- git diff --check прошёл; тесты отложены до push.

### Инициалы автора тикета
- Общая карточка тикета показывает круглый аватар автора: первые буквы первых двух слов, одно слово — одна буква, отсутствующий автор — знак вопроса.
- Инициалы нормализуются NFC и uppercase; стабильный hash задаёт hue с постоянной тёмной насыщенностью/яркостью и белым текстом. Имя остаётся рядом, декоративные инициалы скрыты от screen reader.
- npm run check и git diff --check прошли. Тесты отложены до push.

### Вертикальные поля карточки
- Серый блок типа/статуса/локального приоритета теперь состоит из строк с общей шириной колонки подписей и значениями справа. Ширина подписи адаптируется к узкой карточке; статус и edit-кнопка не разделяются на разные строки.
- git diff --check прошёл; тесты отложены до push.

### Итоговая проверка перед push — 2026-10-20
- npm test: 135/135 успешно, включая источники связанных тикетов, выборочный пропуск статусов, пагинацию/кеш завершённых и очистку архива.
- npm run build: успешно; прежнее предупреждение Vite о JS-бандле >500 kB.
- Chromium/Playwright с моками: завершённая карточка с замком, отсутствие изменяющих действий, полное описание, сохранённое ревью и переход на следующую страницу без POST-запросов; карточка тикета и раскрытие/сворачивание её секций. Ошибок страницы нет.
- git diff --check: успешно. Реальный Azure не вызывался.

### Стабильные заголовки и кнопки таблицы
- Текст sortable-заголовка выделен в отдельный flex-элемент: переносится только текст, иконка остаётся справа. Исправление в активных тикетах и корзине.
- Локальное поручение, теги, приоритет и их кнопки остаются на одной строке; имена/теги сокращаются, кнопки не сжимаются. Подстроены доли ширины колонок.
- Playwright с моками и расширенным чатом: проверены координаты кнопок и сортировочных иконок, отсутствие горизонтального overflow активной таблицы/корзины.
- npm test: 135/135; production build успешно с прежним предупреждением о размере бандла; git diff --check успешно.

### Выделенный бейдж приоритета
- Приоритет получил отдельный класс с width: fit-content, увеличенным шрифтом 13px, жирным начертанием и контрастным янтарным фоном/рамкой. Одинаковое оформление в деталке, таблице и корзине; остальные бейджи не изменены.
- npm run check и git diff --check прошли; тесты отложены до push.

### Отступы раскрытого тикета и проверка перед push
- Ячейка раскрытой карточки имеет отдельный фон и адаптивные горизонтальные отступы 12–36px, вертикальные 24px; внутренние отступы карточки 16–28px, усиленная тень и рамка.
- Chromium с моками: проверены padding раскрытой строки, fit-content приоритета, раскрытие/сворачивание секций; ошибок страницы нет.
- npm test: 135/135 успешно; production build успешно с прежним предупреждением о размере бандла; git diff --check прошёл.

### Редактирование локальных данных из карточки и действия корзины
- Аккордеон заметок доступен даже при пустом тексте, редактор заметок и редактор приоритета переиспользуют локальный metadata API. Карточка и таблица обновляются событием после сохранения.
- Карточка получает текущий Orbit-контекст и признак наличия тикета в локальном списке; для непривнесённого тикета показано объяснение необходимости добавления в трекер. Azure-записей нет.
- В корзине заметки/восстановление — две компактные иконки на одной строке с tooltip/aria-label; восстановление имеет индикатор выполнения.
- Playwright с моками: изменение заметок и приоритета из деталки, немедленное обновление карточки, действия корзины на одной строке при расширенном чате и отсутствие overflow.
- npm test: 135/135; production build успешно с прежним предупреждением размера бандла. git diff --check успешно.

### Диагностика исключений и бюджета diff
- Прослежен общий загрузчик View Diff/commit diff/review: фильтрация до items-запросов, chars увеличивается только при включении patch. Исключённые и пропущенные файлы не расходуют бюджет. Ошибка списания исключённого файла по коду не найдена; данные пользовательского PR не доступны.
- Добавлена диагностика реально применённых правил/контекста, несовпавших правил, первых 100 исключённых путей и расхода каждого включённого patch. Диагностика не отправляется LLM. UI отдельно показывает общий остаток и лимит файла.
- Регрессионный тест дополнен равенством usedCharacters сумме patch.length, сравнением review/View Diff и списком исключённых путей. npm run check/git diff --check прошли; тесты отложены до push.

### CSV текущей таблицы тикетов
- Экспорт активной таблицы/корзины получает именно отфильтрованный и отсортированный массив. Шесть запрошенных колонок, полные заголовки/значения, UTF-8 BOM, CSV-экранирование кавычек и переносов, защита от интерпретации текста как формул.
- Генерация/скачивание локально в браузере, пустой экспорт отключён. Добавлен тест формата и порядка; запуск отложен до push. npm run check и git diff --check прошли.

### Проверка CSV и диагностики diff перед push
- npm test: 136/136 успешно, включая CSV-экранирование/порядок и проверку нулевого расхода исключённых файлов с одинаковыми данными review/View Diff.
- Production build успешно выполнен перед локальным запуском; после него исходники не менялись. Прежнее предупреждение Vite о размере бандла.
- Сервер, запущенный из-за оговорки «запустим», остановлен; порт 43871 свободен. git diff --check прошёл.

### Excel и CSV перед push
- npm test: 137/137 успешно. XLSX проходит запись/чтение с сохранением порядка, текстовых значений, жирных ID, переноса текста, фильтра и закрепления шапки. CSV проверяется с разделителем `;`.
- npm run build: успешно; ExcelJS вынесен в динамически загружаемый модуль экспорта. Vite предупреждает о размере крупных чанков.

### Выбор тикетов, массовые статусы и настраиваемый экспорт
- npm test: 139/139 успешно; проверены английские заголовки, выбор подмножества колонок, отсутствие невыбранных данных, локальные исполнители и оформление при изменении состава столбцов.
- npm run build: успешно (предупреждение Vite о крупных чанках).
- Playwright с перехватом всех API: выбор одной/всех строк, диалог экспорта, запрет пустого набора колонок, скачивание Excel с выбранными столбцами; массовый статус отправляет запрос только выбранному тикету после подтверждения. Реальный Azure не изменялся.

### Колонка выбора, контекст чата и размещение PR
- npm test: 139/139 успешно; затем добавлен тест передачи выбранных ID в чат и отказа при несовпадении источника Azure, tests/chat-management.test.ts: 4/4 успешно.
- npm run build: успешно; стандартное предупреждение Vite о крупных чанках.
- Playwright с mock API: отдельная колонка выбора, бейджи в чате, их очистка при переходе, экспорт и массовая смена статуса; отступ названия PR от бейджей не более 12 px, отсутствие max-width у main и обе кнопки действий страницы в одном блоке. Реальные Azure/LLM не вызывались.

### Смена статуса через контекст чата
- npm test: 144/144 успешно. Проверены ID из фильтрованного поиска, отклонение неизвестных ID, явная команда/целевой статус, отрицательные команды, сброс кэша после неудачной записи и отсутствие автоматического повторного PATCH.
- npm run build: успешно; предупреждение Vite о крупных чанках без ошибок сборки.
- Все проверки с подставными клиентами/коннекторами; реальные Azure и LLM не вызывались.

### Краткие тикеты в чате и страница разработчиков
- npm test: 146/146 успешно. Проверены явный запрос деталки, краткое чтение без повторной загрузки комментариев/карточки, изоляция заметок разработчиков и завершённых статусов по проекту, авторизация API.
- npm run build: успешно; стандартное предупреждение Vite о крупных чанках.
- Playwright с mock API: пять задач на странице разработчика, переключение страниц и вкладки завершённых, сохранение внутренних заметок, удаление блоков сайдбара и отсутствие переполнения карточки при узком окне.
- Реальные Azure и LLM не вызывались.

### Явный обход политик при merge
- npm test: 147/147 успешно. По умолчанию bypassPolicy=false, bypassReason отсутствует; явный обход требует непустую причину и передаёт её в Azure. Проверены сохранение transitionWorkItems=false и отсутствие повторной записи.
- npm run build: успешно; стандартное предупреждение Vite о крупных чанках.
- Проверки выполнялись на mock Azure; реальные PR не изменялись.

### Карточка в попапе после смены статуса
- npm test: 147/147 успешно; npm run build: успешно (предупреждение Vite о крупных чанках).
- Playwright с mock API: открыть тикет из хедера, изменить статус во вложенном диалоге, проверить сохранение карточки/новый статус, сохранить заметки и проверить сохранение карточки. Закрытие самого lookup очищает его при следующем открытии. Реальный Azure не изменялся.

### Завершённые поручения из корзины и размеры карточек
- npm test: 147/147 успешно; npm run build: успешно (предупреждение Vite о крупных чанках).
- API-тест проверяет сохранённых исполнителей удалённого тикета и исчезновение его из завершённых после восстановления.
- Playwright с mock API: минимум 550px у карточки, пагинация, активный список включает Closed, завершённый содержит удалённый Active, ссылка ведёт в корзину, настройка завершённых статусов отсутствует.
- Между опциями merge установлен grid gap 12px.

### Conversational bulk confirmation (2026-10-20)

- The chat policy asks for a normal text preview (full ticket titles and local navigation links) before changing multiple tickets, and waits for a textual confirmation. Single-ticket requests execute without an extra approval. This is a conversational model rule, not a persisted approval transaction or a new UI widget.
- A short confirmation after the prescribed preview continues the preceding user request for status, local tracker, developer and metadata tools. Metadata scope clarifications retain the original requested values and explicit exclusions; affected IDs must be resolved through tools again.
- `npm test`: 159 passed, including confirmation context, cancellation/unrelated replies, clarification exclusions, single status writes, deduplication and failed-write cache invalidation. Real Copilot conversation behavior and live Azure writes were not exercised.

### Azure bulk status transport (2026-10-20)

- Table bulk edits and consecutive status actions in the chat batch tool now use collection-level POST `/_apis/wit/$batch`, with revision-tested PATCH entries. Initial and verification reads use `workitemsbatch`; state lists are reused per work item type within a batch. The table also loads its status picker data in batches.
- Groups contain at most 25 tickets. Table selections beyond 25 are split sequentially. Already-correct states are omitted from writes; every reported successful change is independently verified from the subsequent bulk read. No automatic single-write fallback or retry after batch failure. Single chat edits retain the existing path. PR merge status updates are unchanged.
- Protocol reference: https://learn.microsoft.com/en-us/previous-versions/azure/devops/integrate/previous-apis/wit/batch?view=tfs-2017
- Pre-push validation: all 165 tests passed; production build and TypeScript checks passed. Regression cases cover request counts/shape, custom collection URLs, partial outcomes, cancellation and chat authorization/deduplication. Live Azure behavior has not been tested.

### Chat tool diagnostics and batched selection reads (2026-10-20)

- Root-cause inspection: the SDK pre-tool hook consumes one tool-call allowance per model invocation; batch children do not invoke that hook. However, the previous history policy asked the model to validate historical ticket IDs individually, which could exhaust 20 calls for a 23-ticket selection before mutation.
- `list_tickets` now accepts up to 50 exact IDs and a literal title substring search. Prompt guidance uses this batch read followed by one update batch, with pagination as needed. The final confirmation question no longer instructs the user to type a particular phrase.
- A context-scoped chat header dialog displays the last 20 requests with tool names, bounded argument summaries, results/errors, timestamps and durations. Internal batch children are labeled separately. Notes/message bodies/credentials are not persisted in argument summaries. Historic requests without trace records show a clear unavailable message.
- TypeScript check passed. Added regression tests for 23 edits within a 20-call budget, trace context isolation/redaction and exact-ID/title filtering. Pre-push validation: all 173 tests and the production build passed. Live model behavior has not been exercised.

### Explicit full-ticket analysis (2026-10-20)

- `list_tickets` defaults to `detail=summary` (local basic fields, tags, priority, local developers, bounded notes). Full descriptions/criteria are not fetched in this mode.
- `detail=full` requires exact selected IDs and server-checked explicit intent in the current user message. It reads description, acceptance criteria, reproduction steps, local notes and comments, with attachment metadata and upstream warnings. It does not expose unrelated Azure system fields or automatically display full ticket cards. Attachment binaries/image understanding are not part of this text search.
- Full-mode `search` searches the complete extracted text of the selected candidates. Results are bounded and paginated with `nextAfterId`/`nextContentOffset`; content is cached within the turn. Source/cancellation checks remain active.
- TypeScript check passed. Added tests for authorization, summary default, description search, pagination and chat integration; all 173 tests and the production build passed before push.

### Token warning before deep reads (2026-10-20)

- An explicit full-ticket/deep-analysis request now first receives a deterministic token-cost warning and a question, before starting the model or reading full Azure content. A separate affirmative answer to that immediately preceding warning authorizes the original read request for one turn only. Ordinary requests continue using summaries.
- Both `get_ticket` full cards and `list_tickets(detail=full)` are gated; consent cannot be supplied by ticket text or borrowed from a mutation confirmation. A changed current checkbox selection does not replace the originally confirmed selection. No separate approval table/widget is used; the warning and answer live in ordinary chat history.
- TypeScript check passed. Added/updated regression cases for no reads before consent, confirmation, refusal, unrelated replies, one-turn expiry and full-card display after consent. Pre-push validation: all 173 tests and the production build passed.

### Local-first chat ticket reads (2026-10-20)

- Fixed the remaining remote paths for ordinary chat queries: `get_ticket` now returns the saved SQLite summary by default; an unknown local ID returns a local-not-found error without Azure fallback. Automatic prompt enrichment skips numbers absent from the local tracker, so a count such as 23 does not trigger a remote lookup.
- Azure summary reads require the explicit read-only/add choice described below. Confirmed full-card/deep reads and the verification reads inside actual Azure status mutations remain available. Local summaries include their sync timestamp and are not described as freshly verified.
- TypeScript check passed. Added regression cases for zero remote reads for lists/known IDs/unknown IDs and local cache invalidation after a failed status write. Pre-push validation: all 179 tests and the production build passed.

### Explicit Azure lookup choices (2026-10-20)

- Ordinary ticket reads stay local. Missing local IDs prepare a visible question; list searches can propose a follow-up Azure search with exact IDs OR title/type/state criteria. The question includes the connection and local match count/preview.
- `request_azure_ticket_lookup` makes no Azure calls. After a separate choice, `lookup_azure_tickets` executes only the plan recorded in the previous assistant message. Read-only mode does not save tickets; add mode stores the returned basic records locally, never writes Azure. An ambiguous yes, changed source, unrelated reply or different IDs does not authorize the lookup.
- Searches are bounded to 50 returned records, with an explicit partial-results indication and no automatic additional-page fetch. Basic fields only; deep descriptions still use the separate token-warning flow. Identical execution within a turn is deduplicated. Direct add tools cannot broaden an approved lookup.
- TypeScript check passed. Added regression tests for consent/mode/source binding, read-only persistence, bounded escaped WIQL, and blocked unapproved requests. Pre-push validation: all 179 tests and the production build passed. Live Azure has not been exercised.

### Single tracked ticket exception (2026-10-20)

- A clearly identified single ticket already stored in the current local source may be read in full immediately when the user asks for its description/details or an opinion/deep analysis. Plain status/list requests remain local summaries. The exception is bound to that ID; both single-ticket reads and full list reads reject expansion without separate consent.
- Multiple tickets still require the token warning before deep reading. An absent single ticket is offered the explicit Azure read-only/add choice first, without fetching its description. A full-card request displays a card; an opinion alone does not automatically display a full card.
- TypeScript check passed. Added regression cases for numeric counts vs IDs, single/multiple checkbox selections, scope binding, immediate single local analysis and no reads/model calls before questions for missing/multiple tickets. Pre-push validation: all 179 tests and the production build passed. Vite reports its existing large-chunk warning. Live Azure and Copilot behavior have not been exercised.

### Iterative local search guidance (2026-10-20)

- Chat policy and list_tickets guidance now allow up to four distinct local summary search formulations, using distinctive user keywords or exact feature codes observed in relevant titles. Explicit filters/exclusions, pagination, deduplication and bulk confirmation remain required; this does not authorize remote or full-content reads.
- Pre-push validation: all 179 tests and the production build passed. Vite retains its large-chunk warning. Real model adherence to this prompt has not been exercised.

### Conversational local edits and compact metadata batches (2026-10-20)

- Local metadata writes no longer parse the latest user message for mutation verbs, field values or newly resolved IDs. The main assistant uses conversation context and asks for bulk confirmation; this is a prompt rule, not a server-side approval boundary. Schema validation, local existence/source checks, priority limits, exclusions and per-turn deduplication remain. No second LLM permission agent exists in the Orbit tool path.
- Consecutive metadata clarification turns retain the original user request and exclusions. Identical local changes can use batch_update_tickets with ids and one metadata patch (up to 50 IDs), deduplicating IDs and returning individual outcomes. Mixed operations remain supported, with at most 25 Azure status changes. Internal child handlers do not represent additional model tool calls.
- Pre-push validation: all 182 tests and the production build passed. Tests cover historical selection confirmation without rereads, preserved exclusions, shared-patch validation/deduplication, partial failures and existing Azure verification behavior. Live Copilot/Azure behavior was not exercised. Vite retains its large-chunk warning.

### Search answer preservation and full tool results (2026-10-20)

- Azure lookup proposals now append to the model answer instead of replacing broader local search results. Their local count is explicitly scoped to the proposed criteria; consent parsing reads the final canonical plan. Prompt guidance consolidates relevant search results by ID without summing overlapping totals.
- Tool traces store the actual returned JSON separately from summaries. A context-scoped endpoint loads it only when the chat debug button is clicked; the overview does not return full payloads. Existing traces without the new field remain readable with an unavailable message. Upstream pagination/truncation remains visible; no historical reconstruction or extra Azure reads are performed.
- Pre-push validation: all 184 tests and production build passed, including one-result/broader-23-result answer preservation, lookup consent, exact full-result retrieval and cross-context denial. Vite retains its large-chunk warning. Live Copilot/Azure and browser interaction were not exercised.

### Status confirmation and preflight state lookup (2026-10-20)

- Conversational confirmation accepts natural variants such as «Выполнить изменение?» and carries explicit #IDs from the confirmed plan while retaining the user's original command. Unrelated questions do not continue a mutation.
- get_ticket_states reads current/available Azure states for up to 25 local IDs, caches reads within the turn, resolves RFT against actual state names, and returns an actionable error for an ambiguous/missing target. The read requests only project, work item type and state. Prompt guidance uses the verified full name before confirmation; write-time validation and post-write verification remain unchanged.
- Pre-push validation: all 186 tests and production build passed, including a 22-ticket RFT preflight/confirmation/batch regression. Vite retains its large-chunk warning. Live Azure/Copilot behavior was not exercised.
