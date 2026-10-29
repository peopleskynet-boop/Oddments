**Русский:** [install.md](install.md)

# Installing Oddments

The installers are on the [Releases](https://github.com/peopleskynet-boop/Oddments/releases) page. While the builds
are not signed with a developer certificate, the system asks once on the first start — that is expected.

## Windows 10 and 11

1. Download and run `Oddments_…_x64-setup.exe`. It installs for the current user, no administrator rights needed.
2. If Windows shows «Windows protected your PC»: **«More info» → «Run anyway»**.
3. WebView2 is already part of Windows 11 and recent Windows 10; if it is missing, the installer adds it.

## Mac (Apple Silicon and Intel, macOS 11 or newer)

1. Open `Oddments_…_universal.dmg` and drag **Oddments** into **Applications**.
2. In **Applications**, **right-click** Oddments → **«Open»** → **«Open»** again in the dialog.
   - If there is no «Open» button (macOS 15 and newer): **System Settings → Privacy & Security** → at the bottom
     «Oddments was blocked…» → **«Open Anyway»**, then start Oddments again.
   - If it says «Oddments is damaged»: in **Terminal** run
     `xattr -dr com.apple.quarantine /Applications/Oddments.app` and start it again.
3. From then on Oddments opens as usual.

The Mac version has no AutoRemesher «Remesh» (AutoRemesher has no Mac build); «SVG to 3D» works in the «Exact» mode.
The command palette is **⌘ K**.

## The first start

Oddments asks for:
- **the language** — English or Russian (later: Settings › Look › Language);
- **the library folder** — `Documents/Oddments Library` by default; a folder in a cloud drive or on a network share works;
- **whether to bring files over from Eagle** — right after the start it asks for the `.library` folder
  ([import.en.md](import.en.md));
- **what to turn on**: search by meaning (a ~0.9 GB model, downloaded once), text on pictures (13 MB), the update
  check, «Offline» mode.

«Getting started» appears at the bottom left — five short steps through the essentials. All keys — **?**.

## Where to begin

- Drag pictures, videos or models into the window, or press **Ctrl/⌘ + V** — Oddments makes the previews.
- **/** — search, **[** — the sidebar, **\\** — the clean screen, **?** — all keys.
- The library is ordinary files in the folder you chose; you can take them with you at any time.

## Updates

With the update check on, once a day Oddments asks GitHub whether there is a new version and shows an «A new Oddments is
out» toast with an «Install» button. On Windows the installer closes Oddments and opens it again by itself; on the
Mac the app restarts. To check by hand — Settings › About › «Check now» or the command palette. You can always
download the new installer from Releases and install it over the old one — the library and settings stay.

## The Blender add-on

The easiest way is as an extension in Blender 5.2 or newer — then updates come inside Blender itself:
1. Edit › Preferences › **Get Extensions** › the **Repositories** menu (top right) › **+** › **Add Remote Repository**.
2. URL: `https://github.com/peopleskynet-boop/Oddments/releases/latest/download/index.json`, tick **Check for Updates on Startup**.
3. Find **Oddments** in the list and press **Install**.

The other way (also for older Blender versions) — Oddments › «Plugins» › Blender › «Save the add-on…», then in Blender
Edit › Preferences › Add-ons › Install from Disk. Either way, paste the token from Oddments (Settings › Integrations ›
«Copy the token») into the add-on's preferences.

## Plugins and Claude

Every integration is in Oddments › the sidebar › Tools › «Plugins»: Blender, Figma, Chrome and Edge, Safari and Claude.
For Claude Desktop the «For Claude Desktop» button copies the settings — paste them into `claude_desktop_config.json`
(Claude › Settings › Developer › Edit Config) and restart Claude. For Claude Code the button copies the
`claude mcp add …` command. Then you can ask Claude: «find references with glass and violet light in Oddments».

## If something goes wrong

Settings › About › «Crash report» › **«Copy the report»** — paste it into an email
([peopleskynet@gmail.com](mailto:peopleskynet@gmail.com)) or into [Issues](https://github.com/peopleskynet-boop/Oddments/issues).
The report has the version, the system and the last errors; your user name and the library path are taken out.

## Uninstalling

- **Windows:** Settings › Apps › Oddments › Uninstall.
- **Mac:** drag Oddments from Applications to the Bin.

The library stays where it is. To remove the app's data too (AI models, settings, reports), delete
`%LOCALAPPDATA%\app.perch.desktop` (Windows) or `~/Library/Application Support/app.perch.desktop` (Mac).
