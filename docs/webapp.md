# Страница: из чего она сделана

`webapp/` — свой npm-проект: Vite собирает его в `webapp/pack`, откуда бинарь
берёт страницу через `go:embed`. Изначально это React-приложение Focalboard;
переписано на SolidJS целиком, одним релизом, вместе с заменой Redux на
`solid-js/store` и Webpack на Vite. Ни серверные API, ни URL, ни SCSS, ни формат
`pack/` при этом не менялись — по этому контракту и проверялось, что переписали
то же самое.

Общие правила работы со Solid — в [CLAUDE.md](../CLAUDE.md), раздел «The page is
Solid». Здесь — что где лежит.

## Состояние

`src/store`: `createAppStore(deps, initialState)` строит одно дерево
`solid-js/store` с действиями по доменам — файл на домен, от `boards.ts` и
`cards.ts` до `language.ts` и `limits.ts`. `AppStoreProvider` раздаёт его вниз,
`useAppSelector(selector)` читает и мемоизирует по тем полям, которых селектор
коснулся.

- **Нет dispatch и нет thunk.** Действие — это метод, который пишет в store.
- **Клиент приходит через `deps`, а не импортом модуля** — поэтому тест
  подсовывает мок, ничего не мокая на уровне модулей.
- Коллекции обновляются через `reconcile` с ключом `id`, связанные изменения от
  WebSocket и мутатора объединяются через `batch`.
- Наружу — в API, в Lexical, в любую стороннюю библиотеку — уходят обычные
  объекты, а не прокси store.
- Форма `RootState` осталась той же, что была у Redux: так переносились
  семнадцать доменов, и так же читаются старые куски кода.

Ловушка, на которой ловятся все: `useAppSelector` возвращает **аксессор**, то
есть `foo()` — это значение, а голое `foo` — функция и потому всегда истина.
Props — геттеры, деструктуризация делает снимок.

## Чем заменены React-библиотеки

Не обёртками — заменами:

| Было | Стало |
|---|---|
| `react-router-dom` | `@solidjs/router` (все URL, optional-параметры, редиректы и `window.baseURL` сохранены) |
| `react-intl` | `@formatjs/intl` под своим `src/intl.tsx` — тот же `IntlShape`, те же message id, те же JSON-каталоги |
| `react-redux` | `src/store` (см. выше) |
| `@lexical/react` | headless Lexical + свои плагины в `markdownEditorInput/plugins/` |
| `react-beautiful-dnd` и прочий DnD | `@dnd-kit/solid` — везде: канбан, таблица, редактор блоков, сайдбар |
| React Flow | `@dschz/solid-flow` — холст маршрутов |
| FullCalendar React adapter | FullCalendar через его же DOM API |
| `react-day-picker` (+ `date-fns`) | `src/calendar.ts` + `widgets/calendar.tsx`, названия дней и месяцев даёт `Intl.DateTimeFormat` |
| `react-select` (+ `@emotion/serialize`) | `src/combobox.ts` + `widgets/combobox.tsx` на floating-ui |
| `tippy.js` | `@floating-ui/dom` (`offset`/`flip`/`shift`/`arrow` + `autoUpdate`) |

Часть виджетов пережила переписывание нетронутой, потому что логика уже лежала
отдельным модулем под тонкой обёрткой: `hotkeys.ts`, `calendar.ts`,
`combobox.ts`. Новые стоит делать такой же формы.

Две находки той поры, которые стоит помнить: кастомные стили календаря были
мертвы (стилизовали классы `react-day-picker` 7, а библиотека давно была на 10),
а `combobox.tsx` намеренно продолжает выдавать имена классов из
`classNamePrefix` react-select — поэтому 28 правил в шести таблицах стилей
переписывать не пришлось.

## Что охраняет границу

`no-restricted-imports` в `webapp/eslint.config.ts` роняет линт на импорт
`react*`, `redux*`, `@lexical/react`, `@dnd-kit/react` и `history`. Это дешевле,
чем искать в рантайме React-компонент, отрендеренный из Solid, — именно так этот
запрет и заработал.

Тем же правилом ловится импорт пакета, которого нет в `dependencies`: и
`@popperjs/core` (под tippy), и `@emotion/serialize` (под react-select) годами
ездили транзитивно, и первый сломал сборку ровно в тот момент, когда удалили
того, кто его привозил.

## Тесты

Vitest под jsdom, конфиг `vitest.config.ts` делит `vite-plugin-solid` со
сборкой. `npm test` в `webapp/`; покрытие (v8) включено по умолчанию,
`--coverage.enabled=false` пока итерируешь, `npm run updatesnapshot`
переписывает снапшоты. `npm run check` — это eslint и stylelint; `tsc` в гейт
не входит.

Библиотека — Solid'овская, и это не React:

- `render` принимает thunk: `render(() => wrapIntl(() => <X/>))`. JSX, собранный
  снаружи, собран раньше реактивного корня и его провайдеров, и компонент из
  него не видит ни того ни другого.
- Нет `act` (обновления синхронные) и нет `rerender` (рендерить заново или
  двигать сигнал).
- Store — из `mockAppStore(state)` под `AppStoreProvider`, роутер —
  `TestRouter`, оба в `testUtils`.
- Обработчик на каждое нажатие слышит `fireEvent.input`, а не `change`.

Моки — vitest'овские и ESM: `vi.*` глобальны, фабрика `vi.mock` для модуля с
default-экспортом обязана вернуть `{default: …}` (CJS-интероп babel'а раньше
отдавал весь объект и больше не отдаёт), а `vi.resetAllMocks` возвращает на
место то, что обернул `vi.spyOn`, — поэтому шпион, которому нельзя проваливаться
в оригинал, говорит об этом через `mockResolvedValue`, а хук вокруг него чистит,
а не ресетит.

Наследство React-времён: 158 сюит и 984 теста на момент старта миграции — против
186 файлов и 1178 тестов сейчас. Jest в плане собирались сохранить; на деле
переехали на vitest.

## Ленивое и тяжёлое

`lazy()` стоит на пяти вещах: страница терминала (`@xterm/xterm`) — и как
маршрут, и как панель внутри карточки, — мобильные экраны `/m`, страница
«Поделиться» и ввод markdown-редактора (Lexical). Браузерная сборка не должна
тащить xterm.js только потому, что он есть в дереве.
