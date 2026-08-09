# kaiten

MCP-сервер для [kaiten.ru](https://kaiten.ru): карточки, комментарии, чеклисты —
и `list_my_cards`, который XCIII читает как источник.

```
bun install
KAITEN_TOKEN=… bun run server.ts     # говорит по MCP в stdio
```

`KAITEN_SITE` задаёт домен (по умолчанию `https://vinokurov.kaiten.ru`),
`KAITEN_TOKEN` — токен из профиля Kaiten.

## Как из него сделать источник XCIII

Скопируйте `xciii-manifest.json` в
`~/Library/Application Support/XCIII/sources/manifests/kaiten.json`, поправив
`dir` (абсолютный путь к этому каталогу) и `KAITEN_SITE`. После перезапуска
приложения «Kaiten» появится в списке плагинов при заведении источника:
выбираете доску XCIII, вставляете токен — карточки, назначенные на вас,
приезжают во «Входящие».

Манифест — это весь адаптер: какой инструмент читать, с какими аргументами и
как разложить строку ответа в элемент (`internal/sources/mcpsource.go`).
Поэтому второй MCP-сервер добавляется таким же файлом, без кода.

`list_my_cards` спрашивает Kaiten дважды — где вы ответственный и где вы
участник — и склеивает по id: в Kaiten это разные поля, а «назначено на меня»
для человека одно.
