**Русский:** [privacy.md](privacy.md)

# Privacy

Oddments is a desktop app. The library is an ordinary folder on your disk; there is no account, and nothing goes to
our server — Oddments has none. The program has no analytics, counters or telemetry.

## What never leaves your computer

- The library: original files, thumbnails, `index.json`, collections, tags, notes, comments, marks.
- What the on-device AI makes: the search vectors, the text read from pictures, upscaled pictures, cut-outs.
- Crash reports. They are written to the app's data folder; only you can pass one on, with «Copy the report»
  (Settings › About › Crash report).
- API keys (Anthropic, Voyage) — kept in Oddments' settings on this computer and sent only to the service they belong to.

## When Oddments goes online

Only for what you turned on or did yourself:

| What | Where | When |
|---|---|---|
| The SigLIP 2 AI search model (~0.9 GB), text reading (13 MB), upscaling with Real-ESRGAN (34 MB), background removal with BEN2 (223 MB) | huggingface.co | once, when you turn the feature on or press «Download» |
| HDRI lighting for the 3D viewer | dl.polyhaven.org | the first time you pick that lighting |
| The feed, the daily digest, saved articles, Telegram channels, designers' blogs and YouTube | the sources' sites, t.me | when you open the feed or save an article |
| Covers and titles of links | youtube.com, vimeo.com, pinterest.com, figma.com and the link's own site | when you add a link or watch a clip |
| The built-in YouTube and Vimeo player | youtube-nocookie.com, player.vimeo.com | when you open such a clip |
| A picture pasted from a browser | the picture's site | on paste (Ctrl/⌘+V), when the clipboard holds only its address |
| AI through the API: descriptions, tags, search, article translation, icons from a description | api.anthropic.com, api.voyageai.com | only with your key; requests and reduced copies of pictures (512 px) go, never the originals |
| The update check | github.com | once a day, if you turned it on; one request for `latest.json` with nothing about you |

The requests go straight from your computer to those sites; their own policies apply there.

## Inside the computer

The Blender add-on, the Figma plugin, the browser extension and Claude (MCP) talk to Oddments through a receiver on
`127.0.0.1` — it cannot be reached from the network, and requests without the token are refused.

## «Offline» mode

Settings › About › «Offline» (Без сети) — one switch, and Oddments downloads and sends nothing: the app refuses all of
its own requests to sites, and the window loads no pictures, clips or players from other sites. Everything already on
the computer works: the library, search, viewing, 3D, downloaded AI models, the Blender and Figma links. Turning the
switch off reloads the window.

## Where the data is

- The library — the folder you chose (by default `Documents/Oddments Library`).
- Settings — in the app window's storage.
- AI models, HDRIs, the integration token and crash reports — in the app's data folder:
  `%LOCALAPPDATA%\app.perch.desktop` on Windows, `~/Library/Application Support/app.perch.desktop` on the Mac.

To remove everything, uninstall the program and delete the app's data folder and, if you wish, the library folder.

Questions — [peopleskynet@gmail.com](mailto:peopleskynet@gmail.com).
