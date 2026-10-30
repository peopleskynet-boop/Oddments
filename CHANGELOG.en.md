**Русский:** [CHANGELOG.md](CHANGELOG.md)

# Changelog

## 1.0.2 — 30 October 2026

- AI search: on the first run the AI could answer “Session already started” or hang when a search or AI tags came
  at the same time as studying the library. The model now takes requests one at a time.
- English: material and block cards, the heart's tooltip, screen-reader labels, the team and personal-data badges and
  the status line in “SVG to 3D” are no longer in Russian; quotes in English text are “ ” instead of « ».

## 1.0.1 — 29 October 2026

- Claude Code connects to Oddments the way Claude Desktop does: through `Oddments --mcp`, and Oddments starts by
  itself if it was closed. «For Claude Code» in «Plugins» copies the new command; if Oddments is already added by its
  127.0.0.1 address, run `claude mcp remove -s user oddments` first.
- English: the corner label of the clean screen («All files») and the tooltip of the library folder are translated.
- A library made before the rename (the «Perch Library» folder) is labelled «Oddments Library» at the bottom of the
  sidebar; the real path is in the tooltip.

## 1.0.0 — 29 October 2026

**The release**
- Updates: once a day, if you allowed it, Oddments checks GitHub for a new version and shows an «A new Oddments is out»
  toast — «Install» downloads it, installs it and restarts. Updates are signed with the project's key.
- The first-run window: language, the library folder, moving over from Eagle, AI search, text on pictures, updates,
  «Offline».
- Settings › «About»: the version and updates, privacy, the crash report, licences.
- «Offline» mode: one switch — nothing is downloaded or sent, the window loads nothing from other sites.
- A local crash report: errors and crashes are written to a file on the computer, «Copy the report» takes out personal
  paths; nothing is sent anywhere.
- Moving over from Eagle (folders, tags, notes, links, dates; a second run adds only what is new) and pictures from
  PureRef boards.
- The MIT licence and the full list of third-party components with their licence texts — in the app and in
  `THIRD_PARTY_NOTICES.md`.
- Documentation in English and Russian: installing, privacy, moving over, building, signing, releasing.

**New since 0.1.0**
- Gaussian splats: PLY and SPZ viewing, thumbnails, «Splat from a model», Cycles-quality splats through the Blender
  add-on 1.21.
- «Remove background» with BEN2 on the graphics card: the edge from the photo, fringe clean-up, a brush.
- A loupe at the cursor in «Upscale» and «Remove background».
- English where the interface had none, English numbers and dates.
- Interface audit fixes: the properties panel layout, dense glass under text, tabs by the row's width, a shorter card
  menu, a file picker for tools started from the palette, the B and U keys, keyboard accessibility.

## 0.1.0 — 28 October 2026

The first public release: a reference library for Windows and macOS — images, video, 3D, materials, fonts, PDF and
PSD; search by colour and by meaning, text on pictures, upscaling, a 3D viewer and «SVG to 3D», an icon constructor,
flows from screen recordings, a team library, a news feed, Blender and Figma plugins, a browser extension, MCP for
Claude.
