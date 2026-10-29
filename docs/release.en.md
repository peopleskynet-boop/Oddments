**Русский:** [release.md](release.md)

# Releasing a version

Releases are built in the public repository `peopleskynet-boop/Oddments` on a `v*` tag.

## Once

1. The updater key secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the repository
   ([signing.en.md](signing.en.md)). Without them a release still builds, but installed copies will not see it as an
   update.
2. Optionally — the Windows (`AZURE_*`) and Mac (`APPLE_*`) signing secrets, in the same place.

## Every release

1. Raise the version — the same in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
2. Add to [CHANGELOG.en.md](../CHANGELOG.en.md) and [CHANGELOG.md](../CHANGELOG.md): the date and what changed.
3. If npm packages changed — `node tools/notices.mjs`; the checks — `npm run test:unit`.
4. Commit, then tag: `git tag v1.0.0 && git push origin main v1.0.0`.
5. The «Сборка установщика для Windows» and «Сборка для Mac» workflows build the installers and put them, with their
   `.sig` files, into a **draft** release. Wait for both (Actions).
6. Check the draft: `Oddments_…_x64-setup.exe` and `.exe.sig`, `Oddments_…_universal.dmg`, `Oddments.app.tar.gz` and
   `.app.tar.gz.sig`, `oddments-safari.zip`. Paste the release text (from the changelog) — it also becomes the update's
   notes.
7. Publish. The «Файлы выпуска — latest.json и расширение Blender» workflow attaches `latest.json`, the add-on package
   `oddments-<add-on version>.zip` and the Blender extension repository's `index.json` by itself. Check that
   `https://github.com/peopleskynet-boop/Oddments/releases/latest/download/latest.json` opens and has the new version,
   and `…/latest/download/index.json` has the current add-on version.
8. Check the update on a computer with the previous version: Settings › About › «Check now» → «Install».
9. In a Blender with the repository added (install.en.md › «The Blender add-on») — «Check for Updates» in Get Extensions.

The add-on's version is `bl_info` in `integrations/blender/perch_blender.py`; `python tools/blender_extension.py` brings
`blender_manifest.toml` in line with it and checks the package with a real Blender. For CI the same package is built
without Blender by `node tools/blender-repo.mjs <folder>`.

The first version with updates is 1.0.0: copies of 0.1.0 cannot update themselves and are reinstalled by hand once.
