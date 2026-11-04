<!-- orbit-help {"id":"errors-server-pull-requests-2","title":"Сообщения и ограничения: pull-requests.ts · 2","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","pull-requests.ts"]} -->
# Сообщения и ограничения: pull-requests.ts · 2

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Укажите Git-репозиторий в меню «Заказчики и проекты» → «Репозиторий» и сохраните настройки.

Источник: services/backend/src/pull-requests.ts:698.

### Сообщение

PR или подключение изменились. Обновите список.

Источник: services/backend/src/pull-requests.ts:967.

### Сообщение

Тикет удалён из списка. Сначала восстановите его или добавьте по номеру.

Источник: services/backend/src/pull-requests.ts:990.

### Сообщение

Изображение не найдено в описании PR

Источник: services/backend/src/pull-requests.ts:1051.

### Сообщение

Это не вложение Azure текущего подключения

Источник: services/backend/src/pull-requests.ts:1100.

### Сообщение

Подключение Azure изменилось. Откройте PR заново.

Источник: services/backend/src/pull-requests.ts:1115.

### Сообщение

Укажите PAT Azure с разрешением Code: Read

Источник: services/backend/src/pull-requests.ts:1116.

### Сообщение

Проект Azure изменён в настройках этого проекта: сохраните репозиторий заново. Старые ревью сохранены.

Источник: services/backend/src/pull-requests.ts:1121.

### Сообщение

URL Azure изменён: настройте мониторинг для нового подключения

Источник: services/backend/src/pull-requests.ts:1126.

### Сообщение

Указан адрес корпоративного прокси MCAS. Для Azure REST API проверьте исходный адрес организации, например https://dev.azure.com/организация, и доступ к нему по правилам вашей компании.

Источник: services/backend/src/pull-requests.ts:1160.

### Сообщение

Запрос: {…}.

Источник: services/backend/src/pull-requests.ts:1162.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Откройте «Заказчики и проекты», выберите нужного заказчика и проект, затем в разделе «Репозиторий» проверьте имя или ID Git-репозитория. Если поле пустое — заполните его и сохраните настройки. Также проверьте URL организации/коллекции и проект в разделе «Подключение Azure». Если настройки верны, проверьте версию API и доступ PAT к репозиторию (Code: Read).

Источник: services/backend/src/pull-requests.ts:1168.

### Сообщение

Azure не разрешил доступ к pull request (HTTP {…}). В настройках → «Azure DevOps» проверьте PAT: срок действия, разрешение Code: Read и доступ к нужному репозиторию.

Источник: services/backend/src/pull-requests.ts:1170.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Повторите синхронизацию позже; если ошибка сохраняется, проверьте доступность сервера Azure.

Источник: services/backend/src/pull-requests.ts:1171.

### Сообщение

Azure PR: пустой ответ

Источник: services/backend/src/pull-requests.ts:1174.

### Сообщение

Ответ Azure больше 2 МБ; данные не загружены

Источник: services/backend/src/pull-requests.ts:1185.

### Сообщение

Project ID missing

Источник: services/backend/src/pull-requests.ts:1213.

### Сообщение

Too many policy evaluations

Источник: services/backend/src/pull-requests.ts:1217.

### Сообщение

Invalid policy response

Источник: services/backend/src/pull-requests.ts:1226.

### Сообщение

Не удалось загрузить проверки Azure. Проверьте доступ к политикам проекта и повторите синхронизацию.

Источник: services/backend/src/pull-requests.ts:1233.
