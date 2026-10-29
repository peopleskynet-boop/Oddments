**English:** [signing.en.md](signing.en.md)

# Подпись установщиков и обновлений

Для тех, кто выпускает сборки Oddments. Три разные подписи, каждая включается в CI сама, когда в публичном
репозитории заведены её секреты (GitHub › репозиторий › Settings › Secrets and variables › Actions). Без секрета
сборка та же, только без этой подписи.

| Подпись | Зачем | Секреты | Сейчас |
|---|---|---|---|
| Ключ обновлений | установленный Oddments принимает только обновления, подписанные этим ключом | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | ключ создан, секреты нужно завести |
| Windows (Authenticode) | SmartScreen не пугает, ИБ компаний пропускает установщик | `AZURE_*` (ниже) | нет сертификата |
| macOS (Developer ID + нотаризация) | приложение открывается двойным щелчком, без «Открыть» через меню | `APPLE_*` (ниже) | нет аккаунта Apple Developer |

## Ключ обновлений

Это не сертификат, а пара ключей minisign, бесплатно. Публичная часть лежит в `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`), закрытая — только у того, кто выпускает версии.

- Создать (если ключа ещё нет): `npx tauri signer generate -w ~/.tauri/oddments-updater.key` — спросит пароль.
  Публичную часть из `oddments-updater.key.pub` вставить в `pubkey`.
- Секреты: `TAURI_SIGNING_PRIVATE_KEY` — всё содержимое файла `oddments-updater.key`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — его пароль.
- **Сохраните ключ и пароль в надёжном месте** (менеджер паролей). Если ключ потерян, уже установленные копии не
  смогут обновиться сами — придётся выпустить версию с новым ключом и попросить всех переустановить её вручную.

После публикации выпуска workflow «Файлы выпуска — latest.json и расширение Blender» сам собирает `latest.json` из `.sig` файлов и
прикладывает его к выпуску. Установленные копии читают его по адресу
`https://github.com/peopleskynet-boop/Oddments/releases/latest/download/latest.json`.

## Windows

Без подписи Windows показывает «Система Windows защитила ваш компьютер» — нужно «Подробнее › Выполнить в любом
случае». Подпись снимает предупреждение не сразу: репутация в SmartScreen набирается по мере скачиваний.

Варианты (что выбрать — решает тот, кто выпускает; аккаунты и проверку личности проходит он сам):

1. **Azure Artifact Signing** (бывший Trusted Signing) — дешевле всего (около $10 в месяц), подпись прямо в CI, уже
   подключена в `build-windows.yml`. Проверка личности Microsoft; на конец 2025 года — для организаций из США,
   Канады, ЕС и Великобритании и для частных лиц из США и Канады.
   1. Подписка Azure → ресурс «Artifact Signing account» → пройти Identity validation.
   2. Certificate profile типа Public Trust.
   3. App registration (Microsoft Entra ID) с секретом; выдать ей роль «Certificate Profile Signer» (Artifact Signing, раньше — Trusted Signing)
      на аккаунт подписи.
   4. Секреты: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT` (например
      `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
2. **SignPath Foundation** — бесплатная подпись для открытых проектов (лицензия OSI, публичный репозиторий, сборка в
   CI). Заявка на signpath.org; в подписи будет «SignPath Foundation». Подпись идёт отдельным шагом после сборки
   (их GitHub Action), поэтому `.sig` для обновлений нужно пересчитать по уже подписанному установщику:
   `npx tauri signer sign -f <ключ> -p <пароль> Oddments_…_x64-setup.exe`.
3. **Сертификат OV от удостоверяющего центра** (Certum Open Source, SSL.com, Sectigo…). С 2023 года ключ хранится
   только на токене или в облачном HSM, поэтому подпись в CI — через облачную утилиту центра (`signCommand` в
   `tauri.conf.json` вместо `trusted-signing-cli`).

Многие удостоверяющие центры и Azure сейчас не работают с частными лицами и компаниями из РФ — проверьте условия до
оплаты.

## macOS

Без подписи macOS не даёт открыть приложение двойным щелчком: в первый раз — правый щелчок › «Открыть» (на macOS 15:
Системные настройки › Конфиденциальность и безопасность › «Всё равно открыть»).

1. **Apple Developer Program** — $99 в год, developer.apple.com/programs (оплата картой, которую принимает Apple).
2. Сертификат **Developer ID Application**: Связка ключей › Ассистент сертификации › запрос сертификата → загрузить
   на developer.apple.com › Certificates → скачать, открыть → экспортировать из Связки ключей в `.p12` с паролем.
3. Пароль приложения для нотаризации: appleid.apple.com › Вход и безопасность › Пароли приложений.
4. Секреты:
   - `APPLE_CERTIFICATE` — `.p12` в base64 (`base64 -i cert.p12 | pbcopy`);
   - `APPLE_CERTIFICATE_PASSWORD` — пароль `.p12`;
   - `APPLE_SIGNING_IDENTITY` — «Developer ID Application: Имя (TEAMID)»;
   - `APPLE_ID` — почта аккаунта Apple, `APPLE_PASSWORD` — пароль приложения, `APPLE_TEAM_ID` — Team ID.

`build-macos.yml` передаёт их Tauri: он подписывает приложение, отправляет его на нотаризацию в Apple и прикрепляет
результат к `.dmg`. Расширение для Safari пока подписывается ad-hoc (Safari › Разработка › «Разрешить неподписанные
расширения»); с тем же сертификатом его можно подписать и нотаризовать — это отдельный шаг в workflow.

## Порядок выпуска

Полный список шагов — в [release.md](release.md).
