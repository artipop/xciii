# Усушка форка

> Это план, а не описание. По мере выполнения слои вычёркиваются; то, что
> стало правдой, переезжает в CLAUDE.md и `docs/`, и когда вычеркнут последний
> слой, файл переписывается или удаляется. Составлен 2026-08-18 по
> инвентаризации ветки `store-one-database`; выполнять поверх неё — числа и
> имена файлов сняты с неё, а не с main.

## Зачем и почему можно

`server/` — 50,6 тыс. строк Go (14,8 тыс. из них тесты), и это половина
проекта. Стратегическая причина держать форк узнаваемым — вливать апстримные
фиксы — умерла дважды: Focalboard в архиве, а `store-one-database` сняла
последнюю зависимость от Mattermost. Правило CLAUDE.md «патчи маленькие,
чтобы объяснить» писалось для форка с живым апстримом; после этой работы его
надо переписать: форк — наш, и резать его — нормальный способ его нести.

Шов узкий, и это главное, что делает работу безопасной: из нашего кода форк
импортируют только `internal/boardadapter` и `internal/appschema` (в основном
`server/model` и `server/mlog`), плюс точка сборки в корне. «Слить» в смысле
переезда пакетов не нужно — граница уже там, где ей место; нужно, чтобы по
обе стороны от неё не лежало мёртвое.

**Правило на время работ:** каждый пункт — отдельный коммит с зелёными
тестами (`go test -tags "json1 sqlite3" ./...`, `npm test` в `webapp/`).
Маршрут API не удаляется без парной правки страницы в том же коммите.
Подсистема удаляется вместе со своими тестами, моками и типами в `model/` —
удаление, после которого `mockstore` пришлось «подправить руками», не
удаление, а надлом: моки перегенерируются.

## Два факта, на которых стоит весь план

**Однопользовательский режим включён всегда.** `main.go` безусловно ставит
`SingleUserToken` (`"su-"+uuid`), `api/auth.go attachSession` сравнивает
bearer с ним и синтезирует сессию `single-user` без похода в базу; вебсокет
делает то же. Значит всё, что про пароли, регистрацию и хранимые сессии,
мертво по построению, а не по случайности: login/register/changepassword/
regenerate_signup_token жёстко отказывают в этом режиме — при том, что
страницы `/login`, `/register`, `/change_password` до сих пор существуют и
маршрутизируются.

**Из ~75 маршрутов API страница зовёт около 60, и хвост известен поимённо.**
Инвентаризация всех 80 методов `octoClient.ts` дала 12 методов без единого
вызова из живого кода и три «почти мёртвых» (см. слой 2). Отдельно: сервер
уже потерял `insights`/`limits`/`channels` маршруты, а страница про это не
знает — `getBoardsCloudLimits` зовётся на каждом старте из
`store/initialLoad.ts:50` и, похоже, каждый раз получает 404 (проверить
первым же делом).

## Слой 0 — решения. Спросить один раз, записать ответы сюда

Четыре вопроса, каждый открывает свой кусок резки. Рекомендации проставлены;
решает Артём.

1. **Логин и регистрация.** Раз single-user всегда включён, страницы могут
   показать только ошибку. Рекомендация: удалить `/login`, `/register`,
   `/change_password` вместе с четырьмя эндпоинтами; путь «нет токена»
   (`ErrorId.NotLoggedIn`) ведёт на страницу ошибки с текстом «откройте доску
   через приложение» вместо редиректа на логин. Выпадают: `pages/loginPage`,
   `registerPage`, `changePasswordPage`, пункты logout/смены пароля в
   `sidebarUserMenu`, `registrationLink.tsx`, `regenerateTeamSignupToken`;
   на сервере — 4 обработчика в `api/auth.go` (остаётся `attachSession`/
   `sessionRequired`), `app/auth.go` Login/Register/ChangePassword,
   `services/auth/password.go` (106) и `email.go`.
2. **Публичный шаринг.** `EnablePublicSharedBoards` нигде не ставится,
   `IsValidReadToken` в этом режиме всегда отказывает — публичная ссылка не
   работает и не работала. Рекомендация: удалить ссылочную половину
   (`api/sharing.go`, `sharing` таблицу не трогать до следующей правки схемы,
   read-token ветки в `getBoard`/`getAllBlocks`/файлах, `/shared/*` маршруты
   страницы и линк-половину `shareBoard.tsx`), членство в доске оставить —
   диалог участников живой и им управляются аккаунты агентов.
