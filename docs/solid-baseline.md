# React-baseline перед миграцией на Solid

Точка отсчёта, которую требует шаг 1 плана
([solidjs-migration-plan.md](solidjs-migration-plan.md)): против этих цифр
проверяются performance-gates после cutover. Снято на ветке `solid-migration`
в момент её создания (webapp — копия ветки `experiments` серверного форка, Vite,
React 19.2.8).

## Тесты

`npx jest` в `webapp/`:

- 158 сюит, все зелёные;
- 984 теста: 976 прошли, 8 пропущены;
- 455 снапшотов;
- 13.8 s на M-серии (для сравнения порядка, не как gate).

Cypress-бинаря в devDependencies на этой точке нет (апгрейд на Cypress 14 жил
на ветке `dev` апстрима и в `experiments` не попал); спеки в `cypress/`
лежат, обвязка (`@testing-library/cypress`, `cypress-real-events`) в
package.json есть. E2E-baseline снимается после возвращения бинаря.

## Бандл

`npm run pack` (production), gzip -c | wc -c:

| артефакт | gz, байт |
|---|---|
| `index-*.js` (initial JS) | 738 946 |
| все `*.js` суммарно | 963 519 |
| `index-*.css` | 30 130 |
| `locales-*.js` | 75 249 |
| `markdownEditorInput-*.js` | 75 712 |
| `xterm-*.js` | 72 307 |

Gates из плана: initial gzip JS после миграции ≤ 591 157 (−20%); медианное
время до интерактивной доски −15%; LCP и p95 взаимодействий не хуже +5%.
Замеры времени требуют закреплённого Chromium и пяти прогонов — снимаются
на этапе cutover, здесь зафиксирован только размер.

## Контракт сборки, который обязан пережить миграцию

- `webapp/pack/index.html` + `pack/static/*`, `{{.BaseURL}}` в index.html;
- относительные ссылки на ассеты из JS и CSS;
- рабочие `npm run pack` / `watchdev` / `deveditor`;
- `go build -tags frontend` встраивает `webapp/pack`, headless-сборка отдаёт
  страницу, `/api` и `/ws`;
- три глобала из README («What this app requires of the frontend») с
  feature-detection на месте вызова.
