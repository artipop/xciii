# Что вынесено из форка

Журнал усушки: одна строка на удалённую подсистему, с коммитом, которым её
возвращают. Ведётся, потому что «мертво» — суждение о сегодняшнем дне, а
не о завтрашнем: решение о команд­ной работе уже один раз перевернуло план
(`docs/fork-shrink-plan.md`, слой 0), и незачем гадать, какое перевернёт
следующим.

**Как вернуть.** Каждое удаление — отдельный коммит, ничего не размазано.
`git revert <хеш>` поднимает подсистему целиком: код, интерфейс стора, моки,
тесты и правку страницы, если она была парной. Если с тех пор менялся
`Store`, после отката нужен `go generate ./server/services/store` — моки и
`public_methods.go` собираются из интерфейса.

**Чего здесь нет.** Тут только то, что удалено. То, что решили **не** трогать
— логин, публичный шаринг, многокомандность, планировщик, `search` и
`getTeamUsers`, — записано в плане, там же и почему.

## Слой 1 — сервер. Страница ничего не замечала

| Подсистема | Коммит | Почему было мертво |
| --- | --- | --- |
| telemetry (сервис, TelemetryID в `system_settings`, `Telemetry`/`TelemetryID` в конфиге и клиент-конфиге, `LvlFBTelemetry`, `rudderlabs/analytics-go`) | `e87126a` | ключи Rudder — литералы `placeholder_*`, `getRudderConfig` возвращает пустой конфиг, если нет `RUDDER_KEY`/`RUDDER_DATAPLANE_URL`, а их никто не ставит |
| webhook (клиент, 8 вызовов в `app/`, `WebhookUpdate`) | `dfd1b5f` | `NotifyUpdate` выходит на первой строке при пустом списке, а список пуст по построению: конфиг собирается литералом, файл конфига не читается |
| metrics (сервис, счётчики в 15 местах, `updateMetrics`, `prometheus/client_golang`, `oklog/run`) | `a29edf7` | реестр публикует `metricsServer`, который поднимается только при непустом `PrometheusAddress`, а он пуст всегда |
| audit (сервис, 315 вызовов в 19 файлах `api/`, третий параметр `StampModificationMetadata`) | `c25dda1` | `NewAudit` пишет в `mlog.Discard()`, `Configure` получает два пустых поля конфига |
| compliance (стор, SQL, типы, обёртки `app/`, storetests, три метода `client.go`) | `524c23b` | ни одного маршрута; методы клиента шли в `/admin/*`, то есть в выключенный сокет |
| cloud card limits (`sqlstore/cloud.go`, три метода интерфейса, `CardLimitTimestampSystemKey`, `UPDATE_CARD_LIMIT_TIMESTAMP` в ws) | `39de4f0` | `Block.ShouldBeLimited`/`GetLimited` никто не зовёт, `limited` всегда false; вебсокет-действие не рассылается ниоткуда |
| `GET /statistics` + `app/statistics.go` + `model.BoardsStatistics` + `PermissionGetAnalytics` | `39de4f0` | живой маршрут без единого вызывающего на странице |
| data retention (`RunDataRetention`, SQL, `EnableDataRetention`, `DataRetentionDays`) | `21f8692` | единственный вызывающий — собственный стор-тест; поля конфига не читает никто |
| notification hints (четыре метода, SQL, `model.NotificationHint`) | `21f8692` | бэкенд, который их читал, удалён раньше |
| local mode (`EnableLocalMode`, unix-сокет, `localRouter`, `api/admin.go`, `adminRequired`, `admin-scripts/`, conn в `api/context.go`) | `6f901d7` | флаг выставлен в `false` в единственном месте, где собирается конфиг; на роутере висел один маршрут — сброс пароля через `/var/tmp/focalboard_local.socket` |
| `server/swagger/` (2,1 МБ) | `6f901d7` | генерируется целью `make swagger` в дереве без Makefile; описывает эндпоинты, которых нет (последнее место, где упоминался insights) |
| `server/app/templates.boardarchive` (6,1 МБ) | `6f901d7` | embed'ится `server/assets/templates.boardarchive`, это другой файл, и они различаются |
| `ws/plugin_adapter_client.go`, `integrationtests/pluginteststore.go` | `6f901d7` | последние два файла половины-плагина, на них не ссылается ничто |
| notifylogger | `f6681ca` | пишет на debug в логгер, который собран на info и не перенастраивается |

