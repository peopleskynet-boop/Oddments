**English:** [release.en.md](release.en.md)

# Как выпустить версию

Выпуски собираются в публичном репозитории `peopleskynet-boop/Oddments` по тегу `v*`.

## Один раз

1. Секреты ключа обновлений `TAURI_SIGNING_PRIVATE_KEY` и `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` в репозитории
   ([signing.md](signing.md)). Без них выпуск соберётся, но установленные копии не увидят его как обновление.
2. По желанию — секреты подписи Windows (`AZURE_*`) и Mac (`APPLE_*`), там же.

## Каждый выпуск

1. Поднять версию — одинаково в трёх местах: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
2. Дописать [CHANGELOG.md](../CHANGELOG.md) и [CHANGELOG.en.md](../CHANGELOG.en.md): дата и что изменилось.
3. Если менялись пакеты npm — `node tools/notices.mjs`; проверки — `npm run test:unit`.
4. Коммит, затем тег: `git tag v1.0.0 && git push origin main v1.0.0`.
5. Workflow «Сборка установщика для Windows» и «Сборка для Mac» соберут установщики и положат их в **черновик** выпуска
   вместе с `.sig`. Дождаться обоих (Actions).
6. Проверить черновик: `Oddments_…_x64-setup.exe` и `.exe.sig`, `Oddments_…_universal.dmg`, `Oddments.app.tar.gz` и
   `.app.tar.gz.sig`, `oddments-safari.zip`. Вставить текст выпуска (из CHANGELOG) — он же станет заметками обновления.
7. Опубликовать. Workflow «Файлы выпуска — latest.json и расширение Blender» сам приложит `latest.json`, пакет аддона
   `oddments-<версия аддона>.zip` и `index.json` репозитория расширений Blender. Проверить, что
   `https://github.com/peopleskynet-boop/Oddments/releases/latest/download/latest.json` открывается и в нём новая
   версия, а `…/latest/download/index.json` — с текущей версией аддона.
8. Проверить обновление на компьютере с предыдущей версией: Настройки › О программе › «Проверить сейчас» → «Установить».
9. В Blender с подключённым репозиторием (install.md › «Аддон Blender») — «Проверить обновления» в Get Extensions.

Версию аддона задаёт `bl_info` в `integrations/blender/perch_blender.py`; `python tools/blender_extension.py` выравнивает
с ней `blender_manifest.toml` и проверяет пакет настоящим Blender. Для CI тот же пакет без Blender собирает
`node tools/blender-repo.mjs <папка>`.

Первая версия с автообновлением — 1.0.0: копии 0.1.0 обновлений не умеют, их переустанавливают вручную один раз.
