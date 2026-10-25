<!-- orbit-help {"id":"errors-server-store-1","title":"Сообщения и ограничения: store.ts · 1","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","store.ts"]} -->
# Сообщения и ограничения: store.ts · 1

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Invalid master.key

Источник: server/store.ts:86.

### Сообщение

CREATE TABLE pr_review_runs (id TEXT PRIMARY KEY, monitor TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, head TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, coverage TEXT, error TEXT, usage_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, options TEXT NOT NULL DEFAULT '{}'); INSERT INTO pr_review_runs SELECT id,monitor,repo,number,head,target,status,summary,coverage,error,usage_id,created_at,started_at,finished_at,options FROM pr_reviews ORDER BY rowid; DROP TABLE pr_reviews; ALTER TABLE pr_review_runs RENAME TO pr_reviews; CREATE INDEX pr_review_version ON pr_reviews(monitor,repo,number,head,target);

Источник: server/store.ts:157.

### Сообщение

fetch_timeout_seconds

Источник: server/store.ts:350.

### Сообщение

ticket_error

Источник: server/store.ts:354.

### Сообщение

Укажите заказчика

Источник: server/store.ts:525.

### Сообщение

Укажите название длиной до 200 символов

Источник: server/store.ts:536.

### Сообщение

Заказчик или проект не найден

Источник: server/store.ts:539.

### Сообщение

Такое название уже используется

Источник: server/store.ts:542.

### Сообщение

Для этого названия уже существуют настройки

Источник: server/store.ts:567.

### Сообщение

Запись памяти недоступна в текущем контексте

Источник: server/store.ts:603.

### Сообщение

Неверная запись памяти

Источник: server/store.ts:614.

### Сообщение

Выберите заказчика

Источник: server/store.ts:616.

### Сообщение

Выберите проект

Источник: server/store.ts:618.

### Сообщение

Подключение изменилось. Обновите корзину.

Источник: server/store.ts:793.

### Сообщение

Тикет отсутствует в корзине или срок хранения истёк

Источник: server/store.ts:800.

### Сообщение

Чат не найден в текущем контексте.

Источник: server/store.ts:885.
