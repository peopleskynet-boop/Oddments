# Сторонние компоненты

Oddments распространяется под лицензией MIT. В нём используются следующие сторонние библиотеки и ресурсы; их
лицензии сохраняются за их авторами. Полные тексты лицензий npm- и Cargo-пакетов лежат в самих пакетах.

## Библиотеки (npm)

| Пакет | Лицензия |
|---|---|
| three.js | MIT |
| paper.js | MIT |
| figma-squircle | MIT |
| clipper-lib (Angus Johnson) | Boost Software License 1.0 |
| pdfjs-dist (Mozilla) | Apache-2.0 |
| ag-psd | MIT |
| onnxruntime-web (Microsoft) | MIT |
| comlink (Google Chrome Labs) | Apache-2.0 |
| xatlasjs (xatlas, Jonathan Young) | MIT |
| @huggingface/tokenizers | Apache-2.0 |
| @mozilla/readability | Apache-2.0 |
| DOMPurify | Apache-2.0 или MPL-2.0 |
| Phosphor Icons | MIT |
| Шрифты Geist, Geist Mono (Vercel), Golos Text, Onest — через Fontsource | SIL Open Font License 1.1 |
| @tauri-apps/* | MIT или Apache-2.0 |
| @crabnebula/tauri-plugin-drag | MIT или Apache-2.0 |

## Rust (Cargo)

tauri и плагины tauri-plugin-* (MIT или Apache-2.0), tauri-plugin-drag (CrabNebula, MIT или Apache-2.0), serde,
serde_json (MIT или Apache-2.0).

## Скачиваемое и встраиваемое

- **AutoRemesher** 1.2.0 (Jeremy HU, MIT) — кладётся в установщик Windows при сборке, текст лицензии — рядом с ним.
- **SigLIP 2** (Google, Apache-2.0) — модель ИИ-поиска, скачивается с Hugging Face, только когда человек включает ИИ.
- **PaddleOCR PP-OCRv5** (PaddlePaddle, Apache-2.0) — распознавание текста на картинках, скачивается с Hugging Face.
- **Real-ESRGAN x4plus** (Xintao Wang, BSD-3-Clause) — увеличение картинок, скачивается при первом использовании.
- **HDRI Poly Haven** (CC0) — скачиваются при первом выборе освещения в 3D-просмотре.

## Перенесённое поведение компонентов

Код написан заново на чистом JavaScript по мотивам открытых компонентов:

- **Arc** (uiarc.dev, MIT, © 2026 Elia Kuratli) — пружины, общая подсветка групп, список выбора, стопка тостов,
  кнопка-подтверждение, эластичный ползунок, палитра команд. Pro-компоненты Arc не использовались.
- **Beautiful UI** (beautifului.dev, MIT) — пиксельный загрузчик, плашка выделения, шаги работы ИИ.
