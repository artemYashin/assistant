<!-- orbit-help {"id":"errors-voice-app-1","title":"Сообщения и ограничения: app.py · 1","summary":"Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».","keywords":["ошибка","app.py"]} -->
# Сообщения и ограничения: app.py · 1

Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика».

Автоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.

### Сообщение

raise RecognitionFailure("model_load", error) from error

Источник: voice/app.py:56.

### Сообщение

raise RecognitionFailure("transcribe", error) from error

Источник: voice/app.py:73.

### Сообщение

raise HTTPException(413, 'Audio must be between 1 byte and 20 MB')

Источник: voice/app.py:80.

### Сообщение

raise HTTPException(422, {'code': 'audio_too_long'})

Источник: voice/app.py:84.

### Сообщение

raise HTTPException(503, {'code': stage, 'reference': reference}) from None

Источник: voice/app.py:95.
