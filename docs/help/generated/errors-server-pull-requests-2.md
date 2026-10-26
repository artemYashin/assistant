<!-- orbit-help {"id":"errors-server-pull-requests-2","title":"Сообщения и ограничения: pull-requests.ts · 2","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","pull-requests.ts"]} -->
# Сообщения и ограничения: pull-requests.ts · 2

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

Проект Azure изменён в общих настройках: сохраните репозиторий заново. Старые ревью сохранены.

Источник: services/backend/src/pull-requests.ts:767.

### Сообщение

URL Azure изменён: настройте мониторинг для нового подключения

Источник: services/backend/src/pull-requests.ts:772.

### Сообщение

Укажите PAT Azure с разрешением Code: Read

Источник: services/backend/src/pull-requests.ts:774.

### Сообщение

Указан адрес корпоративного прокси MCAS. Для Azure REST API проверьте исходный адрес организации, например https://dev.azure.com/организация, и доступ к нему по правилам вашей компании.

Источник: services/backend/src/pull-requests.ts:806.

### Сообщение

Запрос: {…}.

Источник: services/backend/src/pull-requests.ts:808.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Откройте «Заказчики и проекты», выберите нужного заказчика и проект, затем в разделе «Репозиторий» проверьте имя или ID Git-репозитория. Если поле пустое — заполните его и сохраните настройки. Также проверьте URL организации/коллекции и проект в разделе «Подключение Azure». Если настройки верны, проверьте версию API и доступ PAT к репозиторию (Code: Read).

Источник: services/backend/src/pull-requests.ts:814.

### Сообщение

Azure не разрешил доступ к pull request (HTTP {…}). В настройках → «Azure DevOps» проверьте PAT: срок действия, разрешение Code: Read и доступ к нужному репозиторию.

Источник: services/backend/src/pull-requests.ts:816.

### Сообщение

Не удалось загрузить данные pull request из Azure (HTTP {…}). Повторите синхронизацию позже; если ошибка сохраняется, проверьте доступность сервера Azure.

Источник: services/backend/src/pull-requests.ts:817.

### Сообщение

Azure PR: пустой ответ

Источник: services/backend/src/pull-requests.ts:820.

### Сообщение

Ответ Azure больше 2 МБ; данные не загружены

Источник: services/backend/src/pull-requests.ts:831.

### Сообщение

Project ID missing

Источник: services/backend/src/pull-requests.ts:859.

### Сообщение

Too many policy evaluations

Источник: services/backend/src/pull-requests.ts:863.

### Сообщение

Invalid policy response

Источник: services/backend/src/pull-requests.ts:872.

### Сообщение

Не удалось загрузить проверки Azure. Проверьте доступ к политикам проекта и повторите синхронизацию.

Источник: services/backend/src/pull-requests.ts:879.

### Сообщение

Git-репозиторий не указан. Откройте «Заказчики и проекты», выберите нужного заказчика и проект, затем в разделе «Репозиторий» укажите имя или ID Git-репозитория и сохраните настройки.

Источник: services/backend/src/pull-requests.ts:888.

### Сообщение

Более 5000 PR: синхронизация не завершена

Источник: services/backend/src/pull-requests.ts:895.

### Сообщение

Azure вернул неверный список PR

Источник: services/backend/src/pull-requests.ts:902.

### Сообщение

Azure вернул неверную деталку PR

Источник: services/backend/src/pull-requests.ts:915.

### Сообщение

Azure не вернул связи PR

Источник: services/backend/src/pull-requests.ts:926.

### Сообщение

Azure вернул некорректные связи PR

Источник: services/backend/src/pull-requests.ts:929.