## Слой 2 — мёртвые вызовы страницы и парные маршруты

| Что | Коммит | Почему было мертво |
| --- | --- | --- |
| `octoClient`: `getUsersList`, `getBlocksWithParent`, `getBlocksWithType`, `patchBlocks`, `getBlocksForBoard`, `createBoard`, `getUserBlockSubscriptions` | `1565b30` | ни одного вызова из живого кода; четыре из них вдобавок бьют в маршруты, которых на сервере уже нет (`/teams/{t}/blocks`, `/teams/{t}/boards/{b}`, `POST /teams/{t}/boards`) |
| `octoClient.searchLinkableBoards` + `GET /teams/{teamID}/boards/search/linkable` + `TestPermissionsSearchTeamLinkableBoards` | `1565b30` | доски, привязываемые к каналу Mattermost; обработчик и так отвечал «not permitted in standalone mode» |
| канальная половина «Поделиться»: `searchUserChannels`, `getChannel`, `store/channels.ts`, `onLinkBoard` и диалог привязки в `shareBoard.tsx`, унии `IUser \| Channel` | `d49322a` | список опций строит `loadShareOptions` из `searchTeamUsers` — положить в него `Channel` было нечему; людская половина диалога цела |
| insights: `getMyTopBoards`, `getTeamTopBoards`, `src/insights/` | `d49322a` | вызывающих нет, маршрутов на сервере тоже давно нет |
| скрытые карточки целиком: апселл «Upgrade to Professional or Enterprise» в карточке, `HiddenCardCount` в канбане/таблице/галерее, `cardLimitNotification.tsx` со снузом на 10 дней, `limitCard`/`setLimitTimestamp`/`refreshCards`/`cardHiddenWarning` в сторе карточек, `addOnCardLimitTimestampChange` в `wsclient`, `Block.limited`, `svg/card-skeleton`, 10 ключей в 26 каталогах | `9a19cdd` | `limited` не выставляет никто: `ShouldBeLimited`/`GetLimited` на сервере без вызывающих, вебсокет-действие не рассылается, стор лимитов кормился маршрутом, которого нет |
| `components/globalHeader/` | `9a19cdd` | не импортируется ничем; удалён вместе со скрытыми карточками, потому что был последней ссылкой на снятый `prepareOnboarding` |
| onboarding: `prepareOnboarding`, `POST /teams/{teamID}/onboard`, `app.PrepareOnboardingTour`, `pages/welcome/`, `src/onboardingTour/index.ts`, `TestPermissionsOnboard` | `d49322a` | оба вызывающих недостижимы — у `welcomePage` нет маршрута, `globalHeader` не монтируется. **Сам тур жив**: `components/onboardingTour/` — другое, прогресс хранится через `patchUserConfig` |

## Слой 4 — хвосты Mattermost на странице

