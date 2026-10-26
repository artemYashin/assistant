<!-- orbit-help {"id":"errors-server-usage-1","title":"Сообщения и ограничения: usage.ts · 1","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","usage.ts"]} -->
# Сообщения и ограничения: usage.ts · 1

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Вызов инструмента не найден

Источник: services/backend/src/usage.ts:378.

### Сообщение

Вызов инструмента не найден в текущем чате

Источник: services/backend/src/usage.ts:391.

### Сообщение

Полный результат не сохранён или вызов ещё выполняется

Источник: services/backend/src/usage.ts:393.

### Сообщение

SELECT count(*) requests,coalesce(sum(model_calls),0) model_calls,coalesce(sum(input_tokens),0) input_tokens,coalesce(sum(output_tokens),0) output_tokens,coalesce(sum(cache_read_tokens),0) cache_read_tokens,coalesce(sum(cache_write_tokens),0) cache_write_tokens,coalesce(sum(CASE WHEN model_calls IS NULL THEN 1 ELSE 0 END),0) unreported_requests,coalesce(sum(CASE WHEN incomplete_calls>0 OR status IN ('error','interrupted','stopped','limited') THEN 1 ELSE 0 END),0) possibly_partial_requests FROM requests

Источник: services/backend/src/usage.ts:435.
