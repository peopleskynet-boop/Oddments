**Русский:** [signing.md](signing.md)

# Signing the installers and the updates

For whoever releases Oddments builds. Three different signatures; each turns on in CI by itself once its secrets are
set in the public repository (GitHub › the repository › Settings › Secrets and variables › Actions). Without a secret
the build is the same, just without that signature.

| Signature | Why | Secrets | Now |
|---|---|---|---|
| The updater key | an installed Oddments accepts only updates signed with this key | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | key created, secrets to be set |
| Windows (Authenticode) | no SmartScreen warning, company security lets the installer through | `AZURE_*` (below) | no certificate |
| macOS (Developer ID + notarization) | the app opens with a double click, not through «Open» in the menu | `APPLE_*` (below) | no Apple Developer account |

## The updater key

Not a certificate but a minisign key pair, free. The public half is in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`); the private half stays with whoever releases versions.

- To create one (if there is none yet): `npx tauri signer generate -w ~/.tauri/oddments-updater.key` — it asks for a
  password. Put the public half from `oddments-updater.key.pub` into `pubkey`.
- Secrets: `TAURI_SIGNING_PRIVATE_KEY` — the whole content of `oddments-updater.key`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password.
- **Keep the key and the password somewhere safe** (a password manager). If the key is lost, installed copies cannot
  update themselves — a version with a new key has to be released and everyone has to reinstall it by hand.

Once a release is published, the «Файлы выпуска» (release files) workflow builds `latest.json` from the `.sig` files and attaches it to
the release. Installed copies read it from
`https://github.com/peopleskynet-boop/Oddments/releases/latest/download/latest.json`.

## Windows

Unsigned, Windows shows «Windows protected your PC» — «More info › Run anyway». Signing does not remove the warning at
once: SmartScreen reputation grows with downloads.

Options (the choice belongs to whoever releases; they go through the accounts and identity checks themselves):

1. **Azure Artifact Signing** (formerly Trusted Signing) — the cheapest (about $10 a month), signs right in CI, already
   wired into `build-windows.yml`. Microsoft checks the identity; as of late 2025 — for organisations in the US,
   Canada, the EU and the UK and for individuals in the US and Canada.
   1. An Azure subscription → an «Artifact Signing account» resource → Identity validation.
   2. A certificate profile of the Public Trust type.
   3. An app registration (Microsoft Entra ID) with a secret, given the «Certificate Profile Signer» (Artifact Signing, formerly Trusted Signing)
      role on the signing account.
   4. Secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT` (e.g.
      `https://weu.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
2. **SignPath Foundation** — free signing for open-source projects (an OSI licence, a public repository, built in CI).
   Apply at signpath.org; the signature reads «SignPath Foundation». Signing is a separate step after the build (their
   GitHub Action), so the updater `.sig` must be made again over the signed installer:
   `npx tauri signer sign -f <key> -p <password> Oddments_…_x64-setup.exe`.
3. **An OV certificate from a certificate authority** (Certum Open Source, SSL.com, Sectigo…). Since 2023 the key
   lives only on a token or in a cloud HSM, so signing in CI goes through the authority's cloud tool (`signCommand`
   in `tauri.conf.json` instead of `trusted-signing-cli`).

Many certificate authorities and Azure do not currently serve individuals and companies from Russia — check the terms
before paying.

## macOS

Unsigned, macOS does not open the app on a double click: the first time — right click › «Open» (macOS 15: System
Settings › Privacy & Security › «Open Anyway»).

1. **Apple Developer Program** — $99 a year, developer.apple.com/programs (paid with a card Apple accepts).
2. A **Developer ID Application** certificate: Keychain Access › Certificate Assistant › request a certificate →
   upload it at developer.apple.com › Certificates → download, open → export from Keychain Access as `.p12` with a
   password.
3. An app-specific password for notarization: appleid.apple.com › Sign-In and Security › App-Specific Passwords.
4. Secrets:
   - `APPLE_CERTIFICATE` — the `.p12` in base64 (`base64 -i cert.p12 | pbcopy`);
   - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password;
   - `APPLE_SIGNING_IDENTITY` — «Developer ID Application: Name (TEAMID)»;
   - `APPLE_ID` — the Apple account's email, `APPLE_PASSWORD` — the app-specific password, `APPLE_TEAM_ID` — the Team ID.

`build-macos.yml` passes them to Tauri: it signs the app, sends it to Apple for notarization and staples the result to
the `.dmg`. The Safari extension is still signed ad-hoc (Safari › Develop › «Allow Unsigned Extensions»); with the same
certificate it can be signed and notarized too — a separate step in the workflow.

## Releasing

The full list of steps is in [release.en.md](release.en.md).
