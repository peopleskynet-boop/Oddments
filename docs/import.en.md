**Русский:** [import.md](import.md)

# Moving over from Eagle and PureRef

Oddments copies the files to itself and changes nothing in the original library: Eagle and PureRef can stay as they are.

## Eagle

**Add › «Move over from Eagle…»** (or the command palette, or the switch in the first-run window) → pick the Eagle
library folder — the one ending in `.library`. Eagle itself shows where it is: «Library › Show in Explorer / Finder».
Close Eagle before moving over.

What comes over:

| In Eagle | In Oddments |
|---|---|
| Folders and subfolders | collections inside a «Eagle · library name» collection |
| A file | the original is copied, Oddments makes its own preview |
| Name, tags | name, tags |
| Annotation and comments on the picture | the note |
| Link (URL) | the source link |
| Date added | date added |
| Files outside any folder | the «Eagle · library name» collection |

Not carried over: Eagle's trash, star ratings (Oddments has no ratings), smart folders, tag groups and their colours,
folder passwords. Oddments works out the palette itself.

Moving the same library over again adds only what is not there yet: Oddments remembers which files already came from
Eagle. A big library takes a while — the progress shows in the pill at the top, and Oddments keeps working meanwhile.

## PureRef

**Add › «Pictures from a PureRef board…»** → pick one or more `.pur` files. Each board becomes a «PureRef · board name»
collection with its pictures.

The `.pur` format is closed, so Oddments takes only the pictures from it — they are stored inside as whole files. The
layout, scale, rotation, crops and text notes of the board are not carried over. A picture placed on the board several
times comes once. If a board was saved by a PureRef version Oddments cannot read, it says no pictures were found — then
select the pictures in PureRef, copy them (Ctrl/⌘+C) and paste them into Oddments.

## Ordinary folders

Add › «Import a folder» — every file of the folder and its subfolders, in any format Oddments can show.