| Что | Коммит | Почему было мертво |
| --- | --- | --- |
| плагин-режим в `wsclient.ts`: `MMWebSocketClient`, `initPlugin`, поля `client`/`pluginId`/`pluginVersion`/`clientPrefix`, ветка `open()` на чужом сокете, форки в `sendCommand`/`hasConn`/`authenticate`, `pluginStatusesChangedHandler`; пропсы `manifest`/`webSocketClient` в `withWebSockets` | `3a67ea0` | точки входа в режим нет с тех пор, как `index.html` ведёт в `main.tsx`; решение 3 закрыло режим официально |
| `newVersionBanner` | `3a67ea0` | поднимался только `pluginStatusesChangedHandler`, которого никто не зовёт; у приложения свой апдейтер |
| `components/messages/versionMessage` | `3a67ea0` | показывался при `me().id !== 'single-user'`, что здесь никогда не так, а «Learn more» вело на mattermost.com |
| `setMattermostTheme` | `3a67ea0` | собственный комментарий говорил, что в репозитории её не зовёт никто и она для плагин-хоста |
| `Utils.isDesktopApp`, `getDesktopVersion`, `isDesktop` | `3a67ea0` | нюхают юзер-агент Mattermost-Electron и **врут** в сборке Wails; вызывающих нет |
| `SuiteWindow`, `frontendBaseURL`, `openPricingModal` в `types/index.d.ts` | `3a67ea0` | глобалы, которые ставил только плагин-хост |
| `src/telemetry/` целиком: `TelemetryClient`, 33 вызова `trackEvent`, `setUser`, проп `telemetryTag` в одиннадцати шагах тура, `telemetryName` в `Constants.imports` | `8d4df04` | `trackEvent` — no-op, пока не позван `setTelemetryHandler`, а звала его только точка входа плагина |
| маршрут `/team/:teamId/new/:channelId`, проп `channelId`, `getBoardPagePath` | `3a67ea0` | вход «создать доску для канала»; не просто мёртв — каждое создание доски из шаблона платило лишним `updateBoard` с пустым `channelId` |

## Слои 3 и 5 — не удаления, а починки

| Что | Коммит | Что было |
| --- | --- | --- |
| `TestPermissionsGetTeamTemplates` | `5f2a338` | падал на каждом прогоне против константы `builtInTemplateCount := 13` при 14 шаблонах в архиве. Теперь число спрашивается у стора: тест про права, а не про количество. С этим сьют Go стал зелёным целиком |
| `internal/appschema.OpenEnforcing` | `d0141b9` | звал `sqlstore.SQLiteDSN`, выбираемый тегом сборки, при драйвере `mattn`, который пакет импортирует безусловно: в сборке без тегов DSN был modernc'шный, ключи выключены, три cascade-теста падали. DSN пишется под свой драйвер, прагма читается обратно |
| `BoardGrant.Property` | `07e6440` | брался из `cfg.TriggerProperty` — одно имя на все доски, по умолчанию «Статус». Берётся с доски (`xciiiColumnProperty`), имя из настроек осталось запасным вариантом |

## Что осталось стоять рядом с удалённым

- `POST /users`, `GET /subscriptions/{subscriberID}`, `POST /boards` — маршруты
  живы: их зовёт `server/client/client.go` из интеграционных тестов, и один из
  этих тестов (`TestGetUserListSingleUserWithRealAccounts`) написан уже под этот
  форк, про аккаунты агентов. Со страницы ушли только клиентские методы.
- `SearchBoardsForUserInTeam` — после ухода linkable у него не осталось
  вызывающих в `api/`, но это поиск в пределах одной команды, и он остаётся по
  тому же правилу, что `search` и `getTeamUsers`.
- Таблицы `notification_hints` и `sharing` — правка схемы отдельная работа со
  своим генератором и снапшот-тестом, в удаление кода не мешается.
- `getFrontendBaseURL` и `getBoardPagePath` не удалены, а схлопнуты: первая
  отличалась от `getBaseURL` только чтением `window.frontendBaseURL`, вторая без
  канального маршрута была тождественной функцией. Вызывающие переписаны на то,
  что осталось.
- Ссылки «Trello / Notion / Todoist» не удалены, а **исправлены**: вели на
  `docs.mattermost.com` с якорями, которые придумало это меню, теперь ведут на
  свой `docs/guide/transfer`. Отправлять человека в документацию чужого продукта
  хуже, чем не отправлять никуда.
- **Подписка на карточку** (`followBlock`/`unfollowBlock` в `mutator` и
  `octoClient`, маршруты `/subscriptions`). Кнопки на экране нет — класс
  `cardFollowBtn` носит кнопка «Attach», — но следить за карточкой имеет смысл
  там, где есть кому рассказать, то есть это командная работа, и по этому же
  правилу остаются логин, шаринг и команды.
- Комментарии `swagger:operation` в обработчиках — они читаются как описание
  маршрута независимо от того, генерирует ли из них кто-нибудь.
