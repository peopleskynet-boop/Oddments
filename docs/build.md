# Сборка Oddments из исходников

Стек: [Tauri 2](https://tauri.app) + Vite + чистый JavaScript (ES-модули, без фреймворка). Rust — тонкий слой:
плагины Tauri, локальный приёмник для интеграций (`src-tauri/src/bridge.rs`), запуск Blender и AutoRemesher, MCP.

## Что поставить

- **Node.js 22** — https://nodejs.org
- **Rust** (stable) — https://rustup.rs
- **Windows:** Microsoft C++ Build Tools («Разработка классических приложений на C++»), WebView2 (уже есть в
  Windows 11 и свежей Windows 10).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).

## Запуск

```bash
npm ci
npm run tauri dev
```

Первая сборка Rust идёт 5–15 минут, следующие — быстрее.

## Веб-версия для работы над интерфейсом

```bash
npm run web
```

Откроется http://127.0.0.1:5173. Модули `@tauri-apps/*` подменяются заглушками из `src/web/` (файловая система в
памяти, демо-библиотека из процедурных картинок, моделей и материалов). Код приложения про веб-режим не знает.

- `?n=5000` — большая библиотека для проверки прокрутки, `?empty` — пустая.
- Всё добавленное живёт до перезагрузки страницы.
- Чего нет в веб-версии: Blender, AutoRemesher, приёмник интеграций, MCP, перетаскивание файлов наружу.

## Установщик

```bash
npm run tauri build
```

Windows — `src-tauri/target/release/bundle/nsis/*.exe`, Mac — `src-tauri/target/<target>/release/bundle/dmg/*.dmg`.

AutoRemesher (ремеш моделей, только Windows) в git не хранится: перед сборкой его распаковывают в
`src-tauri/resources/autoremesher/` — так делает CI, см. шаг «AutoRemesher» в `.github/workflows/build-windows.yml`.
Без него приложение собирается и работает, просто «Ремеш» будет недоступен (в папке лежит только README).

### Сборка в GitHub Actions

- «Сборка установщика для Windows» и «Сборка для Mac» запускаются вручную (Actions → Run workflow) или пушем тега
  `v*`. По тегу создаётся черновик релиза с установщиками — его остаётся проверить и опубликовать.
- Сборка Mac — universal (Apple Silicon + Intel). Если машин `macos-latest` не хватает, при запуске можно выбрать
  `macos-15-intel`.
- Сборки не подписаны: Windows SmartScreen и macOS Gatekeeper переспросят при первом запуске.

## Тесты

```bash
npm run test:e2e
```

Playwright по веб-версии в установленном Microsoft Edge (тот же движок, что WebView2). Сеть в тестах заблокирована,
ответы API подменяются. В CI тесты запускаются вручную: Actions → «Тесты интерфейса».

## Устройство

```
src/main.js            запуск, события, Ctrl+V, перетаскивание, горячие клавиши
src/state.js           состояние, типы файлов
src/lib/               библиотека на диске, импорт и миниатюры, поиск, ИИ, 3D, материалы, иконки, лента
src/ui/                интерфейс: сетка, боковая панель, просмотр, плеер, конструктор иконок, лента, плагины…
src/web/               заглушки Tauri для веб-версии
src-tauri/             Rust: плагины, приёмник интеграций, Blender, AutoRemesher, MCP, трей
integrations/blender   аддон Blender (perch_blender.py)
integrations/figma     плагин Figma
integrations/browser   расширение для Chrome, Edge и Safari (MV3)
tests/                 E2E-тесты Playwright
```

Формат библиотеки: `index.json` (папки и файлы) + `files/<id>/<оригинал>` + миниатюры. Новые поля в `index.json`
добавляются только необязательными — старые библиотеки открываются без миграции. Оригиналы файлов приложение не
меняет и не удаляет, кроме явного «Удалить навсегда».

## Как помочь

Ошибки и предложения — в Issues. Перед pull request проверьте изменение в веб-версии и, если оно затрагивает
интерфейс, прогоните `npm run test:e2e`.
