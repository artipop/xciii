# Как это собирается и на чём проверено

Что нужно знать, чтобы получить из этого дерева работающий бинарь на каждой из
трёх платформ, и какие грабли уже собраны. Собственно архитектура — в
[CLAUDE.md](../CLAUDE.md); здесь только сборка.

## Одна команда на каждый случай

| Что нужно | Команда |
|---|---|
| Разработка | `wails3 dev` |
| Бинарь для этой платформы | `wails3 task build` |
| `.app` / инсталлятор | `wails3 task package`, `darwin:package:dmg`, `windows:package`, `linux:package` |
| Headless-сервер | `wails3 task build:server` |
| Кросс-образ для бинарей | `wails3 task setup:docker` |
| Платное издание | к любой из них — `EDITION=lifetime` |

`Taskfile.yml` в корне и по `Taskfile.yml` на платформу в `build/`. Makefile
здесь нет — цели `*-wails3` жили в v2-приложении и не переезжали.

## Теги сборки

`EXTRA_TAGS` по умолчанию `json1,sqlite3,frontend`:

- `json1`, `sqlite3` — cgo-SQLite;
- `frontend` — `go:embed` каталога `webapp/pack`;
- `gtk3` добавляется на Linux сам (`GTK_TAG` в `build/linux/Taskfile.yml`);
- `server` — headless-сборка, у неё свои файлы (`window_server.go` вместо
  `window_desktop.go`);
- `production` — релизная сборка; без него каталог данных `XCIII-dev`, поэтому
  дев-сборка никогда не трогает настоящую установку;
- `lifetime` — платное издание: лишние шаблоны досок и свой фид обновлений.
  Добавляется через `EDITION=lifetime`, а не руками: `EDITION=base` (по
  умолчанию) не добавляет тега вовсе. См. [editions.md](editions.md).

## `CGO_ENABLED=0` — ловушка ровно одна, и она тихая

Десктопная сборка без cgo падает честно: у `wails/v3/pkg/mac` исключены все
файлы. **Серверная — компилируется чисто и умирает на первом запросе**:
`mattn/go-sqlite3` подменяет себя на `static_mock.go`, который регистрирует имя
драйвера `sqlite3` и на каждый `Open` отвечает «Binary was compiled with
'CGO_ENABLED=0' […] This is a stub». До первого обращения к базе с бинарём всё
в порядке.

Cgo в дереве нужен только SQLite и Wails. Остальные два места —
`prometheus/client_golang` (сборщик памяти под Darwin) и `tailscale/certstore` —
откатываются на чистый Go.

## Платформы

Собрано и проверено с macOS/arm64, кросс — через `wails3 task setup:docker`.

**macOS.** `build` / `package` / `darwin:package:dmg`: `.app` и `.dmg`
собираются, приложение запускается, вебвью грузит страницу с front door по
настоящему HTTP.

**Linux.** `wails3 task linux:build` даёт ELF, слинкованный с `libgtk-3`,
`libwebkit2gtk-4.1` и `libsqlite3`. Тег `gtk3` обязателен: по умолчанию Wails v3
берёт GTK 4, а его GTK-4 код требует 4.10 (`GtkFileDialog`), тогда как Debian
bookworm — и кросс-образ вместе с ним — на 4.8. Снять тег можно через
`GTK_TAG=`.

**Windows.** `wails3 task windows:build` даёт PE32+ x86-64 с cgo-SQLite. Две
правки, без которых не собирается:

- принудительный `CGO_ENABLED=1` — у Wails по умолчанию 0, с чем SQLite не
  собирается;
- обход build-скрипта кросс-образа, который экспортирует `CGO_CFLAGS="-w"`:
  из-за этого zig оставляет включённым UBSan и линковка падает на
  `undefined symbol: __ubsan_handle_*`.

`internal/procgroup` под Windows не компилировался вовсе — `Setpgid` и
`syscall.Kill` там не существуют. Разведён по файлам: `procgroup_unix.go` как
было и `procgroup_windows.go` (`taskkill /T`, затем `/T /F` после grace,
ожидание через `WaitForSingleObject`).

## Инсталляторы — только на своей платформе

Бинарники кросс-собираются, пакеты — нет: AppImage зовёт `ldd`, NSIS — это
`makensis`, ни того ни другого на маке нет. Кросс-собранный `.exe` вдобавок
выходит с console-подсистемой (zig-овый `lld-link` игнорирует `-H windowsgui`),
то есть мигнёт консолью при запуске; нативная сборка MinGW этого не делает — она
и есть релизный путь.

## `webapp/pack` не должен исчезать ни на секунду

`go mod tidy` резолвит шаблон `go:embed all:` под всеми тегами и идёт
параллельно со сборкой фронтенда. Каталог держит открытым закоммиченный
`.gitkeep`; и задача сборки, и Vite чистят *вокруг* него, а не удаляют его.

Контракт сборки, который обязан выполняться, чем бы фронтенд ни собирался:

- на выходе `webapp/pack/index.html` и `pack/static/*`;
- в `index.html` есть Go-шаблон `{{.BaseURL}}`;
- ссылки на ассеты из JS и CSS — относительные;
- работают `npm run pack`, `watchdev`, `deveditor`;
- `go build -tags frontend` встраивает `webapp/pack`, headless-сборка отдаёт
  страницу, `/api` и `/ws`;
- три глобала из README («What this app requires of the frontend») — каждый с
  feature-detection на месте вызова, потому что тот же бандл ездит в браузер.

## Запакованное приложение — не потомок оболочки

launchd выдаёт `.app` ровно `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, поэтому npx,
node, CLI агентов и плагин-исходник для него не существуют, — а дев-сборка,
запущенная из терминала, находит всё. `internal/userpath` спрашивает PATH у
оболочки входа при старте: node у менеджера версий лежит под номером версии,
который знают только rc-файлы пользователя. Чинится именно PATH процесса, а не
наши поиски: npx — это скрипт с `#!/usr/bin/env node`, и codex-адаптер запускает
codex CLI, так что «найти бинарь и запустить его с PATH от launchd» просто
сдвигает падение на один процесс дальше.

## Как это проверялось

Способ проверки — и его собственные ловушки — в [verifying.md](verifying.md).

Курлом по front door на обеих сборках: страница отдаётся,
`/wails/runtime.js` отдаётся, `Call.ByName('main.App.…')` возвращает данные
настоящих реестров, `/ws` отвечает `101 Switching Protocols` с того же origin,
кросс-origin вызов биндинга получает `403`. В десктопной сборке WebKit-процесс
держит живое соединение с front door — страница загружена по HTTP, а не по
`wails://`.

Терминал: pty отдаёт вывод в окно и принимает ввод, `stty size` внутри
показывает размер, выставленный xterm-ом (то есть страница действительно
подключена), выход CLI закрывает сокет кодом 1000 и оставляет на карточке отчёт
с коммитом, попытка открыть тот же сокет с чужого origin — `403`.