3. **Режим Mattermost-плагина.** Точки входа плагина уже нет (`index.html` →
   `main.tsx`, plugin-манифеста нет), остались хвосты (слой 4). Рекомендация:
   закрыть режим официально — вычеркнуть обещание из CLAUDE.md («the same
   bundle also runs … as a Mattermost plugin») и резать хвосты не оглядываясь.
4. **Команды.** Единственная команда `"0"` создаётся в `app/teams.go
   GetRootTeam`, маршрута создания команды нет — но страница всё ещё умеет
   многокомандность (`/team/:teamId`, перебор `getAllTeams()` в
   `boardSwitcherDialog`). Рекомендация: заморозить на `"0"` в UI (убрать
   маршрут и перебор), а **колонки `team_id` не трогать** — 629 упоминаний в
   68 файлах ради нулевой выгоды; это отдельная правка схемы, если вообще.

## Слой 1 — мёртвое на сервере. API не трогает, страница не замечает

Порядок внутри слоя не важен; каждый пункт — коммит.

- **telemetry** (155): ключи Rudder — placeholder'ы, `sendDailyTelemetry`
  давно short-circuit; уходит сервис, запись telemetry-ID в
  `system_settings`, job и зависимость `rudderlabs/analytics-go`.
- **webhook** (46): `WebhookUpdate` всегда `[]`, `NotifyUpdate` возвращается
  на первой строке; ~8 вызовов в `app/` вычищаются.
- **metrics** (270): счётчики копятся в реестр, который никогда не
  публикуется (`PrometheusAddress == ""`); уходят `prometheus/client_golang`
  и `oklog/run` — заодно из CLAUDE.md уходит один из трёх пользователей cgo.
- **scheduler** (72): после telemetry, `cleanUpSessions` (в single-user нет
  строк сессий) и `updateMetrics` его некому звать.
- **audit** (153, но самый широкий след): конфиг пуст, логгер —
  `mlog.Discard()`, т.е. каждый `makeAuditRecord`/`auditRec.Success()` в 14
  файлах `api/` пишет в никуда. Резать в один заход по всем обработчикам.
- **мёртвые куски стора**, каждый с методами интерфейса, моками, storetests
  и типами в `model/`: `sqlstore/compliance.go` (241; маршрута нет),
  `cloud.go` (114) вместе с `api/statistics.go` + `app/statistics.go`
  (страница не зовёт), `data_retention.go` (176; конфиг-поля никто не
  читает), `notificationhints.go` (191; бэкенд, который их читал, удалён).
