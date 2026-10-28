<!-- orbit-help {"id":"errors-server-store-1","title":"Сообщения и ограничения: store.ts · 1","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","store.ts"]} -->
# Сообщения и ограничения: store.ts · 1

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Invalid master.key

Источник: services/backend/src/store.ts:84.

### Сообщение

CREATE TABLE pr_review_runs (id TEXT PRIMARY KEY, monitor TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, head TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, coverage TEXT, error TEXT, usage_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, options TEXT NOT NULL DEFAULT '{}'); INSERT INTO pr_review_runs SELECT id,monitor,repo,number,head,target,status,summary,coverage,error,usage_id,created_at,started_at,finished_at,options FROM pr_reviews ORDER BY rowid; DROP TABLE pr_reviews; ALTER TABLE pr_review_runs RENAME TO pr_reviews; CREATE INDEX pr_review_version ON pr_reviews(monitor,repo,number,head,target);

Источник: services/backend/src/store.ts:163.

### Сообщение

fetch_timeout_seconds

Источник: services/backend/src/store.ts:429.

### Сообщение

ticket_error

Источник: services/backend/src/store.ts:437.

### Сообщение

Укажите заказчика

Источник: services/backend/src/store.ts:690.

### Сообщение

Укажите название длиной до 200 символов

Источник: services/backend/src/store.ts:699.

### Сообщение

Заказчик или проект не найден

Источник: services/backend/src/store.ts:706.

### Сообщение

Такое название уже используется

Источник: services/backend/src/store.ts:713.

### Сообщение

Для этого названия уже существуют настройки

Источник: services/backend/src/store.ts:773.

### Сообщение

Запись памяти недоступна в текущем контексте

Источник: services/backend/src/store.ts:830.

### Сообщение

Неверная запись памяти

Источник: services/backend/src/store.ts:842.

### Сообщение

Выберите заказчика

Источник: services/backend/src/store.ts:843.

### Сообщение

Выберите проект

Источник: services/backend/src/store.ts:845.

### Сообщение

Подключение изменилось. Обновите корзину.

Источник: services/backend/src/store.ts:1070.

### Сообщение

Тикет отсутствует в корзине или срок хранения истёк

Источник: services/backend/src/store.ts:1076.

### Сообщение

Чат не найден в текущем контексте.

Источник: services/backend/src/store.ts:1137.
