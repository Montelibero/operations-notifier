# TODO

- Добавить фильтрацию в `GET /api/subscription` по query‑параметрам, чтобы не выгружать все подписки.
  Пример:
  `/api/subscription?account=G...`
  Варианты:
  `/api/subscription?reaction_url=https://example.com/webhook`
  `/api/subscription?operation_types=1,2`
  `/api/subscription?asset_code=MMM&asset_issuer=G...`

- Добавить простую HTML-страницу админки (без Swagger): ввод токена/админ-ключа и быстрые запросы к API (список, фильтры, удаление, сортировка).
  - Доступ только для админа или за флагом ADMIN_UI_ENABLED=true.

- Добавить админ-API для управления курсором ingestion: посмотреть текущий, сбросить на `now`, установить вручную.

- Добавить `/api/health`: время последней полученной транзакции и отставание от сети.
- Поддержать брокеры в `reaction_url`: `redis://channel` и `amqp://exchange/routing_key` как альтернативу HTTP (минимальный адаптер по схеме URL).
