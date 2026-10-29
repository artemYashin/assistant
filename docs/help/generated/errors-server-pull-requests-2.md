<!-- orbit-help {"id":"errors-server-pull-requests-2","title":"Сообщения и ограничения: pull-requests.ts · 2","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","pull-requests.ts"]} -->
# Сообщения и ограничения: pull-requests.ts · 2

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Укажите Git-репозиторий в меню «Заказчики и проекты» → «Репозиторий» и сохраните настройки.

Источник: services/backend/src/pull-requests.ts:663.

### Сообщение

PR или подключение изменились. Обновите список.

Источник: services/backend/src/pull-requests.ts:917.

### Сообщение

Тикет удалён из списка. Сначала восстановите его или добавьте по номеру.

Источник: services/backend/src/pull-requests.ts:940.

### Сообщение

Изображение не найдено в описании PR

Источник: services/backend/src/pull-requests.ts:1001.

### Сообщение

Это не вложение Azure текущего подключения

Источник: services/backend/src/pull-requests.ts:1006.

### Сообщение

Подключение Azure изменилось. Откройте PR заново.

Источник: services/backend/src/pull-requests.ts:1021.

### Сообщение

Укажите PAT Azure с разрешением Code: Read

Источник: services/backend/src/pull-requests.ts:1022.

### Сообщение

Проект Azure изменён в общих настройках: сохраните репозиторий заново. Старые ревью сохранены.

Источник: services/backend/src/pull-requests.ts:1026.

### Сообщение

URL Azure изменён: настройте мониторинг для нового подключения

Источник: services/backend/src/pull-requests.ts:1031.

### Сообщение

Указан адрес корпоративного прокси MCAS. Для Azure REST API проверьте исходный адрес организации, например https://dev.azure.com/организация, и доступ к нему по правилам вашей компании.

Источник: services/backend/src/pull-requests.ts:1065.

### Сообщение

Запрос: {…}.

Источник: services/backend/src/pull-requests.ts:1067.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Откройте «Заказчики и проекты», выберите нужного заказчика и проект, затем в разделе «Репозиторий» проверьте имя или ID Git-репозитория. Если поле пустое — заполните его и сохраните настройки. Также проверьте URL организации/коллекции и проект в разделе «Подключение Azure». Если настройки верны, проверьте версию API и доступ PAT к репозиторию (Code: Read).

Источник: services/backend/src/pull-requests.ts:1073.

### Сообщение

Azure не разрешил доступ к pull request (HTTP {…}). В настройках → «Azure DevOps» проверьте PAT: срок действия, разрешение Code: Read и доступ к нужному репозиторию.

Источник: services/backend/src/pull-requests.ts:1075.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Повторите синхронизацию позже; если ошибка сохраняется, проверьте доступность сервера Azure.

Источник: services/backend/src/pull-requests.ts:1076.

### Сообщение

Azure PR: пустой ответ

Источник: services/backend/src/pull-requests.ts:1079.

### Сообщение

Ответ Azure больше 2 МБ; данные не загружены

Источник: services/backend/src/pull-requests.ts:1090.

### Сообщение

Project ID missing

Источник: services/backend/src/pull-requests.ts:1118.

### Сообщение

Too many policy evaluations

Источник: services/backend/src/pull-requests.ts:1122.

### Сообщение

Invalid policy response

Источник: services/backend/src/pull-requests.ts:1131.

### Сообщение

Не удалось загрузить проверки Azure. Проверьте доступ к политикам проекта и повторите синхронизацию.

Источник: services/backend/src/pull-requests.ts:1138.