- **осиротевшее**: `ws/plugin_adapter_client.go`,
  `integrationtests/pluginteststore.go`, `server/admin-scripts/` +
  `api/admin.go` + весь `EnableLocalMode` (сокет никогда не включается),
  `server/swagger/` (2,1 МБ апстримного описания, единственное место, где
  ещё написано «insights»), незакоммиченный `server/app/templates.
  boardarchive` (6,1 МБ, ничем не embed'ится — просто удалить с диска).

`server/services/notify` (161) — **не трогать**: после удаления доставки это
голый fan-out, и наш `internal/boardadapter/events.go` — его `Backend`; это
шов, через который движок узнаёт о переездах карточек. Выкинуть можно только
`notifylogger`.

## Слой 2 — мёртвые маршруты, парная правка страницы

Методы `octoClient` без живых вызовов и их серверные маршруты (один коммит на
группу): `getUsersList` (bulk POST `/users`), `getBlocksWithParent` +
`getBlocksWithType` (GET `/teams/{t}/blocks`), `patchBlocks` (PATCH
`/teams/{t}/blocks`), `getTeamUsers` (GET без поиска), `getBlocksForBoard`
(GET `/teams/{t}/boards/{b}`), `createBoard` (всё создание идёт через
`boards-and-blocks`), `search` + `searchLinkableBoards` (командный поиск;
linkable и так отвечает 501), `getUserBlockSubscriptions` (GET
`/subscriptions/{u}`; стор-экшен — заглушка), `searchUserChannels` +
`getChannel` + `store/channels.ts` + канальная ветка `shareBoard.tsx`
(недостижима: в список некому положить `Channel`), `getSiteStatistics`,
`getMyTopBoards` + `getTeamTopBoards` (+ `webapp/src/insights/`,
`statistics/`).

Почти мёртвое, добить в том же слое: `prepareOnboarding` + `api/onboarding.go`
+ `app/onboarding.go` — оба вызывающих недостижимы (`welcomePage` без
маршрута, `globalHeader` не монтируется); сам тур живой и хранит прогресс
через `patchUserConfig`, он не тронут. Облачные лимиты: `getBoardsCloudLimits`
из `initialLoad`, `store/limits.ts`, `cardLimitNotification.tsx`,
`notifyAdminUpgrade`, каталог-сирота `boardCloudLimits/`.

Проверить руками до резки (единственные два места, где инвентаризация не
уверена): кнопка follow на карточке (`followBlock`/`unfollowBlock` живы в
`mutator`, но доступность кнопки с экрана не подтверждена) и судьба
`clientConfig`/`getMe(teamID)` после заморозки команд.

## Слой 3 — auth и permissions после решения №1

`services/auth` усыхает до `request_parser.go` (64 строки). Верхний
`server/auth/` (70) сворачивается: `GetSession` в single-user обходится,
`IsValidReadToken` умирает со слоем шаринга, остаётся
`DoesUserHaveTeamAccess`, который делегирует штампу.

`services/permissions` — **не выпиливать**: 79 вызовов, и
`HasPermissionToBoard` настоящий (читает `board_members`, это членство
агентов). Единственное, что сделать обязательно: починить
`TestPermissionsGetTeamTemplates` — он падает из-за константы
`builtInTemplateCount := 13` при 14 шаблонах в `server/assets/`, это
устаревшее число, а не бага прав. После этого весь сьют зелёный, и у
CLAUDE.md исчезает абзац про «один тест падает всегда».

## Слой 4 — хвосты Mattermost на странице

`wsclient.ts`: интерфейс `MMWebSocketClient`, поле `client`,
`onPluginReconnect`, `initPlugin()` (ноль вызовов) и вся ветка
`if (this.client !== null)` в `open()`. `withWebSockets.tsx`: пропсы
`manifest`/`webSocketClient`, которые никто не передаёт.
`theme.ts setMattermostTheme()`. `utils.ts`: `getFrontendBaseURL`,
`isDesktopApp()`/`getDesktopVersion()` — они нюхают юзер-агент
Mattermost-Electron и **врут в Wails-сборке**. `types/index.d.ts`:
`SuiteWindow` и `frontendBaseURL`. `components/globalHeader/` целиком (не
импортируется ничем). `pages/welcome/` (маршрута нет). Мёртвые ссылки на
mattermost.com в `constants.ts:51` и `versionMessage.tsx:19`. Зависимость
`@mattermost/compass-icons` пока живая (`main.tsx`) — снимать отдельно, если
дойдут руки до иконок.

## Слой 5 — попутные хвосты ревью store-one-database

Едут любым коммитом этого плана, потому что мелкие: `internal/appschema`
пишет прагму под драйвер, который сам импортирует (`_foreign_keys=on` жёстко)
— три `cascade_test` перестают падать в сборке без тегов;
`BoardGrant.Property` берётся с доски (`xciiiColumnProperty`), а не из
`cfg.TriggerProperty`. Мускульный `DEFAULT "NOW(6)"` — отдельно, вместе с
решением о диалектах (`docs/store-plan.md`, «Чем говорить с базой»).

## Чего не делаем, и почему это записано

- **Переезд import-путей** `server/…` → `internal/…`: правка каждой строки
  импорта ради косметики; граница и так в правильном месте. Делать последним
  или никогда.
- **Снятие `team_id`**: 629 упоминаний, выгода нулевая — колонка с константой
  никому не мешает.
- **Выпиливание permissions**: живое, см. слой 3.
- **ent**: условие пересмотра — после этой усушки, записано в
  `docs/store-plan.md`.
- **`server/web/`**, `server/assets/`, `server/client/client.go` — живые:
  web — маршрутизатор всего HTTP, assets — встроенные шаблоны,
  client — транспорт integrationtests.

## Проверка и мера

После каждого слоя: `go test -tags "json1 sqlite3" ./...` (после слоя 3 —
целиком зелёный), `npm test`, и один запуск приложения с проходом по
затронутым экранам (боковое меню, шаринг, поиск досок, карточка). Итоговая
мера — строки: `server/` 50,6 тыс. → ожидаемо минус 6–9 тыс. (слои 1–3, с
тестами и моками), `webapp/src` — минус 2–3 тыс. (слои 2 и 4). Числа «до»
снимать в первом коммите, «после» — в последнем, в этот файл.

CLAUDE.md правится в тех же коммитах, что и код: правило о форке, обещание
плагин-режима, список пользователей cgo, абзац про вечно красный тест.
