# Oddments — Blender add-on: send models, materials and viewport snapshots to Oddments, insert files selected in Oddments.
# Install: Edit › Preferences › Add-ons › (menu) Install from Disk… → this file. Then paste the token
# from Oddments › Settings › Integrations into the add-on preferences.
# Talks to Oddments' local receiver on 127.0.0.1 only; nothing leaves the computer.
bl_info = {
    "name": "Oddments",
    "author": "Oddments",
    "version": (1, 22, 0),
    "blender": (4, 2, 0),
    "location": "3D Viewport › Sidebar (N) › Oddments · Ctrl+Shift+P",
    "description": "Отправить в Oddments и вставить из Oddments",
    "category": "Import-Export",
}

import json
import math
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
import urllib.error
import urllib.parse
import urllib.request

import blf
import bpy
import gpu
from gpu_extras.batch import batch_for_shader
from mathutils import Matrix, Vector

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}

# The add-on's id: its package when installed as a Blender extension (bl_ext.<repository>.oddments), the module's name
# when installed as a single .py file. Preferences and translations are registered under it.
ADDON = __package__ or __name__
# As an extension it follows Blender's «Allow Online Access»: when that is off, no connection at all — not even to
# Oddments on this computer (127.0.0.1). A plain .py install keeps working as before.
_EXTENSION = ADDON.startswith("bl_ext.")
OFFLINE_HINT = "В Blender выключен доступ к сети (Preferences › System › Network › Allow Online Access). Аддон связывается только с Oddments на этом компьютере (127.0.0.1) — включите доступ, чтобы работать с библиотекой"


class OfflineError(urllib.error.URLError):
    """Blender's «Allow Online Access» is off (an extension install)"""


def _offline():
    return _EXTENSION and not getattr(bpy.app, "online_access", True)


def _open(req, timeout):
    """Every request to Oddments goes through here (urllib.request.urlopen, after the online-access check)"""
    if _offline():
        raise OfflineError("online access is off")
    return urllib.request.urlopen(req, timeout=timeout)


def _prefs():
    return bpy.context.preferences.addons[ADDON].preferences


def _url(path, **query):
    p = _prefs()
    query["token"] = p.token.strip()
    return "http://127.0.0.1:%d%s?%s" % (p.port, path, urllib.parse.urlencode(query))


def _ping():
    try:
        with _open("http://127.0.0.1:%d/ping" % _prefs().port, timeout=1.5) as r:
            return json.loads(r.read().decode()).get("app") == "perch"
    except Exception:
        return False


def _send(filepath, name):
    with open(filepath, "rb") as f:
        data = f.read()
    req = urllib.request.Request(_url("/import", name=name, source="blender"), data=data, method="POST",
                                 headers={"Content-Type": "application/octet-stream"})
    with _open(req, timeout=120) as r:
        return json.loads(r.read().decode()).get("ok", False)


# ---------- language ----------
# The add-on speaks Russian or English. «Как в Blender» (default): English unless Blender itself is in Russian.
# Texts stay Russian in the code. Labels, tooltips and property names are translated by Blender through the
# dictionary registered below; messages and the browser's own drawing call _t().
_EN_ON = False
EN = {
    OFFLINE_HINT: "Online access is off in Blender (Preferences › System › Network › Allow Online Access). The add-on only talks to Oddments on this computer (127.0.0.1) — turn it on to use the library",
    "Отправить в Oddments и вставить из Oddments": "Send to Oddments and insert from Oddments",
    "Oddments › Настройки › Интеграции › «Скопировать токен», затем Edit › Preferences › Add-ons › Oddments": "Oddments › Settings › Integrations › «Copy the token», then Edit › Preferences › Add-ons › Oddments",
    "Сначала вставьте токен: ": "Paste the token first: ",
    "Oddments не принял токен — скопируйте его заново: ": "Oddments did not accept the token — copy it again: ",
    "Файл больше 1 ГБ — Oddments такие не принимает": "The file is over 1 GB — Oddments does not take such files",
    "Oddments оборвал соединение — скорее всего, не подошёл токен: ": "Oddments dropped the connection — most likely the token is wrong: ",
    "Oddments не отвечает: откройте приложение Oddments (порт %d)": "Oddments does not answer: open the Oddments app (port %d)",
    "Не получилось: %s": "Failed: %s",
    "Токен": "Token",
    "Из Oddments › Настройки › Интеграции": "From Oddments › Settings › Integrations",
    "Порт": "Port",
    "Принимать из Oddments": "Receive from Oddments",
    "Файлы, отправленные кнопкой «В Blender» в Oddments, сразу появляются в сцене": "Files sent with «To Blender» in Oddments appear in the scene at once",
    "Запекать процедурные материалы": "Bake procedural materials",
    "Сглаживание моделей при вставке": "Smoothing of inserted models", "По углу": "By angle",
    "Модификатор Auto Smooth": "Auto Smooth modifier", "Не трогать": "Leave as is", "Угол": "Angle",
    "Shade Smooth by Angle прямо в меше: гладко, рёбра острее угла — острые. Без модификатора: так же в экспорте и любом рендере":
        "Shade Smooth by Angle on the mesh itself: smooth, edges sharper than the angle stay sharp. No modifier: the same in export and any render",
    "Shade Auto Smooth: модификатор «Smooth by Angle», угол можно менять потом": "Shade Auto Smooth: the «Smooth by Angle» modifier, the angle can be changed later",
    "Как пришло из файла": "As it came in the file",
    "Модели без своих нормалей (STL, OBJ из «SVG в 3D», PLY…) становятся гладкими. Нормали, записанные в файле (GLB, FBX, OBJ с нормалями), не трогаются — это сглаживание автора":
        "Models without normals of their own (STL, OBJ from «SVG to 3D», PLY…) come in smooth. Normals written in the file (GLB, FBX, OBJ with normals) stay — that is the author's shading",
    "Рёбра острее этого угла остаются острыми": "Edges sharper than this angle stay sharp",
    "Перед отправкой запечь в текстуры материалы из нод (шум, рампы, группы, Mix Shader): glTF и Oddments переносят только картинки и числа. Ваш .blend не меняется": "Before sending, bake node materials (noise, ramps, groups, Mix Shader) into textures: glTF and Oddments carry only images and numbers. Your .blend is not changed",
    "Размер текстур": "Texture size",
    "Библиотека материалов и моделей": "Materials and models library",
    "Папка, где аддон хранит материалы, модели и пресеты света (пусто — Документы/Oddments Library/Blender Materials). Общая папка команды (сетевой диск, OneDrive) — и у всех 3D-дизайнеров одна библиотека в Asset Browser": "The folder where the add-on keeps materials, models and light presets (empty — Documents/Oddments Library/Blender Materials). A team's shared folder (network drive, OneDrive) gives every 3D designer one library in the Asset Browser",
    "Подогнать размер при замене": "Fit the size when swapping",
    "Вписать новую модель в габариты заменяемого объекта": "Fit the new model into the bounds of the replaced object",
    "Материалы старого при замене": "Keep the old materials when swapping",
    "Надеть на новую модель материалы заменяемого объекта": "Put the replaced object's materials on the new model",
    "Токен — в Oddments › Настройки › Интеграции, кнопка «Скопировать токен».": "The token is in Oddments › Settings › Integrations, the «Copy the token» button.",
    "Пусто — ": "Empty — ",
    "Выделенное в Oddments": "Selection to Oddments",
    "Сохранить выделенные объекты в GLB и отправить в библиотеку Oddments": "Save the selected objects as GLB and send them to the Oddments library",
    "Текстуры через узлы, которые glTF не переносит (%s): в Oddments придёт без них. Подключите Image Texture прямо к Principled BSDF или запеките карты.": "Textures go through nodes glTF does not carry (%s): Oddments gets the model without them. Connect the Image Texture straight to the Principled BSDF or bake the maps.",
    "Отправлено в Oddments: %s%s": "Sent to Oddments: %s%s",
    " (запечено материалов: %d)": " (materials baked: %d)",
    "Файл .blend в Oddments": ".blend file to Oddments",
    "Отправить копию текущего файла .blend (оригинал не меняется)": "Send a copy of the current .blend file (the original is not changed)",
    "Отправлено в Oddments: %s": "Sent to Oddments: %s",
    "Снимок вьюпорта в Oddments": "Viewport shot to Oddments",
    "Отрисовать текущий вид вьюпорта и отправить картинкой": "Render the current viewport and send it as a picture",
    " — снимок.png": " — shot.png",
    "Снимок отправлен в Oddments": "The shot was sent to Oddments",
    "Материал в Oddments": "Material to Oddments",
    "Отправить активный материал в библиотеку Oddments: Principled BSDF и его текстуры; материал из нод (шум, рампы, Mix Shader) сначала запекается в текстуры": "Send the active material to the Oddments library: the Principled BSDF and its textures; a node material (noise, ramps, Mix Shader) is baked into textures first",
    "Материал «%s» отправлен в Oddments (текстур: %d)": "Material «%s» sent to Oddments (textures: %d)",
    "Все материалы сцены в Oddments": "All scene materials to Oddments",
    "Каждый материал объектов сцены — в библиотеку Oddments (материалы из нод запекаются в текстуры)": "Every material of the scene's objects to the Oddments library (node materials are baked into textures)",
    "В Oddments: %d, не получилось: %s": "In Oddments: %d, failed: %s",
    "Все материалы сцены в Oddments: %d": "All scene materials in Oddments: %d",
    "Применить материал из Oddments": "Apply the material from Oddments",
    "Материал, выделенный в Oddments, — на выделенные объекты (текстуры упаковываются в .blend)": "The material selected in Oddments onto the selected objects (textures are packed into the .blend)",
    "В Oddments не выделен материал": "No material is selected in Oddments",
    "Не удалось прочитать материал: %s": "Could not read the material: %s",
    "Материал «%s» назначен объектам: %d": "Material «%s» assigned to objects: %d",
    "Материал «%s» добавлен в файл — выделите объекты, чтобы назначить": "Material «%s» added to the file — select objects to assign it",
    "Вставить из Oddments": "Insert from Oddments",
    "Добавить в сцену файлы, выделенные сейчас в Oddments: модели — объектами, картинки — референсами": "Add the files selected in Oddments to the scene: models as objects, pictures as references",
    "В Oddments ничего не выделено": "Nothing is selected in Oddments",
    "Вставлено из Oddments: %d%s": "Inserted from Oddments: %d%s",
    ", пропущено: %d": ", skipped: %d",
    "Проверить подключение": "Check the connection",
    "Найти Oddments на этом компьютере и проверить токен": "Find Oddments on this computer and check the token",
    "Oddments на связи, токен подходит. Выделено в Oddments: %d": "Oddments is connected, the token works. Selected in Oddments: %d",
    "библиотеку сейчас записывает кто-то другой — попробуйте через минуту": "someone else is writing the library right now — try again in a minute",
    "библиотека не записалась: ": "the library was not written: ",
    "в библиотеке нет «%s»": "«%s» is not in the library",
    "Материал в библиотеку": "Material to the library",
    "Сохранить активный материал как есть — с нодами, группами и картинками — в библиотеку материалов аддона. Без переделки в Oddments: процедурные материалы остаются процедурными": "Save the active material as it is — with nodes, groups and images — to the add-on's material library. No conversion for Oddments: procedural materials stay procedural",
    "Выберите объект с материалом": "Select an object with a material",
    "Не сохранилось: %s": "Not saved: %s",
    "В библиотеке: «%s»": "In the library: «%s»",
    "В библиотеке: %d материалов": "In the library: %d materials",
    " · папка добавлена в Asset Browser («%s»)": " · the folder was added to the Asset Browser («%s»)",
    "Этот тип файла в сцену не вставить": "This file type cannot be inserted into the scene",
    "В файле нет объектов": "The file has no objects",
    "Заменить на модель из Oddments": "Swap for a model from Oddments",
    "Поставить модель из Oddments на место выделенных объектов: положение, поворот, масштаб, родитель, коллекции и имя сохраняются. Старые объекты — в скрытой коллекции «Oddments · заменённые»": "Put the model from Oddments in place of the selected objects: location, rotation, scale, parent, collections and name are kept. The old objects go to the hidden collection «Oddments · заменённые»",
    "Подогнать размер": "Fit the size",
    "Вписать новую модель в габариты старой (по самой большой стороне)": "Fit the new model into the old one's bounds (by the longest side)",
    "Материалы старого": "Old materials",
    "Выделите в сцене то, что заменить": "Select in the scene what to replace",
    "Выделите модель в Oddments": "Select a model in Oddments",
    "Не вставилось: %s": "Not inserted: %s",
    "Заменено на «%s»: %d": "Swapped for «%s»: %d",
    "Вставить у 3D-курсора": "Insert at the 3D cursor",
    "Вставлено: %s": "Inserted: %s",
    "Заменить выделенное": "Swap the selection",
    "Модель встанет на место каждого выделенного объекта: положение, поворот, масштаб, родитель, коллекции и имя. Старые объекты не удаляются — они в скрытой коллекции «Oddments · заменённые». Ctrl+Z вернёт всё.": "The model takes the place of every selected object: location, rotation, scale, parent, collections and name. The old objects are not deleted — they go to the hidden collection «Oddments · заменённые». Ctrl+Z brings everything back.",
    "Модель целиком, как в Oddments, — там, где стоит 3D-курсор.": "The whole model, as in Oddments, where the 3D cursor is.",
    "Новая модель вписывается в габариты старой по самой большой стороне и встаёт по её центру. Без этого — точка начала новой модели совпадает с точкой начала старой.": "The new model is fitted into the old one's bounds by the longest side and centred on it. Without this the new model's origin goes to the old one's origin.",
    "На новую модель надеваются материалы заменяемого объекта — удобно, когда меняете только форму.": "The replaced object's materials go onto the new model — handy when only the shape changes.",
    "Назначить выделенному": "Assign to the selection",
    "Материал — на все выделенные объекты (активным слотом). Из библиотеки аддона он приходит как был сохранён: ноды, группы, картинки.": "The material onto all selected objects (into the active slot). From the add-on's library it comes as it was saved: nodes, groups, images.",
    "Сохранить активный": "Save the active one",
    "Материал активного объекта — в библиотеку аддона как есть, без переделки: процедурные ноды остаются нодами. Папка библиотеки видна и в Asset Browser («Oddments · материалы»).": "The active object's material to the add-on's library as it is, no conversion: procedural nodes stay nodes. The library folder is also in the Asset Browser («Oddments»).",
    "Убрать из библиотеки": "Remove from the library",
    "Удаляет файл материала из библиотеки аддона (нажмите ещё раз, чтобы подтвердить). Материалы в ваших сценах не трогаются.": "Deletes the material file from the add-on's library (press again to confirm). Materials in your scenes are not touched.",
    "В файл": "To the file",
    "Материал добавляется в этот .blend как ассет (виден в Asset Browser › Current File), выделенное не меняется.": "The material is added to this .blend as an asset (seen in Asset Browser › Current File), the selection is not changed.",
    "Браузер Oddments": "Oddments browser",
    "Панель Oddments во вьюпорте: модели и материалы с превью, SVG-иконки в 3D набором, все команды аддона": "The Oddments panel in the viewport: models and materials with previews, SVG icons to 3D as a set, every command of the add-on",
    "НЕТ ТОКЕНА ODDMENTS — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ": "NO ODDMENTS TOKEN — MATERIAL LIBRARY ONLY",
    "ODDMENTS НЕ ОТВЕЧАЕТ — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ": "ODDMENTS DOES NOT ANSWER — MATERIAL LIBRARY ONLY",
    "Нужно окно 3D-вида": "A 3D Viewport is needed",
    "В Oddments пока нет моделей и материалов": "No models or materials in Oddments yet",
    "БИБЛИОТЕКА МАТЕРИАЛОВ НЕ ЧИТАЕТСЯ: %s": "CANNOT READ THE MATERIAL LIBRARY: %s",
    "// БРАУЗЕР": "// BROWSER",
    "Закрыть": "Close",
    "Esc или та же кнопка в панели Oddments.": "Esc or the same button in the Oddments panel.",
    "Поиск: название или тег": "Search: name or tag",
    "МОДЕЛИ (%d)": "MODELS (%d)",
    "МАТЕРИАЛЫ (%d)": "MATERIALS (%d)",
    "ПОДОГНАТЬ РАЗМЕР": "FIT THE SIZE",
    "МАТЕРИАЛЫ СТАРОГО": "OLD MATERIALS",
    "ВСТАВИТЬ": "INSERT",
    "ЗАМЕНИТЬ · %d": "SWAP · %d",
    "+ СОХРАНИТЬ АКТИВНЫЙ": "+ SAVE THE ACTIVE ONE",
    "ТОЧНО УБРАТЬ?": "REMOVE FOR SURE?",
    "УБРАТЬ": "REMOVE",
    "В ФАЙЛ": "TO THE FILE",
    "НАЗНАЧИТЬ · %d": "ASSIGN · %d",
    "КЛИК — ВЫБРАТЬ · ДВОЙНОЙ — ": "CLICK — SELECT · DOUBLE — ",
    "ЗАМЕНИТЬ": "SWAP",
    "НАЗНАЧИТЬ": "ASSIGN",
    "Ничего не нашлось": "Nothing found",
    "Моделей нет": "No models",
    "Пусто — «+ Сохранить активный»": "Empty — «+ Save the active one»",
    "БЫЛО": "BEFORE",
    "СТАЛО": "AFTER",
    "СОХРАНЯЮ МАТЕРИАЛ": "SAVING THE MATERIAL",
    "НЕ УДАЛИЛОСЬ: %s": "NOT DELETED: %s",
    "УБРАНО ИЗ БИБЛИОТЕКИ: ": "REMOVED FROM THE LIBRARY: ",
    "СКАЧИВАЮ ": "DOWNLOADING ",
    "В БИБЛИОТЕКЕ: ": "IN THE LIBRARY: ",
    "НЕ ВЫШЛО": "FAILED",
    "НЕ ВЫШЛО: %s": "FAILED: %s",
    "НЕ СКАЧАЛОСЬ: %s": "NOT DOWNLOADED: %s",
    "ЗАМЕНЕНО: ": "SWAPPED: ",
    "ВСТАВЛЕНО: ": "INSERTED: ",
    "НАЗНАЧЕН %s · %d": "ASSIGNED %s · %d",
    "В ФАЙЛЕ: ": "IN THE FILE: ",
    "Oddments: материал": "Oddments: material",
    "Закрыть браузер Oddments": "Close the Oddments browser",
    "Модели Oddments → Asset Browser": "Oddments models → Asset Browser",
    "Все модели из Oddments — ассетами в Asset Browser Blender (библиотека «Oddments»): с превью, тегами и каталогами по подборкам. Повторный запуск добавит новые и уберёт удалённые": "All models from Oddments as assets in Blender's Asset Browser (the «Oddments» library): with previews, tags and catalogs by collection. Running it again adds new ones and removes deleted ones",
    "Синхронизация уже идёт": "Sync is already running",
    "Oddments не отвечает: %s": "Oddments does not answer: %s",
    "В Oddments нет моделей, которые Blender умеет открыть": "Oddments has no models Blender can open",
    "Синхронизация: %d моделей…": "Syncing: %d models…",
    "Модели уходят в Asset Browser в фоне: %d": "Models are going to the Asset Browser in the background: %d",
    "Не вышло: %s": "Failed: %s",
    "Asset Browser: +%d, убрано %d, без изменений %d%s": "Asset Browser: +%d, removed %d, unchanged %d%s",
    " · не открылись: %d": " · did not open: %d",
    "Масштаб не применён (%.2f, %.2f, %.2f)": "Scale not applied (%.2f, %.2f, %.2f)",
    "Отрицательный масштаб — нормали вывернутся при применении": "Negative scale — normals flip when it is applied",
    "Огромная модель: %.0f м — проверьте единицы (сантиметры вместо метров?)": "Huge model: %.0f m — check the units (centimetres instead of metres?)",
    "Крошечная модель: %.1f мм — проверьте единицы": "Tiny model: %.1f mm — check the units",
    "Неманифолдные рёбра: %d (больше двух граней на ребре)": "Non-manifold edges: %d (more than two faces on an edge)",
    "Открытые края: %d рёбер — дырки, если модель должна быть замкнутой": "Open borders: %d edges — holes, if the model should be closed",
    "Висящие вершины: %d": "Loose vertices: %d",
    "Грани нулевой площади: %d": "Zero-area faces: %d",
    "N-гоны: %d (больше 4 вершин) — могут криво сгладиться и триангулироваться": "N-gons: %d (more than 4 vertices) — may shade and triangulate badly",
    "Нормали смотрят в разные стороны на %d рёбрах": "Normals point different ways on %d edges",
    "Вершины друг на друге: %d — стоит «Merge by Distance»": "Overlapping vertices: %d — worth a «Merge by Distance»",
    "Нет UV-развёртки — текстуры лягут криво": "No UV map — textures will lie badly",
    "UV за пределами квадрата 0–1 у %d граней": "UVs outside the 0–1 square on %d faces",
    "Не применены модификаторы: %s": "Modifiers not applied: %s",
    "Тяжёлая: %s треугольников": "Heavy: %s triangles",
    "Много материалов: %d": "Many materials: %d",
    "Пустые слоты материалов: %d": "Empty material slots: %d",
    "Всё в порядке": "All good",
    "Проверить модель": "Check the model",
    "Масштаб, единицы, дырки, неманифолд, вывернутые нормали, дубли вершин, n-гоны, UV, модификаторы — у выделенных объектов": "Scale, units, holes, non-manifold, flipped normals, duplicate vertices, n-gons, UVs, modifiers — of the selected objects",
    "Выделите меш-объекты": "Select mesh objects",
    "Проверка: замечаний %d": "Check: %d remarks",
    "Проверка: всё в порядке": "Check: all good",
    "Исправить, что можно": "Fix what can be fixed",
    "Применить масштаб и поворот, склеить вершины друг на друге, убрать висящие вершины и грани нулевой площади, развернуть нормали наружу. Дырки, n-гоны и UV не трогаются. Ctrl+Z вернёт как было": "Apply scale and rotation, merge overlapping vertices, remove loose vertices and zero-area faces, turn normals outside. Holes, n-gons and UVs are not touched. Ctrl+Z brings it back",
    "Исправлено объектов: %d%s": "Objects fixed: %d%s",
    " · пропущены общие меши: %d": " · shared meshes skipped: %d",
    "Умная UV-развёртка": "Smart UV unwrap",
    "Швы по форме (острые и Sharp-рёбра, разрезы трубок и замкнутых частей, у выдавленных форм — лицо, тыл и стенка); растянутый остров сначала надрезается, а не делится; полосы выпрямляются в ленты, длинные режутся на куски, чтобы квадрат заполнялся плотно. Из трёх раскладок остаётся лучшая. Старые швы заменяются, Ctrl+Z вернёт": "Seams by shape (sharp and Sharp-marked edges, cuts of tubes and closed parts, front / back / wall for extruded shapes); a stretched island gets a slit before it is split; strips are straightened into ribbons, long ones cut into pieces so the square fills densely. The best of three layouts stays. Old seams are replaced, Ctrl+Z brings them back",
    " · как выдавленная форма: %d": " · as an extruded shape: %d",
    " · на островах Smart UV Project: %d": " · on Smart UV Project islands: %d",
    "Шов от угла": "Seam from angle",
    "Отступ островов": "Island margin",
    "Развёрнуто объектов: %d%s": "Objects unwrapped: %d%s",
    " · у %d лучше вышел Smart UV Project — оставлен он": " · for %d Smart UV Project came out better — it was kept",
    " · островов поделено: %d": " · islands split: %d",
    "Пресетов пока нет": "No presets yet",
    "Сохранить свет и рендер как пресет": "Save light and render as a preset",
    "Свет сцены, мир, цветокоррекция и настройки рендера — в пресет библиотеки (в общей папке — для всей команды)": "The scene's lights, world, colour management and render settings to a library preset (in a shared folder — for the whole team)",
    "Название": "Name",
    "Пресет": "Preset",
    "Пресет «%s» сохранён": "Preset «%s» saved",
    "Применить пресет": "Apply the preset",
    "Поставить свет пресета (в коллекцию «Свет · Oddments») и его мир и настройки рендера": "Put the preset's lights (into the collection «Свет · Oddments») and its world and render settings",
    "Сначала сохраните пресет": "Save a preset first",
    "Пресет «%s»": "Preset «%s»",
    "Нужен токен из Oddments": "A token from Oddments is needed",
    "Вставить токен…": "Paste the token…",
    "Закрыть браузер": "Close the browser",
    "Заменить на выделенное в Oddments": "Swap for the selection in Oddments",
    "Все материалы сцены в библиотеку": "All scene materials to the library",
    "Синхронизация…": "Syncing…",
    "Модели → Asset Browser": "Models → Asset Browser",
    "Свет и рендер команды:": "Team light and render:",
    "Модель:": "Model:",
    "Для приложения Oddments (с переделкой):": "For the Oddments app (converted):",
    "Запекать процедурные": "Bake procedural",
    "Пресет света": "Light preset",
    "Язык аддона": "Add-on language",
    "Как в Blender": "As in Blender",
    "Язык аддона · Add-on language": "Add-on language",
    "Сплаты Blender открывает с версии 5.3 — у вас %s. Обновите Blender или откройте сплат аддоном KIRI 3DGS Render.": "Blender opens splats from version 5.3 — you have %s. Update Blender or open the splat with the KIRI 3DGS Render add-on.",
    "Этот Blender не умеет открывать SPZ — отправьте сплат из Oddments ещё раз (он придёт как PLY).": "This Blender cannot open SPZ — send the splat from Oddments again (it comes as PLY).",
    "Oddments: сплат не открылся": "Oddments: the splat did not open",
    "Сплат в Oddments (Cycles)": "Splat to Oddments (Cycles)",
    "Выделенное — в гауссов сплат с качеством Cycles: 64 рендера со всех сторон с материалами и светом сцены, Oddments раскладывает их цвет по поверхности. Несколько минут; Esc — остановить": "The selection as a Gaussian splat in Cycles quality: 64 renders from all sides with the scene's materials and light, Oddments lays their colour over the surface. A few minutes; Esc stops it",
    "Ракурсов": "Views", "Размер рендера": "Render size", "Сэмплов": "Samples",
    "Сплат остановлен": "The splat was stopped",
    "Oddments: сплат (Cycles) · ракурс %d из %d · Esc — остановить": "Oddments: splat (Cycles) · view %d of %d · Esc to stop",
    "Сплат «%s» собирается в Oddments": "The splat «%s» is being built in Oddments",
    "СПЛАТ (CYCLES)": "SPLAT (CYCLES)",
}


def _t(s):
    return EN.get(s, s) if _EN_ON else s


def _apply_lang():
    global _EN_ON
    tr = bpy.app.translations
    try:
        choice = _prefs().lang
    except Exception:
        choice = "AUTO"
    on = choice == "EN" or (choice == "AUTO" and not tr.locale.startswith("ru"))
    try:
        tr.unregister(ADDON)
    except Exception:
        pass
    if on:
        table = {}
        for k, v in EN.items():
            table[("*", k)] = v
            table[("Operator", k)] = v
        tr.register(ADDON, {loc: table for loc in set(tr.locales) | {tr.locale, "en_US"}})
    _EN_ON = on
    for win in getattr(bpy.context.window_manager, "windows", []):
        for area in win.screen.areas:
            area.tag_redraw()


TOKEN_HINT = "Oddments › Настройки › Интеграции › «Скопировать токен», затем Edit › Preferences › Add-ons › Oddments"


def _no_token(op):
    """True (and a clear message) when the token is not set yet: nothing is sent then."""
    if _prefs().token.strip():
        return False
    op.report({"ERROR"}, _t("Сначала вставьте токен: ") + _t(TOKEN_HINT))
    return True


def _explain(op, err):
    reason = getattr(err, "reason", None)
    if isinstance(err, OfflineError):
        op.report({"ERROR"}, _t(OFFLINE_HINT))
    elif isinstance(err, urllib.error.HTTPError) and err.code == 401:
        op.report({"ERROR"}, _t("Oddments не принял токен — скопируйте его заново: ") + _t(TOKEN_HINT))
    elif isinstance(err, urllib.error.HTTPError) and err.code == 413:
        op.report({"ERROR"}, _t("Файл больше 1 ГБ — Oddments такие не принимает"))
    elif isinstance(err, (ConnectionAbortedError, ConnectionResetError)) or isinstance(reason, (ConnectionAbortedError, ConnectionResetError)):
        # older Oddments closed the connection on a wrong token before reading the file
        op.report({"ERROR"}, _t("Oddments оборвал соединение — скорее всего, не подошёл токен: ") + _t(TOKEN_HINT))
    elif isinstance(err, urllib.error.URLError) or isinstance(err, ConnectionRefusedError):
        op.report({"ERROR"}, _t("Oddments не отвечает: откройте приложение Oddments (порт %d)") % _prefs().port)
    else:
        op.report({"ERROR"}, _t("Не получилось: %s") % err)


class PERCH_Prefs(bpy.types.AddonPreferences):
    bl_idname = ADDON
    lang: bpy.props.EnumProperty(name="Язык аддона · Add-on language", default="AUTO",
                                 items=[("AUTO", "Как в Blender", ""), ("RU", "Русский", ""), ("EN", "English", "")],
                                 update=lambda self, ctx: _apply_lang())
    token: bpy.props.StringProperty(name="Токен", description="Из Oddments › Настройки › Интеграции", subtype="PASSWORD")
    port: bpy.props.IntProperty(name="Порт", default=47215, min=1024, max=65535)
    receive: bpy.props.BoolProperty(name="Принимать из Oddments", default=True,
                                    description="Файлы, отправленные кнопкой «В Blender» в Oddments, сразу появляются в сцене")
    bake: bpy.props.BoolProperty(name="Запекать процедурные материалы", default=True,
                                 description="Перед отправкой запечь в текстуры материалы из нод (шум, рампы, группы, Mix Shader): "
                                             "glTF и Oddments переносят только картинки и числа. Ваш .blend не меняется")
    bake_size: bpy.props.EnumProperty(name="Размер текстур", default="1024",
                                      items=[("512", "512", ""), ("1024", "1024", ""), ("2048", "2048", "")])
    mat_dir: bpy.props.StringProperty(name="Библиотека материалов и моделей", subtype="DIR_PATH", default="",
                                      description="Папка, где аддон хранит материалы, модели и пресеты света (пусто — Документы/Oddments Library/Blender Materials). "
                                                  "Общая папка команды (сетевой диск, OneDrive) — и у всех 3D-дизайнеров одна библиотека в Asset Browser")
    swap_fit: bpy.props.BoolProperty(name="Подогнать размер при замене", default=False,
                                     description="Вписать новую модель в габариты заменяемого объекта")
    swap_materials: bpy.props.BoolProperty(name="Материалы старого при замене", default=False,
                                           description="Надеть на новую модель материалы заменяемого объекта")
    icon_style: bpy.props.StringProperty(name="Стиль набора иконок", default="", options={"HIDDEN"})
    import_smooth: bpy.props.EnumProperty(
        name="Сглаживание моделей при вставке", default="ANGLE",
        items=[("ANGLE", "По углу", "Shade Smooth by Angle прямо в меше: гладко, рёбра острее угла — острые. Без модификатора: "
                                    "так же в экспорте и любом рендере"),
               ("MODIFIER", "Модификатор Auto Smooth", "Shade Auto Smooth: модификатор «Smooth by Angle», угол можно менять потом"),
               ("NONE", "Не трогать", "Как пришло из файла")],
        description="Модели без своих нормалей (STL, OBJ из «SVG в 3D», PLY…) становятся гладкими. Нормали, записанные в файле "
                    "(GLB, FBX, OBJ с нормалями), не трогаются — это сглаживание автора")
    import_smooth_angle: bpy.props.FloatProperty(name="Угол", default=math.radians(30), min=0.0, max=math.pi, subtype="ANGLE",
                                                 description="Рёбра острее этого угла остаются острыми")

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "lang")
        col.prop(self, "token")
        col.prop(self, "port")
        col.prop(self, "receive")
        row = col.row()
        row.prop(self, "bake")
        sub = row.row()
        sub.enabled = self.bake
        sub.prop(self, "bake_size", text="")
        col.label(text=_t("Токен — в Oddments › Настройки › Интеграции, кнопка «Скопировать токен»."))
        row = col.row()
        row.prop(self, "import_smooth")
        sub = row.row()
        sub.enabled = self.import_smooth != "NONE"
        sub.prop(self, "import_smooth_angle")
        col.separator()
        col.prop(self, "mat_dir")
        col.label(text=_t("Пусто — ") + MATLIB_DEFAULT)


class PERCH_OT_send_selected(bpy.types.Operator):
    bl_idname = "perch.send_selected"
    bl_label = "Выделенное в Oddments"
    bl_description = "Сохранить выделенные объекты в GLB и отправить в библиотеку Oddments"

    @classmethod
    def poll(cls, context):
        return bool(context.selected_objects)

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        name = (context.active_object or context.selected_objects[0]).name
        tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), name + ".glb")
        objects = list(context.selected_objects)
        baked = _prefs().bake and any(_needs_bake(s.material) for o in objects for s in getattr(o, "material_slots", []) if s.material)
        cleanup, n_baked = (lambda: None), 0
        try:
            with _Keep():
                if baked:
                    # procedural materials go out as images: baked on temporary mesh copies, which are what is exported
                    n_baked = len({s.material.name for o in objects for s in getattr(o, "material_slots", []) if s.material and _needs_bake(s.material)})
                    copies, cleanup = _baked_copies(objects, int(_prefs().bake_size))
                    v = context.view_layer
                    for o in v.objects:
                        o.select_set(o in copies)
                # textures go inside the GLB (export_image_format AUTO keeps PNG/JPEG as they are); glTF can only
                # carry image maps wired to the Principled BSDF directly or through a Normal Map node
                # only options this Blender's exporter knows: a renamed one would make the whole export fail
                known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
                opts = dict(export_format="GLB", use_selection=True, export_apply=True, export_cameras=False,
                            export_lights=False, export_materials="EXPORT", export_image_format="AUTO", export_texcoords=True)
                bpy.ops.export_scene.gltf(filepath=tmp, **{k: v for k, v in opts.items() if k in known})
                missing = [] if baked else _unexportable_maps(objects)
                if missing:
                    self.report({"WARNING"}, _t("Текстуры через узлы, которые glTF не переносит (%s): в Oddments придёт без них. "
                                "Подключите Image Texture прямо к Principled BSDF или запеките карты.") % ", ".join(missing[:3]))
                _send(tmp, name + ".glb")
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        finally:
            cleanup()
        self.report({"INFO"}, _t("Отправлено в Oddments: %s%s") % (name, _t(" (запечено материалов: %d)") % n_baked if n_baked else ""))
        return {"FINISHED"}


class PERCH_OT_send_file(bpy.types.Operator):
    bl_idname = "perch.send_file"
    bl_label = "Файл .blend в Oddments"
    bl_description = "Отправить копию текущего файла .blend (оригинал не меняется)"

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        base = bpy.path.basename(bpy.data.filepath) or "scene.blend"
        tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), base)
        try:
            bpy.ops.wm.save_as_mainfile(filepath=tmp, copy=True, compress=False)
            _send(tmp, base)
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        self.report({"INFO"}, _t("Отправлено в Oddments: %s") % base)
        return {"FINISHED"}


class PERCH_OT_send_snapshot(bpy.types.Operator):
    bl_idname = "perch.send_snapshot"
    bl_label = "Снимок вьюпорта в Oddments"
    bl_description = "Отрисовать текущий вид вьюпорта и отправить картинкой"

    @classmethod
    def poll(cls, context):
        return context.area is not None and context.area.type == "VIEW_3D" and not bpy.app.background

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        name = (bpy.path.display_name_from_filepath(bpy.data.filepath) or "Blender") + _t(" — снимок.png")
        tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), "snapshot.png")
        try:
            bpy.ops.render.opengl(view_context=True)
            img = bpy.data.images["Render Result"]
            img.save_render(tmp)
            _send(tmp, name)
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        self.report({"INFO"}, _t("Снимок отправлен в Oddments"))
        return {"FINISHED"}


# ---------- materials (.perchmat: a zip with material.json + texture maps, the same format Oddments uses) ----------
def _lin2srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def _srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex(rgb):
    return "#" + "".join("%02x" % round(_lin2srgb(v) * 255) for v in rgb[:3])


def _rgb(hx):
    hx = (hx or "#ffffff").lstrip("#")
    return [_srgb2lin(int(hx[i:i + 2], 16) / 255) for i in (0, 2, 4)] + [1.0]


def _principled(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    return None


def _input(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


def _image_behind(sock, depth=0, seen=None):
    """The Image Texture node feeding a socket, looking through whatever sits in between: Reroute, Mix,
    ColorRamp, Hue/Saturation, Invert, Gamma, Separate Color, Math, node groups… Every linked input is
    followed (not only ones with known names: Mix in Blender 4+ has several «A» sockets, Reroute has «Input»),
    nearest first, so a colour map wins over, say, an AO map mixed into it further back."""
    if sock is None or not sock.is_linked or depth > 8:
        return None
    seen = seen if seen is not None else set()
    n = sock.links[0].from_node
    if n.as_pointer() in seen:
        return None
    seen.add(n.as_pointer())
    if n.type == "TEX_IMAGE" and n.image:
        return n
    if n.type == "GROUP" and n.node_tree:
        # inside a group: the group output socket this link comes from, then on through the group's own nodes
        out = next((g for g in n.node_tree.nodes if g.type == "GROUP_OUTPUT" and g.is_active_output), None)
        name = sock.links[0].from_socket.name
        if out and name in out.inputs:
            r = _image_behind(out.inputs[name], depth + 1, seen)
            if r:
                return r
    linked = [s for s in n.inputs if s.is_linked and s.enabled]
    # colour-like sockets first (Color, A/B of a mix, Input of a reroute), the factor last
    linked.sort(key=lambda s: (s.name in ("Fac", "Factor"), s.type != "RGBA"))
    for s in linked:
        r = _image_behind(s, depth + 1, seen)
        if r:
            return r
    return None


def _unexportable_maps(objects):
    """Materials whose image maps reach the Principled BSDF only through nodes glTF cannot express (Mix,
    ColorRamp, groups…): the GLB will lack those maps, so the add-on says so instead of failing silently."""
    names = []
    for ob in objects:
        for slot in getattr(ob, "material_slots", []):
            bsdf = _principled(slot.material)
            if not bsdf or slot.material.name in names:
                continue
            for sock in bsdf.inputs:
                if not sock.is_linked:
                    continue
                n = sock.links[0].from_node
                direct = n.type == "TEX_IMAGE" or (n.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB") and any(
                    s.is_linked and s.links[0].from_node.type == "TEX_IMAGE" for s in n.inputs))
                if not direct and _image_behind(sock):
                    names.append(slot.material.name)
                    break
    return names


# ---------- baking procedural materials (glTF and .perchmat carry images and numbers, not node setups) ----------
def _active_output(mat):
    nt = mat.node_tree
    return next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or \
        next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)


def _direct_image(sock):
    """An Image Texture wired straight in (or through Separate Color, as packed ORM maps are): glTF keeps it."""
    if sock is None or not sock.is_linked:
        return False
    n = sock.links[0].from_node
    if n.type == "TEX_IMAGE" and n.image:
        return True
    return n.type in ("SEPARATE_COLOR", "SEPRGB") and any(
        s.is_linked and s.links[0].from_node.type == "TEX_IMAGE" for s in n.inputs)


def _find_principled(mat, copy_groups=None):
    """The Principled BSDF that gives a material its look, followed from the material output through Reroute,
    Mix / Add Shader (the heavier side first) and node groups. Returns (hops, tree, exit, principled) or None:
    `exit` is the socket in `tree` that carries the shader out (the material output's Surface, or a group
    output's socket), `hops` lists the outer levels as (tree, exit, group node output) from the top down.
    With copy_groups (a list), every group on the way is replaced by a copy first, so the user's own node
    groups are never touched by the bake; the copies are appended to the list."""
    out = _active_output(mat)
    if not out or not out.inputs["Surface"].is_linked:
        return None
    hops, tree, exit_ = [], mat.node_tree, out.inputs["Surface"]
    src = exit_.links[0].from_socket
    for _ in range(32):
        n = src.node
        if n.type == "BSDF_PRINCIPLED":
            return hops, tree, exit_, n
        if n.type == "REROUTE":
            if not n.inputs[0].is_linked:
                return None
            src = n.inputs[0].links[0].from_socket
            continue
        if n.type in ("MIX_SHADER", "ADD_SHADER"):
            shaders = [i for i in n.inputs if i.type == "SHADER" and i.is_linked]
            if n.type == "MIX_SHADER" and len(shaders) == 2 and not n.inputs[0].is_linked and n.inputs[0].default_value > 0.5:
                shaders.reverse()  # the factor leans to the second shader: that one first
            nxt = next((i for i in shaders if _has_principled(i.links[0].from_socket)), None)
            if nxt is None:
                return None
            src = nxt.links[0].from_socket
            continue
        if n.type == "GROUP" and n.node_tree:
            if copy_groups is not None:
                n.node_tree = n.node_tree.copy()
                copy_groups.append(n.node_tree)
            gout = next((g for g in n.node_tree.nodes if g.type == "GROUP_OUTPUT" and g.is_active_output), None) or                 next((g for g in n.node_tree.nodes if g.type == "GROUP_OUTPUT"), None)
            inner = next((i for i in gout.inputs if i.identifier == src.identifier), None) if gout else None
            if inner is None or not inner.is_linked:
                return None
            hops.append((tree, exit_, src))
            tree, exit_, src = n.node_tree, inner, inner.links[0].from_socket
            continue
        return None
    return None


def _has_principled(sock, depth=0):
    n = sock.node
    if n.type == "BSDF_PRINCIPLED":
        return True
    if depth > 16:
        return False
    if n.type == "GROUP" and n.node_tree:
        return any(g.type == "BSDF_PRINCIPLED" for g in n.node_tree.nodes)
    return any(i.is_linked and _has_principled(i.links[0].from_socket, depth + 1) for i in n.inputs if i.type == "SHADER" or n.type == "REROUTE")


def _needs_bake(mat):
    """True when what the material looks like does not survive as images + numbers: no Principled BSDF at the
    surface (Glossy, Toon…), a Principled behind a Mix Shader or inside a node group, or Principled inputs fed
    by procedural nodes (noise, Color Ramp…)."""
    if not mat or not mat.use_nodes:
        return False
    out = _active_output(mat)
    if not out or not out.inputs["Surface"].is_linked:
        return False
    found = _find_principled(mat)
    if found is None:
        return True
    hops, tree, exit_, sh = found
    if hops or exit_.links[0].from_node is not sh:
        return True
    for name in ("Base Color", "Roughness", "Metallic", "Normal", "Emission Color", "Alpha"):
        s = _input(sh, name)
        if s is None or not s.is_linked:
            continue
        n = s.links[0].from_node
        if name == "Normal":
            if n.type == "NORMAL_MAP" and _direct_image(n.inputs["Color"]):
                continue
            return True
        if not _direct_image(s):
            return True
    return False


class _BakeScene:
    """Cycles settings for a quick bake, put back afterwards (engine, samples, device stay the user's own)."""
    def __init__(self, scene):
        self.scene = scene
        c = scene.cycles
        self.saved = (scene.render.engine, c.samples, scene.render.bake.margin, getattr(c, "use_denoising", None))

    def __enter__(self):
        s = self.scene
        s.render.engine = "CYCLES"
        s.cycles.samples = 4  # colour, value and normal passes are not noisy
        if hasattr(s.cycles, "use_denoising"):
            s.cycles.use_denoising = False
        s.render.bake.margin = 8
        return self

    def __exit__(self, *a):
        s, (eng, smp, mar, den) = self.scene, self.saved
        s.render.engine, s.cycles.samples, s.render.bake.margin = eng, smp, mar
        if den is not None:
            s.cycles.use_denoising = den


def _bake_pass(mats, name, size, btype, plan=None, color=False):
    """Bake one pass for every material of the active object at once (Blender bakes all of an object's
    materials together, each into its active Image Texture node).
    plan[mat] = (found, socket): `found` is the material's route to its Principled (_find_principled), `socket`
    what to bake for EMIT (a colour or value, as light) or NORMAL (a normal, through a plain Diffuse BSDF: Cycles
    bakes the diffuse normal and a pure metal has none). The temporary shader sits in the Principled's own tree
    and is wired out through every group output to the material output; every link it replaces is put back
    after the pass. Without a plan entry an EMIT pass catches black (a throwaway image) and DIFFUSE / NORMAL bake
    the surface as it is. Returns {material: image}."""
    plan = plan or {}
    images, undo = {}, []

    def relink(tree, from_s, to_s):
        prev = to_s.links[0].from_socket if to_s.is_linked else None
        tree.links.new(from_s, to_s)
        undo.append(("link", tree, to_s, prev))

    for m in mats:
        nt = m.node_tree
        img = bpy.data.images.new("%s_%s" % (m.name, name), size, size, alpha=False, float_buffer=False)
        img["perch_baked"] = 1  # ours: saved directly when packed (a copy of an unsaved image loses its pixels)
        if not color:
            img.colorspace_settings.name = "Non-Color"
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        undo.append(("node", nt, node))
        images[m] = img
        if btype not in ("EMIT", "NORMAL"):
            continue
        found, src = plan.get(m, (None, None))
        if btype == "NORMAL" and src is None:
            continue
        if found:
            hops, tree, exit_ = found[0], found[1], found[2]
        else:
            out = _active_output(m)
            if not out:
                continue
            hops, tree, exit_ = [], nt, out.inputs["Surface"]
        if btype == "EMIT":
            sh = tree.nodes.new("ShaderNodeEmission")
            if src is not None:
                tree.links.new(src, sh.inputs["Color"])
        else:
            sh = tree.nodes.new("ShaderNodeBsdfDiffuse")
            tree.links.new(src, sh.inputs["Normal"])
        undo.append(("node", tree, sh))
        relink(tree, sh.outputs[0], exit_)
        for otree, oexit, gsock in reversed(hops):
            relink(otree, gsock, oexit)
    kw = dict(type=btype, margin=8)
    if btype == "DIFFUSE":
        kw["pass_filter"] = {"COLOR"}
    try:
        bpy.ops.object.bake(**kw)
    finally:
        for u in reversed(undo):
            if u[0] == "link":
                _, tree, to_s, prev = u
                if prev is not None:
                    tree.links.new(prev, to_s)
                else:
                    for l in list(to_s.links):
                        tree.links.remove(l)
            else:
                u[1].nodes.remove(u[2])
    return images


def _clean_material(name, maps, consts):
    """A plain Principled BSDF from baked images (or constant values where nothing was linked)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    def tex(img, x):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image, t.location = img, (x, 0)
        return t
    if "baseColor" in maps:
        nt.links.new(tex(maps["baseColor"], -500).outputs["Color"], bsdf.inputs["Base Color"])
    elif "baseColor" in consts:
        bsdf.inputs["Base Color"].default_value = consts["baseColor"]
    for slot, inp in (("roughness", "Roughness"), ("metalness", "Metallic")):
        if slot in maps:
            nt.links.new(tex(maps[slot], -500).outputs["Color"], bsdf.inputs[inp])
        elif slot in consts:
            bsdf.inputs[inp].default_value = consts[slot]
    nm = None
    if "normal" in maps:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex(maps["normal"], -700).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if "height" in maps:
        bump = nt.nodes.new("ShaderNodeBump")
        bump.invert = consts.get("bumpInvert", False)
        bump.inputs["Strength"].default_value = consts.get("bumpStrength", 1.0)
        bump.inputs["Distance"].default_value = consts.get("bumpDistance", 1.0)
        nt.links.new(tex(maps["height"], -900).outputs["Color"], bump.inputs["Height"])
        if nm is not None:
            nt.links.new(nm.outputs["Normal"], bump.inputs["Normal"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def _bake_object_materials(ob, size):
    """Bake every material of `ob` that needs it; swap the baked ones for clean Principled materials on `ob`.
    Returns the temporary datablocks to remove later."""
    made = {"materials": [], "images": [], "node_groups": []}
    mats = [s.material for s in ob.material_slots if s.material]
    todo = [m for m in mats if _needs_bake(m)]
    if not todo:
        return made
    # bake on copies of the materials (and of the node groups on the way): the user's own trees are untouched
    copies = {}
    for s in ob.material_slots:
        if s.material and s.material not in copies:
            copies[s.material] = s.material.copy()
            made["materials"].append(copies[s.material])
        if s.material:
            s.material = copies[s.material]
    cm = list(copies.values())
    found = {m: _find_principled(m, copy_groups=made["node_groups"]) for m in cm}

    def linked(m, name):
        f = found[m]
        sk = _input(f[3], name) if f else None
        return sk.links[0].from_socket if sk is not None and sk.is_linked else None

    def plan(name):
        return {m: (found[m], linked(m, name)) for m in cm if found[m]}

    def bump_of(m):
        f = found[m]
        sk = _input(f[3], "Normal") if f else None
        n = sk.links[0].from_node if sk is not None and sk.is_linked else None
        return n if n is not None and n.type == "BUMP" else None

    def normal_src(m):
        # with a Bump on top, the normal map is what feeds the Bump's own Normal (the relief goes as height)
        b = bump_of(m)
        if b is not None:
            sk = b.inputs["Normal"]
            return sk.links[0].from_socket if sk.is_linked else None
        return linked(m, "Normal")

    plain = [m for m in cm if found[m] is None]  # Glossy, Toon, Diffuse…: no Principled anywhere
    want = {orig: copies[orig] for orig in todo}
    passes = {}

    def keep_all(imgs):
        made["images"].extend(imgs.values())
        return imgs

    # colour: what feeds the Principled's Base Color (a Color Ramp, noise, an input of a group…), as emission —
    # right for metals too; the diffuse colour of a surface without a Principled
    if any(linked(m, "Base Color") for m in want.values() if found[m]):
        passes["baseColor"] = keep_all(_bake_pass(cm, "baseColor", size, "EMIT", plan("Base Color"), color=True))
    if any(m in plain for m in want.values()):
        d = keep_all(_bake_pass(cm, "diffuse", size, "DIFFUSE", color=True))
        passes.setdefault("baseColor", {}).update({m: d[m] for m in plain})
    for slot, name in (("roughness", "Roughness"), ("metalness", "Metallic")):
        if any(linked(m, name) for m in want.values() if found[m]):
            passes[slot] = keep_all(_bake_pass(cm, slot, size, "EMIT", plan(name)))
    if any(bump_of(m) is not None and bump_of(m).inputs["Height"].is_linked for m in want.values()):
        hp = {m: (found[m], bump_of(m).inputs["Height"].links[0].from_socket) for m in cm
              if bump_of(m) is not None and bump_of(m).inputs["Height"].is_linked}
        passes["height"] = keep_all(_bake_pass(cm, "height", size, "EMIT", hp))
    if any(m in plain or normal_src(m) for m in want.values()):
        passes["normal"] = keep_all(_bake_pass(cm, "normal", size, "NORMAL",
                                               {m: (found[m], normal_src(m)) for m in cm if found[m]}))

    # the clean materials take the copies' places; what was not linked keeps its number
    for orig, cp in want.items():
        f = found[cp]
        p = f[3] if f else None
        maps, consts = {}, {}
        for slot, name in (("baseColor", "Base Color"), ("roughness", "Roughness"), ("metalness", "Metallic")):
            if slot in passes and cp in passes[slot] and (linked(cp, name) or (p is None and slot == "baseColor")):
                maps[slot] = passes[slot][cp]
            elif p is not None:
                sk = _input(p, name)
                consts[slot] = tuple(sk.default_value) if slot == "baseColor" else float(sk.default_value)
        if "normal" in passes and (p is None or normal_src(cp)):
            maps["normal"] = passes["normal"][cp]
        b = bump_of(cp)
        if b is not None and "height" in passes and cp in passes["height"] and b.inputs["Height"].is_linked:
            maps["height"] = passes["height"][cp]
            consts["bumpStrength"] = float(b.inputs["Strength"].default_value)
            consts["bumpDistance"] = float(b.inputs["Distance"].default_value)
            consts["bumpInvert"] = bool(getattr(b, "invert", False))
        # the baked material goes out under the original's name (not «name.001»): the original steps aside
        # under a temporary name until the cleanup puts it back
        real = orig.get("_perch_real") or orig.name
        if not orig.get("_perch_real"):
            orig["_perch_real"] = real
            orig.name = real + " ·perch"
            made.setdefault("renamed", []).append(orig)
        clean = _clean_material(real, maps, consts)
        made["materials"].append(clean)
        for sl in ob.material_slots:
            if sl.material is cp:
                sl.material = clean
    return made


def _ensure_uv(ob):
    if ob.data.uv_layers:
        return
    ob.data.uv_layers.new(name="UVMap")
    view = bpy.context.view_layer
    view.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def _baked_copies(objects, size):
    """Mesh copies of `objects` (curves, text and modifiers evaluated) with procedural materials baked.
    Returns (copies, cleanup)."""
    scene, view = bpy.context.scene, bpy.context.view_layer
    dg = bpy.context.evaluated_depsgraph_get()
    copies, made = [], {"materials": [], "images": [], "meshes": []}
    for ob in objects:
        if ob.type not in ("MESH", "CURVE", "SURFACE", "FONT", "META"):
            continue
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        made["meshes"].append(me)
        cp = bpy.data.objects.new(ob.name, me)
        cp.matrix_world = ob.matrix_world.copy()
        scene.collection.objects.link(cp)
        copies.append(cp)
    view.update()  # the copies are in view.objects (and selectable) only after an update
    for o in view.objects:
        o.select_set(False)
    with _BakeScene(scene):
        for cp in copies:
            if any(_needs_bake(s.material) for s in cp.material_slots if s.material):
                _ensure_uv(cp)
                for o in view.objects:
                    o.select_set(False)
                cp.select_set(True)
                view.objects.active = cp
                got = _bake_object_materials(cp, size)
                made["materials"] += got["materials"]
                made["images"] += got["images"]
                made.setdefault("node_groups", []).extend(got.get("node_groups", []))
                made.setdefault("renamed", []).extend(got.get("renamed", []))
    return copies, lambda: _drop(made, copies)


def _baked_material(mat, size):
    """A lone material baked on a temporary plane: (clean material, cleanup)."""
    scene, view = bpy.context.scene, bpy.context.view_layer
    me = bpy.data.meshes.new("perch_bake_plane")
    me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    me.materials.append(mat)
    ob = bpy.data.objects.new("perch_bake_plane", me)
    scene.collection.objects.link(ob)
    view.update()  # a freshly linked object is in view.objects (and selectable) only after an update
    for o in view.objects:
        o.select_set(False)
    ob.select_set(True)
    view.objects.active = ob
    with _BakeScene(scene):
        made = _bake_object_materials(ob, size)
    clean = ob.material_slots[0].material
    made["meshes"] = [me]
    return clean, lambda: _drop(made, [ob])


def _drop(made, extra=()):
    """Remove temporary datablocks in a safe order (objects, meshes, materials, images), each once."""
    for o in extra:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    for kind, coll in (("meshes", bpy.data.meshes), ("materials", bpy.data.materials), ("node_groups", bpy.data.node_groups),
                       ("images", bpy.data.images)):
        for d in {id(x): x for x in made.get(kind, [])}.values():
            try:
                if d.users == 0:
                    coll.remove(d)
            except ReferenceError:
                pass
    for orig in {id(x): x for x in made.get("renamed", [])}.values():  # the originals get their names back
        try:
            orig.name = orig["_perch_real"]
            del orig["_perch_real"]
        except (ReferenceError, KeyError):
            pass


class _Keep:
    """Selection, active object and mode, restored after the add-on's own work in the scene."""
    def __enter__(self):
        v = bpy.context.view_layer
        self.active = v.objects.active
        self.sel = [o for o in v.objects if o.select_get()]
        self.mode = bpy.context.mode
        if self.mode != "OBJECT" and self.active:
            bpy.ops.object.mode_set(mode="OBJECT")
        return self

    def __exit__(self, *a):
        v = bpy.context.view_layer
        for o in v.objects:
            try:
                o.select_set(o in self.sel)
            except ReferenceError:
                pass
        if self.active and self.active.name in v.objects:
            v.objects.active = self.active
            if self.mode == "EDIT_MESH":
                bpy.ops.object.mode_set(mode="EDIT")


def _uv_scale(tex):
    v = tex.inputs.get("Vector") if tex else None
    if v and v.is_linked and v.links[0].from_node.type == "MAPPING":
        sc = v.links[0].from_node.inputs.get("Scale")
        if sc is not None:
            return round(float(sc.default_value[0]), 4)
    return 1.0


def _image_bytes(img, tmpdir):
    """(bytes, extension) of an image: packed data, the file on disk, or a PNG copy saved to a temp folder."""
    if img.packed_file:
        ext = {"JPEG": "jpg", "OPEN_EXR": "exr", "TARGA": "tga", "TIFF": "tif"}.get(img.file_format, img.file_format.lower())
        return bytes(img.packed_file.data), ext
    path = bpy.path.abspath(img.filepath) if img.filepath else ""
    if path and os.path.isfile(path):
        with open(path, "rb") as f:
            return f.read(), os.path.splitext(path)[1].lstrip(".").lower() or "png"
    tmp = os.path.join(tmpdir, "img_%d.png" % len(os.listdir(tmpdir)))
    if img.get("perch_baked"):  # a temporary bake of ours: save it as it is
        img.filepath_raw = tmp
        img.file_format = "PNG"
        img.save()
        with open(tmp, "rb") as f:
            return f.read(), "png"
    cp = img.copy()  # never touch the user's own image datablock
    try:
        cp.filepath_raw = tmp
        cp.file_format = "PNG"
        cp.save()
    finally:
        bpy.data.images.remove(cp)
    with open(tmp, "rb") as f:
        return f.read(), "png"


def material_to_perchmat(mat, out_path):
    """Write a Blender material (Principled BSDF) as .perchmat. Returns the number of texture maps saved."""
    bsdf = _principled(mat)
    j = {"perch": 1, "name": mat.name, "color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "normalScale": 1.0,
         "uvScale": 1.0, "emissive": "#000000", "emissiveStrength": 1.0, "opacity": 1.0, "heightScale": 0.0,
         "normalDX": False, "maps": {}}
    files = {}
    tmpdir = tempfile.mkdtemp(prefix="perch-mat-")
    try:
        if bsdf is None:  # no node tree: the viewport colour is all there is
            j["color"] = _hex(mat.diffuse_color)
            j["roughness"] = float(mat.roughness)
            j["metalness"] = float(mat.metallic)
        else:
            def grab(slot, sock):
                tex = _image_behind(sock)
                if not tex:
                    return None
                data, ext = _image_bytes(tex.image, tmpdir)
                name = "%s.%s" % (slot, ext)
                files[name] = data
                j["maps"][slot] = name
                j["uvScale"] = _uv_scale(tex) if j["uvScale"] == 1.0 else j["uvScale"]
                return tex

            base = _input(bsdf, "Base Color")
            if not grab("baseColor", base):
                j["color"] = _hex(base.default_value)
            rough = _input(bsdf, "Roughness")
            if grab("roughness", rough):
                j["roughness"] = 1.0
            else:
                j["roughness"] = round(float(rough.default_value), 4)
            metal = _input(bsdf, "Metallic")
            if grab("metalness", metal):
                j["metalness"] = 1.0
            else:
                j["metalness"] = round(float(metal.default_value), 4)
            nrm = _input(bsdf, "Normal")
            if nrm is not None and nrm.is_linked:
                nm = nrm.links[0].from_node
                if nm.type == "BUMP":
                    # relief: the height map with the Bump's own strength and distance (Oddments shows it as bump,
                    # «Применить материал из Oddments» builds the same Bump node again)
                    k = -1.0 if getattr(nm, "invert", False) else 1.0
                    j["bumpStrength"] = round(k * float(nm.inputs["Strength"].default_value), 4)
                    j["bumpDistance"] = round(float(nm.inputs["Distance"].default_value), 4)
                    grab("height", nm.inputs["Height"])
                    inner = nm.inputs["Normal"]
                    nm = inner.links[0].from_node if inner.is_linked else None
                if nm is not None and nm.type == "NORMAL_MAP":
                    j["normalScale"] = round(float(nm.inputs["Strength"].default_value), 4)
                    grab("normal", nm.inputs["Color"])
            em = _input(bsdf, "Emission Color", "Emission")
            es = _input(bsdf, "Emission Strength")
            if es is not None:
                j["emissiveStrength"] = round(float(es.default_value), 4)
            if em is not None and not grab("emissive", em):
                j["emissive"] = _hex(em.default_value) if j["emissiveStrength"] > 0 else "#000000"
            alpha = _input(bsdf, "Alpha")
            if alpha is not None and not grab("opacity", alpha):
                j["opacity"] = round(float(alpha.default_value), 4)
            out = next((n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
            if out and out.inputs["Displacement"].is_linked:
                d = out.inputs["Displacement"].links[0].from_node
                if d.type == "DISPLACEMENT" and "height" not in j["maps"]:
                    if grab("height", d.inputs["Height"]):
                        j["heightScale"] = round(float(d.inputs["Scale"].default_value), 4) * 0.1
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
            z.writestr("material.json", json.dumps(j, ensure_ascii=False, indent=2))
            for n, d in files.items():
                z.writestr(n, d)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return len(files)


def perchmat_to_material(path):
    """Build a Principled BSDF material from a .perchmat. Images are packed into the .blend (no loose files)."""
    with zipfile.ZipFile(path) as z:
        j = json.loads(z.read("material.json").decode("utf-8"))
        maps = j.get("maps", {})
        tmpdir = tempfile.mkdtemp(prefix="perch-mat-")
        try:
            imgs = {}
            for slot, name in maps.items():
                if name not in z.namelist():
                    continue
                fp = os.path.join(tmpdir, name)
                with open(fp, "wb") as f:
                    f.write(z.read(name))
                img = bpy.data.images.load(fp)
                img.name = "%s %s" % (j.get("name", "Oddments"), slot)
                img.pack()
                if slot not in ("baseColor", "emissive"):
                    img.colorspace_settings.is_data = True
                imgs[slot] = img
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    mat = bpy.data.materials.new(j.get("name") or "Oddments")
    if not mat.node_tree:  # Blender < 5 makes node-less materials by default (use_nodes goes away in 6.0)
        mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = _principled(mat)
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    bsdf.location = (300, 300)
    out.location = (650, 300)

    coord = nodes.new("ShaderNodeTexCoord")
    coord.location = (-1050, 300)
    mapping = nodes.new("ShaderNodeMapping")
    mapping.location = (-850, 300)
    k = float(j.get("uvScale", 1.0) or 1.0)
    mapping.inputs["Scale"].default_value = (k, k, k)
    links.new(coord.outputs["UV"], mapping.inputs["Vector"])

    y = [700]

    def tex(slot):
        img = imgs.get(slot)
        if not img:
            return None
        t = nodes.new("ShaderNodeTexImage")
        t.image = img
        t.label = slot
        t.location = (-550, y[0])
        y[0] -= 300
        links.new(mapping.outputs["Vector"], t.inputs["Vector"])
        return t

    t = tex("baseColor")
    if t:
        links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = _rgb(j.get("color"))
    arm = tex("arm")
    if arm:  # glTF packing: R occlusion, G roughness, B metalness
        sep = nodes.new("ShaderNodeSeparateColor")
        sep.location = (-200, -100)
        links.new(arm.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    t = tex("roughness")
    if t:
        links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    elif not arm:
        bsdf.inputs["Roughness"].default_value = float(j.get("roughness", 0.5))
    t = tex("metalness")
    if t:
        links.new(t.outputs["Color"], bsdf.inputs["Metallic"])
    elif not arm:
        bsdf.inputs["Metallic"].default_value = float(j.get("metalness", 0.0))
    nmap = None
    t = tex("normal")
    if t:
        nm = nmap = nodes.new("ShaderNodeNormalMap")
        nm.location = (0, -350)
        nm.inputs["Strength"].default_value = float(j.get("normalScale", 1.0))
        src = t.outputs["Color"]
        if j.get("normalDX"):  # DirectX normals: green flipped for Blender (OpenGL)
            sep = nodes.new("ShaderNodeSeparateColor")
            inv = nodes.new("ShaderNodeMath")
            inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            comb = nodes.new("ShaderNodeCombineColor")
            sep.location, inv.location, comb.location = (-250, -500), (-100, -500), (50, -500)
            links.new(src, sep.inputs["Color"])
            links.new(sep.outputs["Green"], inv.inputs[1])
            links.new(sep.outputs["Red"], comb.inputs["Red"])
            links.new(inv.outputs["Value"], comb.inputs["Green"])
            links.new(sep.outputs["Blue"], comb.inputs["Blue"])
            src = comb.outputs["Color"]
        links.new(src, nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    em = _input(bsdf, "Emission Color", "Emission")
    t = tex("emissive")
    if t and em is not None:
        links.new(t.outputs["Color"], em)
    elif em is not None and j.get("emissive", "#000000") != "#000000":
        em.default_value = _rgb(j.get("emissive"))
    es = _input(bsdf, "Emission Strength")
    if es is not None and (t or j.get("emissive", "#000000") != "#000000"):
        es.default_value = float(j.get("emissiveStrength", 1.0))
    t = tex("opacity")
    if t:
        links.new(t.outputs["Color"], bsdf.inputs["Alpha"])
    elif float(j.get("opacity", 1.0)) < 1.0:
        bsdf.inputs["Alpha"].default_value = float(j.get("opacity"))
    if t or float(j.get("opacity", 1.0)) < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        else:
            mat.blend_method = "BLEND"
    t = tex("height")
    bump_k = float(j.get("bumpStrength", 0.0) or 0.0)
    if t and bump_k:
        # relief as a Bump node, after the Normal Map when there is one
        bump = nodes.new("ShaderNodeBump")
        bump.location = (0, -650)
        bump.invert = bump_k < 0
        bump.inputs["Strength"].default_value = min(1.0, abs(bump_k))
        bump.inputs["Distance"].default_value = float(j.get("bumpDistance", 1.0) or 1.0)
        links.new(t.outputs["Color"], bump.inputs["Height"])
        if nmap is not None:
            links.new(nmap.outputs["Normal"], bump.inputs["Normal"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    elif t:
        disp = nodes.new("ShaderNodeDisplacement")
        disp.location = (300, -300)
        disp.inputs["Scale"].default_value = max(0.01, float(j.get("heightScale", 0.0)) * 10)
        links.new(t.outputs["Color"], disp.inputs["Height"])
        links.new(disp.outputs["Displacement"], out.inputs["Displacement"])
    # kept in the file even before it is assigned, and shown in the Asset Browser (Current File) with a preview
    mat.use_fake_user = True
    try:
        mat.asset_mark()
        mat.asset_generate_preview()
    except Exception:
        pass  # an older Blender without assets: the fake user is enough
    return mat


def assign_material(mat, objects):
    n = 0
    for ob in objects:
        if ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        if ob.data.materials:
            ob.active_material = mat
        else:
            ob.data.materials.append(mat)
        n += 1
    return n


class PERCH_OT_send_material(bpy.types.Operator):
    bl_idname = "perch.send_material"
    bl_label = "Материал в Oddments"
    bl_description = "Отправить активный материал в библиотеку Oddments: Principled BSDF и его текстуры; материал из нод (шум, рампы, Mix Shader) сначала запекается в текстуры"

    @classmethod
    def poll(cls, context):
        ob = context.active_object
        return bool(ob and ob.active_material)

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        mat = context.active_object.active_material
        name = mat.name  # read now: during the bake the original steps aside under a temporary name
        tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), name + ".perchmat")
        cleanup = lambda: None
        try:
            with _Keep():
                src = mat
                if _prefs().bake and _needs_bake(mat):
                    # a node setup becomes images on a temporary plane first
                    src, cleanup = _baked_material(mat, int(_prefs().bake_size))
                n = material_to_perchmat(src, tmp)
            _send(tmp, name + ".perchmat")
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        finally:
            cleanup()
        self.report({"INFO"}, _t("Материал «%s» отправлен в Oddments (текстур: %d)") % (name, n))
        return {"FINISHED"}


def _scene_materials(context):
    seen, out = set(), []
    for ob in context.scene.objects:
        if ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        for slot in ob.material_slots:
            m = slot.material
            if m and m.name not in seen and not m.name.endswith("·perch"):
                seen.add(m.name)
                out.append(m)
    return out


class PERCH_OT_send_scene_materials(bpy.types.Operator):
    bl_idname = "perch.send_scene_materials"
    bl_label = "Все материалы сцены в Oddments"
    bl_description = "Каждый материал объектов сцены — в библиотеку Oddments (материалы из нод запекаются в текстуры)"

    @classmethod
    def poll(cls, context):
        return bool(_scene_materials(context))

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        mats = _scene_materials(context)
        sent, failed = 0, []
        wm = context.window_manager
        wm.progress_begin(0, len(mats))
        try:
            for i, mat in enumerate(mats):
                name = mat.name
                tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), name + ".perchmat")
                cleanup = lambda: None
                try:
                    with _Keep():
                        src = mat
                        if _prefs().bake and _needs_bake(mat):
                            src, cleanup = _baked_material(mat, int(_prefs().bake_size))
                        material_to_perchmat(src, tmp)
                    _send(tmp, name + ".perchmat")
                    sent += 1
                except Exception as e:
                    failed.append(name)
                    print("Oddments: материал не отправлен", name, e)
                finally:
                    cleanup()
                wm.progress_update(i + 1)
        finally:
            wm.progress_end()
        if failed:
            self.report({"WARNING"}, _t("В Oddments: %d, не получилось: %s") % (sent, ", ".join(failed)))
        else:
            self.report({"INFO"}, _t("Все материалы сцены в Oddments: %d") % sent)
        return {"FINISHED"}


class PERCH_OT_apply_material(bpy.types.Operator):
    bl_idname = "perch.apply_material"
    bl_label = "Применить материал из Oddments"
    bl_description = "Материал, выделенный в Oddments, — на выделенные объекты (текстуры упаковываются в .blend)"

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with _open(_url("/selection"), timeout=5) as r:
                paths = [p for p in json.loads(r.read().decode()) if p.lower().endswith(".perchmat")]
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        if not paths:
            self.report({"WARNING"}, _t("В Oddments не выделен материал"))
            return {"CANCELLED"}
        try:
            mat = perchmat_to_material(paths[0])
        except Exception as e:
            self.report({"ERROR"}, _t("Не удалось прочитать материал: %s") % e)
            return {"CANCELLED"}
        n = assign_material(mat, context.selected_objects)
        self.report({"INFO"}, (_t("Материал «%s» назначен объектам: %d") % (mat.name, n)) if n
                    else _t("Материал «%s» добавлен в файл — выделите объекты, чтобы назначить") % mat.name)
        return {"FINISHED"}


def _import_image(path):
    img = bpy.data.images.load(path, check_existing=True)
    empty = bpy.data.objects.new("Ref " + os.path.basename(path), None)
    empty.empty_display_type = "IMAGE"
    empty.data = img
    empty.empty_display_size = 2.0
    empty.empty_image_side = "FRONT"
    bpy.context.collection.objects.link(empty)
    return empty


def _append_blend(path):
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    coll = bpy.data.collections.new(os.path.splitext(os.path.basename(path))[0])
    bpy.context.scene.collection.children.link(coll)
    for ob in dst.objects:
        if ob is not None:
            coll.objects.link(ob)


def smooth_mesh(me, angle):
    """Shade Smooth by Angle on the mesh data, sharp edges already marked in the file kept."""
    a = me.attributes.get("sharp_edge")
    keep = None
    if a and a.domain == "EDGE" and a.data_type == "BOOLEAN":
        keep = [False] * len(me.edges)
        a.data.foreach_get("value", keep)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=angle)
    if keep and any(keep):
        a = me.attributes["sharp_edge"]
        now = [False] * len(me.edges)
        a.data.foreach_get("value", now)
        a.data.foreach_set("value", [x or y for x, y in zip(now, keep)])


def flat_caps(me, caps, angle):
    """Weighted-normal shading for an extruded shape (the look of Blender's Weighted Normal modifier): the flat caps stay
    flat — without it the cap's normals lean towards the bevel at its border and a smooth cap shows streaks — and the
    bevel starts from the cap's normal, so it still runs smooth. Corners across a sharp edge (a wall without a bevel)
    keep their own normal. caps: one bool per face."""
    if not any(caps):
        return
    n = len(me.loops)
    cn = [0.0] * (n * 3)
    me.corner_normals.foreach_get("vector", cn)
    vi = [0] * n
    me.loops.foreach_get("vertex_index", vi)
    cap_n = {}
    for p in me.polygons:
        if caps[p.index]:
            for v in p.vertices:
                cap_n[v] = p.normal.copy()
    lim = math.cos(min(angle, math.radians(60)) + 1e-3)
    out = []
    for i in range(n):
        c = cap_n.get(vi[i])
        own = (cn[3 * i], cn[3 * i + 1], cn[3 * i + 2])
        out.append(tuple(c) if c is not None and c[0] * own[0] + c[1] * own[1] + c[2] * own[2] > lim else own)
    me.normals_split_custom_set(out)


def _obj_smooth_angle(path):
    """An OBJ made by Oddments' «SVG в 3D» names its own smoothing angle («# oddments-smooth 36.0»: 90° / bevel segments
    + 6°, so the bevel is smooth and the outline's corners sharp) → radians or None."""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for _ in range(5):
                ln = f.readline()
                if ln.startswith("# oddments-smooth "):
                    return math.radians(float(ln.split()[2]))
    except Exception:
        pass
    return None


def smooth_imported(before, angle_tag=None):
    """Imported models come in smooth: meshes without normals of their own (STL, OBJ from «SVG в 3D», PLY…) get
    Smooth by Angle (or the Auto Smooth modifier — the add-on's setting); normals written in the file are the author's
    shading and stay. → how many objects were smoothed."""
    p = _prefs()
    how = getattr(p, "import_smooth", "ANGLE")
    angle = angle_tag if angle_tag is not None else getattr(p, "import_smooth_angle", math.radians(30))
    if how == "NONE":
        return 0
    done, seen = 0, set()
    for ob in [o for o in bpy.data.objects if o not in before and o.type == "MESH"]:
        me = ob.data
        if me in seen or not me.polygons or me.has_custom_normals:
            continue
        seen.add(me)
        tagged = angle_tag is not None  # a model from «SVG в 3D»: smooth by its own angle, flat caps
        if how == "MODIFIER" and not tagged:
            try:
                with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
                    bpy.ops.object.shade_auto_smooth(angle=angle)
                done += 1
                continue
            except Exception as e:  # no Essentials asset library: the same smoothing on the mesh data
                print("Oddments: Auto Smooth —", e)
        smooth_mesh(me, angle)
        if tagged:
            caps = [bool(me.materials) and p.material_index < len(me.materials) and me.materials[p.material_index] is not None
                    and me.materials[p.material_index].name.split(".")[0] in ("Лицо", "Тыл") for p in me.polygons]
            flat_caps(me, caps, angle)
        done += 1
    return done


MODEL_IMPORT = (".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply", ".abc", ".usd", ".usdz", ".usdc")


# ---------- Gaussian splats ----------
# Blender 5.3 reads 3DGS splats itself: a PLY with the splat fields (its PLY importer sees them) and SPZ, into a point cloud
# of splats rendered by Workbench, EEVEE and Cycles. Oddments sends splats as PLY (other formats are converted there).
SPLAT_EXT = {".spz", ".splat", ".ksplat", ".sog"}


class SplatError(RuntimeError):
    """A splat the running Blender cannot open: said to the person in a popup, not only printed."""


def _is_splat_ply(path):
    try:
        with open(path, "rb") as f:
            head = f.read(8192)
    except OSError:
        return False
    end = head.find(b"end_header")
    if not head.startswith(b"ply") or end < 0:
        return False
    h = head[:end].decode("ascii", "replace")

    def has(p):
        return any(ln.split()[:1] == ["property"] and ln.split()[-1:] == [p] for ln in h.splitlines())
    return (has("opacity") and (has("f_dc_0") or has("scale_0"))) or has("packed_position")


def _import_splat(path, ext):
    if bpy.app.version < (5, 3, 0):
        raise SplatError(_t("Сплаты Blender открывает с версии 5.3 — у вас %s. Обновите Blender или откройте сплат аддоном KIRI 3DGS Render.") % bpy.app.version_string)
    before = set(bpy.data.objects)
    if ext == ".ply":
        bpy.ops.wm.ply_import(filepath=path)
    else:
        try:
            bpy.ops.wm.spz_import.get_rna_type()
        except Exception:
            raise SplatError(_t("Этот Blender не умеет открывать SPZ — отправьте сплат из Oddments ещё раз (он придёт как PLY)."))
        bpy.ops.wm.spz_import(filepath=path)
    # a PLY from a trainer or from Oddments is in the camera's frame (y down, z forward): stood up for Blender's Z up.
    # SPZ is turned by Blender's own importer.
    if ext == ".ply":
        for ob in set(bpy.data.objects) - before:
            ob.rotation_euler.x -= math.pi / 2
    return True


def _say(title, text):
    """A popup for something the person must know (an import that did not happen), from a timer too."""
    if bpy.app.background:  # no window: a popup there crashes Blender
        print(title + ":", text)
        return

    def draw(self, context):
        for line in text.splitlines():
            self.layout.label(text=line)
    try:
        with bpy.context.temp_override(**_ui_context()):
            bpy.context.window_manager.popup_menu(draw, title=title, icon="ERROR")
    except Exception:
        print(title + ":", text)


def import_path(path, assign=True):
    ext = os.path.splitext(path)[1].lower()
    if ext in SPLAT_EXT or (ext == ".ply" and _is_splat_ply(path)):
        return _import_splat(path, ext)
    before = set(bpy.data.objects) if ext in MODEL_IMPORT else None
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=path)
    elif ext == ".ply":
        bpy.ops.wm.ply_import(filepath=path)
    elif ext == ".abc":
        bpy.ops.wm.alembic_import(filepath=path, as_background_job=False)
    elif ext in (".usd", ".usdz", ".usdc"):
        bpy.ops.wm.usd_import(filepath=path)
    elif ext == ".blend":
        _append_blend(path)
    elif ext in IMAGE_EXT:
        _import_image(path)
    elif ext == ".perchicons":
        import_icon_set(path)
    elif ext == ".perchmat":
        mat = perchmat_to_material(path)
        if assign:
            assign_material(mat, bpy.context.selected_objects)
    else:
        return False
    if before is not None:  # a .blend is the author's own scene: its shading stays as it is
        smooth_imported(before, _obj_smooth_angle(path) if ext == ".obj" else None)
    return True


class PERCH_OT_insert(bpy.types.Operator):
    bl_idname = "perch.insert"
    bl_label = "Вставить из Oddments"
    bl_description = "Добавить в сцену файлы, выделенные сейчас в Oddments: модели — объектами, картинки — референсами"

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with _open(_url("/selection"), timeout=5) as r:
                paths = json.loads(r.read().decode())
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        if not paths:
            self.report({"WARNING"}, _t("В Oddments ничего не выделено"))
            return {"CANCELLED"}
        done, skipped = 0, 0
        for p in paths:
            try:
                if import_path(p):
                    done += 1
                else:
                    skipped += 1
            except SplatError as e:
                self.report({"WARNING"}, str(e))
                skipped += 1
            except Exception as e:
                print("Oddments: не удалось вставить", p, e)
                skipped += 1
        self.report({"INFO"}, _t("Вставлено из Oddments: %d%s") % (done, (_t(", пропущено: %d") % skipped) if skipped else ""))
        return {"FINISHED"}


class PERCH_OT_check(bpy.types.Operator):
    bl_idname = "perch.check"
    bl_label = "Проверить подключение"
    bl_description = "Найти Oddments на этом компьютере и проверить токен"

    def execute(self, context):
        if _offline():
            self.report({"ERROR"}, _t(OFFLINE_HINT))
            return {"CANCELLED"}
        if not _ping():
            self.report({"ERROR"}, _t("Oddments не отвечает: откройте приложение Oddments (порт %d)") % _prefs().port)
            return {"CANCELLED"}
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with _open(_url("/selection"), timeout=5) as r:
                n = len(json.loads(r.read().decode()))
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        self.report({"INFO"}, _t("Oddments на связи, токен подходит. Выделено в Oddments: %d") % n)
        return {"FINISHED"}


def _ui_context():
    """A window + 3D view to run import operators from a timer (there is no UI context there)."""
    wm = bpy.context.window_manager
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                return {"window": win, "area": area, "region": region}
    return {"window": wm.windows[0]} if wm.windows else {}


def _poll_outbox():
    """Timer: files sent from Oddments with «В Blender». Quiet when Oddments is closed; every second while it runs."""
    try:
        p = _prefs()
    except KeyError:  # the add-on was disabled
        return None
    if not p.receive or not p.token.strip():
        return 3.0
    if _offline():
        return 10.0  # online access is off: no polling, quietly
    try:
        with _open(_url("/outbox"), timeout=0.4) as r:
            paths = json.loads(r.read().decode())
    except Exception:
        return 3.0  # Oddments is not running (or a wrong token): look again a bit later
    done = 0
    # a set of materials («Все в Blender» in Oddments) goes into the file as assets: assigning each to the selection
    # in turn would leave only the last one on it
    many = sum(1 for x in paths if x.lower().endswith(".perchmat")) > 1
    for path in paths:
        try:
            with bpy.context.temp_override(**_ui_context()):
                if import_path(path, assign=not many):
                    done += 1
        except SplatError as e:
            _say(_t("Oddments: сплат не открылся"), str(e))
        except Exception as e:
            print("Oddments: не удалось вставить", path, e)
    if done:
        print("Oddments: получено из Oddments — %d" % done)
    return 1.0


# ---------- the add-on's own material library: Blender materials as they are ----------
# Procedural materials (noise, ramps, groups, Mix Shader…) do not survive a conversion to glTF or .perchmat, so the
# library keeps real Blender materials — all of them in ONE file, «Oddments Materials.blend» (node groups and images packed
# inside), marked as assets; its folder is registered as an Asset Library, so they show in Blender's own Asset Browser
# too. PNG previews for the Oddments browser lie in «previews/» next to it. The library file is written by a background
# Blender (it opens the library, swaps in the new materials, saves), so nothing from it lands in the open scene.
# next to the app's library: «Oddments Library», or «Perch Library» for a library made before the rename
_DOCS = os.path.join(os.path.expanduser("~"), "Documents")
MATLIB_DEFAULT = os.path.join(_DOCS, "Perch Library" if os.path.isdir(os.path.join(_DOCS, "Perch Library")) else "Oddments Library",
                              "Blender Materials")
MATLIB_NAME = "Oddments"  # materials and models (add-on 1.12); was «Oddments · материалы»
MATLIB_FILE = "Oddments Materials.blend"
# names from before the rename to Oddments (bug #112): the file, the Asset Library and the hidden collection are
# renamed in place the first time they are met, nothing is copied or lost
OLD_MATLIB_NAME = "Perch · материалы"
OLD_LIB_NAMES = (OLD_MATLIB_NAME, "Oddments · материалы")
OLD_MATLIB_FILE = "Perch Materials.blend"
_TMP = " ·perch-tmp"


def matlib_dir(create=True):
    d = bpy.path.abspath(_prefs().mat_dir.strip()) if _prefs().mat_dir.strip() else MATLIB_DEFAULT
    if create:
        os.makedirs(os.path.join(d, "previews"), exist_ok=True)
    return d


def matlib_path():
    d = matlib_dir(create=False)
    new, old = os.path.join(d, MATLIB_FILE), os.path.join(d, OLD_MATLIB_FILE)
    if not os.path.exists(new) and os.path.exists(old):
        try:
            os.replace(old, new)
        except OSError:
            return old
    return new


def _file_name(name):
    n = "".join("_" if c in '\\/:*?"<>|' or ord(c) < 32 else c for c in name).strip().strip(".")
    return (n or "Material")[:100]


def _preview_path(name):
    return os.path.join(matlib_dir(create=False), "previews", _file_name(name) + ".png")


_names_cache = {"key": None, "names": []}


def matlib_names():
    path = matlib_path()
    if not os.path.exists(path):
        return []
    key = (path, os.path.getmtime(path))
    if _names_cache["key"] != key:
        with bpy.data.libraries.load(path) as (src, dst):  # reads the list only, loads nothing
            names = list(src.materials)
        _names_cache.update(key=key, names=sorted(names, key=str.lower))
    return _names_cache["names"]


def matlib_items():
    out = []
    for name in matlib_names():
        png = _preview_path(name)
        t = int(os.path.getmtime(png)) if os.path.exists(png) else 0
        out.append({"id": "lib:%s:%d" % (name, t), "name": name, "kind": "material", "ext": "blend", "src": "lib",
                    "path": matlib_path(), "local_thumb": png if t else "", "tags": ["blender"], "file": matlib_path()})
    return out


_LIB_SCRIPT = r"""
import bpy, json, os, sys
a = json.loads(sys.argv[sys.argv.index("--") + 1])
if a["fresh"]:  # a new library: an empty file, without the startup cube, camera and light
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
for n in a["remove"]:
    m = bpy.data.materials.get(n)
    if m:
        bpy.data.materials.remove(m)
# the materials being replaced go first, with their now unused groups and images — so the new ones keep their
# names instead of getting ".001"
for x in a["add"]:
    with bpy.data.libraries.load(x["src"]) as (src, dst):
        x["names"] = x.get("names") or src.materials[:1]
    for n in x["names"]:
        old = bpy.data.materials.get(n)
        if old:
            bpy.data.materials.remove(old)
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
for x in a["add"]:
    with bpy.data.libraries.load(x["src"], link=False) as (src, dst):
        dst.materials = [n for n in src.materials if n in x["names"]]
    for m in dst.materials:
        if m:
            m.use_fake_user = True
            if not m.asset_data:
                m.asset_mark()
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=a["lib"], compress=True)
if os.path.exists(a["lib"] + "1"):
    os.remove(a["lib"] + "1")
print("PERCH-LIB-OK", len(bpy.data.materials))
"""


class _Lock:
    """The library may sit in a team's shared folder: two people saving it at once would lose one's change. A lock file
    next to it: whoever holds it writes, the other waits (up to two minutes); a lock older than ten minutes is left over
    from a crash and is taken over."""
    def __init__(self, d):
        self.p = os.path.join(d, ".oddments-lock")

    def __enter__(self):
        import time
        t0 = time.time()
        while True:
            try:
                fd = os.open(self.p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, ("%s %d" % (os.environ.get("USERNAME") or os.environ.get("USER") or "?", os.getpid())).encode("utf-8"))
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.p) > 600:
                        os.remove(self.p)
                        continue
                except OSError:
                    pass
                if time.time() - t0 > 120:
                    raise RuntimeError(_t("библиотеку сейчас записывает кто-то другой — попробуйте через минуту"))
                time.sleep(0.5)

    def __exit__(self, *a):
        try:
            os.remove(self.p)
        except OSError:
            pass


def _lib_run(add=(), remove=()):
    """Change the library file in a background Blender: add materials from .blend files, remove by name."""
    with _Lock(matlib_dir()):
        _lib_run_locked(add, remove)


def _lib_run_locked(add=(), remove=()):
    lib = matlib_path()
    matlib_dir()
    fresh = not os.path.exists(lib)
    args = json.dumps({"lib": lib, "fresh": fresh, "add": list(add), "remove": list(remove)})
    cmd = [bpy.app.binary_path, "-b", "--factory-startup"] + ([] if fresh else [lib]) + ["--python-expr", _LIB_SCRIPT, "--", args]
    flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300, creationflags=flags)
    if "PERCH-LIB-OK" not in (r.stdout or ""):
        tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["?"])[-1]
        raise RuntimeError(_t("библиотека не записалась: ") + tail)
    _names_cache["key"] = None


def migrate_old_library():
    """Add-on 1.8 kept one .blend per material: fold them into the one library file (once)."""
    d = matlib_dir(create=False)
    if not os.path.isdir(d):
        return 0
    matlib_path()  # the old one-file library gets its new name first
    old = [f for f in os.listdir(d) if f.lower().endswith(".blend") and f not in (MATLIB_FILE, OLD_MATLIB_FILE)]
    if not old:
        return 0
    matlib_dir()
    _lib_run(add=[{"src": os.path.join(d, f)} for f in old])
    for f in old:
        base = os.path.splitext(f)[0]
        png = os.path.join(d, base + ".png")
        if os.path.exists(png):
            os.replace(png, os.path.join(d, "previews", base + ".png"))
        os.remove(os.path.join(d, f))
    return len(old)


def ensure_asset_library(d):
    """The folder as a Blender Asset Library (once). Returns True when it was added just now."""
    libs = bpy.context.preferences.filepaths.asset_libraries
    norm = os.path.normcase(os.path.abspath(d))
    have = [l for l in libs if os.path.normcase(os.path.abspath(bpy.path.abspath(l.path))) == norm]
    if have:
        for l in have:
            if l.name in OLD_LIB_NAMES:
                l.name = MATLIB_NAME
        return False
    try:
        lib = libs.new(name=MATLIB_NAME, directory=d)
    except Exception:
        try:
            bpy.ops.preferences.asset_library_add(directory=d)
            lib = libs[-1]
            lib.name = MATLIB_NAME
        except Exception:
            return False
    try:
        lib.import_method = "APPEND"
    except Exception:
        pass
    if bpy.context.preferences.use_preferences_save:
        try:
            bpy.ops.wm.save_userpref()
        except Exception:
            pass
    return True


def _render_preview(mat, png, size=256):
    """A shaded sphere with the material (Cycles, a studio light from Blender itself) → PNG with transparency."""
    import bmesh
    sc = bpy.data.scenes.new("perch-preview")
    made = []
    try:
        me = bpy.data.meshes.new("perch-preview")
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=1.0, calc_uvs=True)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        me.materials.append(mat)
        ob = bpy.data.objects.new("perch-preview", me)
        cam_d = bpy.data.cameras.new("perch-preview")
        cam_d.lens = 85
        cam = bpy.data.objects.new("perch-preview-cam", cam_d)
        cam.location = (0, -6.2, 1.4)
        cam.rotation_euler = (math.radians(77), 0, 0)
        world = bpy.data.worlds.new("perch-preview")
        world.use_nodes = True
        nt = world.node_tree
        bg = nt.nodes.get("Background")
        hdr = os.path.join(bpy.utils.system_resource("DATAFILES"), "studiolights", "world", "forest.exr")
        if bg and os.path.exists(hdr):
            env = nt.nodes.new("ShaderNodeTexEnvironment")
            env.image = bpy.data.images.load(hdr, check_existing=False)
            made.append(env.image)
            nt.links.new(env.outputs["Color"], bg.inputs["Color"])
            bg.inputs["Strength"].default_value = 1.0
        made += [ob, cam, me, cam_d, world]
        sc.collection.objects.link(ob)
        sc.collection.objects.link(cam)
        sc.camera, sc.world = cam, world
        r = sc.render
        r.engine = "CYCLES"
        sc.cycles.samples = 32
        if hasattr(sc.cycles, "use_denoising"):
            sc.cycles.use_denoising = True
        r.resolution_x = r.resolution_y = size
        r.resolution_percentage = 100
        r.film_transparent = True
        r.image_settings.file_format = "PNG"
        r.image_settings.color_mode = "RGBA"
        r.filepath = png
        try:
            sc.view_settings.view_transform = "Standard"  # the preview as the colours are, without the AgX tone curve
        except TypeError:
            pass
        with bpy.context.temp_override(scene=sc):
            bpy.ops.render.render(write_still=True, scene=sc.name)
        return os.path.exists(png)
    except Exception as e:
        print("Oddments: превью материала не отрисовалось", e)
        return False
    finally:
        for idb in reversed(made):
            try:
                coll = {bpy.types.Object: bpy.data.objects, bpy.types.Mesh: bpy.data.meshes, bpy.types.Camera: bpy.data.cameras,
                        bpy.types.World: bpy.data.worlds, bpy.types.Image: bpy.data.images}
                for t, c in coll.items():
                    if isinstance(idb, t):
                        c.remove(idb)
                        break
            except Exception:
                pass
        bpy.data.scenes.remove(sc)


def save_materials_to_library(mats):
    """Copies of the materials (their groups and images packed) go into the one library file; the user's own
    materials, groups and images are not changed (copies get the original names only for the write).
    A material with the same name in the library is replaced."""
    d = matlib_dir()
    for mat in mats:
        _render_preview(mat, _preview_path(mat.name))
    twins = []  # (original, its name, copy)

    def twin(idb):
        orig = idb.name
        idb.name = orig + _TMP
        c = idb.copy()
        c.name = orig
        twins.append((idb, orig, c))
        return c

    seen = {}

    def walk(tree):
        for n in tree.nodes:
            if n.type == "GROUP" and n.node_tree:
                g = n.node_tree
                if g not in seen:
                    seen[g] = None
                    seen[g] = twin(g)
                    walk(seen[g])
                n.node_tree = seen[g]
            img = getattr(n, "image", None)
            if img is not None:
                if img not in seen:
                    c = twin(img)
                    if not c.packed_file:
                        try:
                            c.pack()
                        except Exception as e:
                            print("Oddments: картинка не упаковалась", img.name, e)
                    seen[img] = c
                n.image = seen[img]

    tmp = os.path.join(tempfile.gettempdir(), "perch-matlib-%d.blend" % os.getpid())
    names = []
    try:
        copies = set()
        for mat in mats:
            cp = twin(mat)
            names.append(cp.name)
            if cp.node_tree:
                walk(cp.node_tree)
            cp.use_fake_user = True
            try:
                cp.asset_mark()
                png = _preview_path(cp.name)
                if os.path.exists(png):
                    with bpy.context.temp_override(id=cp):
                        bpy.ops.ed.lib_id_load_custom_preview(filepath=png)
            except Exception as e:
                print("Oddments: ассет без превью", e)
            copies.add(cp)
        bpy.data.libraries.write(tmp, copies, path_remap="ABSOLUTE", fake_user=True, compress=True)
    finally:
        # the copies go, the originals get their names back (order: free the names first)
        for orig, name, c in reversed(twins):
            try:
                coll = bpy.data.materials if isinstance(c, bpy.types.Material) else bpy.data.node_groups if isinstance(c, bpy.types.NodeTree) else bpy.data.images
                coll.remove(c)
            except Exception:
                pass
        for orig, name, c in twins:
            orig.name = name
    try:
        existed = [n for n in names if n in matlib_names()]
        _lib_run(add=[{"src": tmp, "names": names}])
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    added = ensure_asset_library(d)
    return names, existed, added


def remove_from_library(name):
    _lib_run(remove=[name])
    png = _preview_path(name)
    if os.path.exists(png):
        os.remove(png)


def material_from_library(name):
    """Append the saved material (once per saved version: a second use reuses it)."""
    png = _preview_path(name)
    t = int(os.path.getmtime(png)) if os.path.exists(png) else int(os.path.getmtime(matlib_path()))
    for m in bpy.data.materials:
        if m.get("_perch_lib") == name and m.get("_perch_t") == t:
            return m
    with bpy.data.libraries.load(matlib_path(), link=False) as (src, dst):
        if name not in src.materials:
            raise RuntimeError(_t("в библиотеке нет «%s»") % name)
        dst.materials = [name]
    m = dst.materials[0]
    m["_perch_lib"], m["_perch_t"] = name, t
    try:
        m.asset_clear()  # in the scene it is an ordinary material; the asset lives in the library
    except Exception:
        pass
    m.use_fake_user = False
    return m


class PERCH_OT_save_material_lib(bpy.types.Operator):
    bl_idname = "perch.save_material_lib"
    bl_label = "Материал в библиотеку"
    bl_description = ("Сохранить активный материал как есть — с нодами, группами и картинками — в библиотеку материалов "
                      "аддона. Без переделки в Oddments: процедурные материалы остаются процедурными")

    all_scene: bpy.props.BoolProperty(default=False, options={"HIDDEN", "SKIP_SAVE"})

    def execute(self, context):
        if self.all_scene:
            mats = _scene_materials(context)
        else:
            ob = context.active_object
            mats = [ob.active_material] if ob and ob.active_material else []
        if not mats:
            self.report({"WARNING"}, _t("Выберите объект с материалом"))
            return {"CANCELLED"}
        try:
            migrate_old_library()
            names, existed, added = save_materials_to_library(mats)
        except Exception as e:
            self.report({"ERROR"}, _t("Не сохранилось: %s") % e)
            return {"CANCELLED"}
        msg = (_t("В библиотеке: «%s»") % mats[0].name) if len(mats) == 1 else _t("В библиотеке: %d материалов") % len(mats)
        if added:
            msg += _t(" · папка добавлена в Asset Browser («%s»)") % MATLIB_NAME
        self.report({"INFO"}, msg)
        return {"FINISHED"}


# ---------- hot-swap: a model from Oddments in place of the selected objects ----------
REPLACED = "Oddments · заменённые"
OLD_REPLACED = "Perch · заменённые"


def _hidden():
    """The hidden collection of replaced objects; the one from before the rename gets the new name."""
    coll = bpy.data.collections.get(REPLACED)
    if coll is None:
        coll = bpy.data.collections.get(OLD_REPLACED)
        if coll is not None:
            coll.name = REPLACED
    return coll
GEOMETRY = {"MESH", "CURVE", "SURFACE", "FONT", "META", "CURVES", "POINTCLOUD", "VOLUME"}


def _import_objects(path):
    """Import a file, return the objects it made (and drop the empty collections an append leaves)."""
    before, colls = set(bpy.data.objects), set(bpy.data.collections)
    if not import_path(path, assign=False):
        raise RuntimeError(_t("Этот тип файла в сцену не вставить"))
    new = [o for o in bpy.data.objects if o not in before]
    # a whole scene from a .blend brings its cameras and lights: a model in place of an object does not need them
    rest = [o for o in new if o.type not in {"CAMERA", "LIGHT", "LIGHT_PROBE", "SPEAKER"}]
    if rest and len(rest) < len(new):
        for o in new:
            if o not in rest:
                for ch in o.children:
                    mw = ch.matrix_world.copy()
                    ch.parent = None
                    ch.matrix_world = mw
                bpy.data.objects.remove(o)
        new = rest
    if not new:
        raise RuntimeError(_t("В файле нет объектов"))
    for c in [c for c in bpy.data.collections if c not in colls]:
        c["_perch_new"] = True
    return new


def _roots(objs):
    s = set(objs)
    return [o for o in objs if o.parent not in s]


def _copy_tree(objs):
    """A linked duplicate (Alt+D) of the imported objects, for the second and further replaced objects."""
    m = {o: o.copy() for o in objs}
    for o, c in m.items():
        if o.parent in m:
            c.parent = m[o.parent]
        for coll in o.users_collection:
            coll.objects.link(c)
    return list(m.values())


def _group(objs, name):
    roots = _roots(objs)
    if len(roots) == 1:
        return roots[0]
    root = bpy.data.objects.new(name, None)
    root.empty_display_size = 0.25
    roots[0].users_collection[0].objects.link(root)
    bpy.context.view_layer.update()
    for r in roots:
        mw = r.matrix_world.copy()
        r.parent = root
        r.matrix_world = mw
    return root


def _bounds(ob, inv):
    """Bounding box of an object and its children in the frame `inv` maps the world into."""
    lo, hi = None, None
    for o in [ob] + list(ob.children_recursive):
        if o.type not in GEOMETRY:
            continue
        for corner in o.bound_box:
            p = inv @ (o.matrix_world @ Vector(corner))
            lo = p.copy() if lo is None else Vector(map(min, lo, p))
            hi = p.copy() if hi is None else Vector(map(max, hi, p))
    return (lo, hi) if lo is not None else None


def _repoint(holder, old, new):
    for prop in holder.bl_rna.properties:
        if prop.type == "POINTER" and getattr(prop.fixed_type, "identifier", "") == "Object":
            try:
                if getattr(holder, prop.identifier) == old:
                    setattr(holder, prop.identifier, new)
            except (AttributeError, TypeError, ValueError):
                pass


def _retire(old, scene):
    coll = _hidden()
    if coll is None:
        coll = bpy.data.collections.new(REPLACED)
    if coll.name not in scene.collection.children:
        scene.collection.children.link(coll)
    coll.hide_viewport = True
    coll.hide_render = True
    for c in list(old.users_collection):
        c.objects.unlink(old)
    coll.objects.link(old)


def swap_object(old, new_objs, name, fit=False, keep_materials=False, scene=None):
    """Put the imported model where `old` is: its transform (optionally fitted to old's size), parent, collections,
    visibility, children, the modifiers and constraints that pointed at it, custom properties and name. The old
    object is not deleted: it goes to the hidden collection «Oddments · заменённые» (and Ctrl+Z undoes it all)."""
    scene = scene or bpy.context.scene
    vl = bpy.context.view_layer
    root = _group(new_objs, name)
    vl.update()
    base = root.matrix_world.copy()  # what the importer applied (axis conversion, unit scale)
    m = Matrix.Identity(4)
    if fit:
        nb, ob = _bounds(root, Matrix.Identity(4)), _bounds(old, old.matrix_world.inverted())
        if nb and ob:
            ns, os_ = max(nb[1] - nb[0]), max(ob[1] - ob[0])
            if ns > 1e-9 and os_ > 1e-9:
                k = os_ / ns
                m = Matrix.Translation((ob[0] + ob[1]) / 2 - k * (nb[0] + nb[1]) / 2) @ Matrix.Scale(k, 4)
    root.parent = old.parent
    if old.parent:
        root.parent_type = old.parent_type
        if old.parent_type == "BONE":
            root.parent_bone = old.parent_bone
    vl.update()
    root.matrix_world = old.matrix_world @ m @ base
    tree = [root] + list(root.children_recursive)
    for o in tree:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        for c in old.users_collection:
            c.objects.link(o)
    root.hide_viewport, root.hide_render = old.hide_viewport, old.hide_render
    vl.update()
    for ch in list(old.children):
        if ch not in tree:
            mw = ch.matrix_world.copy()
            ch.parent = root
            ch.matrix_world = mw
    meshes = [o for o in tree if o.type == "MESH"]
    main = max(meshes, key=lambda o: len(o.data.vertices)) if meshes else root
    # every object in the file, not only this scene's: a modifier or constraint in another scene may point at the old one
    for o in bpy.data.objects:
        if o is old or o in tree:
            continue
        for md in o.modifiers:
            _repoint(md, old, main)
        for cn in o.constraints:
            _repoint(cn, old, root)
    if keep_materials and old.type in GEOMETRY and getattr(old.data, "materials", None):
        mats = list(old.data.materials)
        for o in meshes:
            o.data.materials.clear()
            for mt in mats:
                o.data.materials.append(mt)
    for k in old.keys():
        if k != "_RNA_UI":
            try:
                root[k] = old[k]
            except Exception:
                pass
    hidden = old.hide_get()
    orig = old.name
    old.name = orig + " · заменён"
    root.name = orig
    _retire(old, scene)
    for o in tree:
        o.hide_set(hidden)
    return root


def _drop_empty_new_collections():
    for c in [c for c in bpy.data.collections if c.get("_perch_new")]:
        if not c.objects and not c.children:
            bpy.data.collections.remove(c)
        else:
            del c["_perch_new"]


def _select_only(context, objs):
    for o in context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        try:
            o.select_set(True)
        except RuntimeError:
            pass
    if objs:
        context.view_layer.objects.active = objs[0]


def _first_selected_model():
    with _open(_url("/selection"), timeout=5) as r:
        paths = json.loads(r.read().decode())
    return next((p for p in paths if os.path.splitext(p)[1].lower() in MODEL_EXT), None)


MODEL_EXT = {".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply", ".abc", ".usd", ".usdz", ".usdc", ".usda", ".blend"}


class PERCH_OT_swap(bpy.types.Operator):
    bl_idname = "perch.swap"
    bl_label = "Заменить на модель из Oddments"
    bl_description = ("Поставить модель из Oddments на место выделенных объектов: положение, поворот, масштаб, родитель, "
                      "коллекции и имя сохраняются. Старые объекты — в скрытой коллекции «Oddments · заменённые»")
    bl_options = {"REGISTER", "UNDO"}

    filepath: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})
    name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})
    fit: bpy.props.BoolProperty(name="Подогнать размер", default=False,
                                description="Вписать новую модель в габариты старой (по самой большой стороне)")
    keep_materials: bpy.props.BoolProperty(name="Материалы старого", default=False,
                                           description="Надеть на новую модель материалы заменяемого объекта")

    def execute(self, context):
        hidden = _hidden()
        targets = [o for o in context.selected_objects if not (hidden and o.name in hidden.objects)]
        if not targets:
            self.report({"WARNING"}, _t("Выделите в сцене то, что заменить"))
            return {"CANCELLED"}
        path = self.filepath
        if not path:
            if _no_token(self):
                return {"CANCELLED"}
            try:
                path = _first_selected_model()
            except Exception as e:
                _explain(self, e)
                return {"CANCELLED"}
            if not path:
                self.report({"WARNING"}, _t("Выделите модель в Oddments"))
                return {"CANCELLED"}
        name = self.name or os.path.splitext(os.path.basename(path))[0]
        try:
            new = _import_objects(path)
        except Exception as e:
            self.report({"ERROR"}, _t("Не вставилось: %s") % e)
            return {"CANCELLED"}
        sets = [new] + [_copy_tree(new) for _ in targets[1:]]
        done = []
        for old, objs in zip(targets, sets):
            done.append(swap_object(old, objs, name, self.fit, self.keep_materials, context.scene))
        _drop_empty_new_collections()
        _select_only(context, done)
        self.report({"INFO"}, _t("Заменено на «%s»: %d") % (name, len(done)))
        return {"FINISHED"}


class PERCH_OT_place(bpy.types.Operator):
    bl_idname = "perch.place"
    bl_label = "Вставить у 3D-курсора"
    bl_options = {"REGISTER", "UNDO"}

    filepath: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})
    name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    def execute(self, context):
        try:
            new = _import_objects(self.filepath)
        except Exception as e:
            self.report({"ERROR"}, _t("Не вставилось: %s") % e)
            return {"CANCELLED"}
        root = _group(new, self.name or "Oddments")
        context.view_layer.update()
        root.matrix_world = Matrix.Translation(context.scene.cursor.location) @ root.matrix_world
        _drop_empty_new_collections()
        _select_only(context, [root])
        self.report({"INFO"}, _t("Вставлено: %s") % (self.name or root.name))
        return {"FINISHED"}


# ---------- the Oddments browser: our own interface over the 3D view ----------
# Drawn with gpu + blf in the viewport (a draw handler) and driven by a modal operator: Oddments' look (Марафон: near
# black glass, lime accent, pills, mono caps), hover, tooltips with animated hints, smooth scrolling. Events over the
# panel are ours; everywhere else they go to Blender as usual. Thumbnails and files come from Oddments' receiver
# (/items, /file) on a background thread, bpy is touched only on the main thread.
LIME = (0.776, 1.0, 0.0, 1.0)
MAGENTA = (1.0, 0.176, 0.435, 1.0)
INK = (0.95, 0.95, 0.93, 1.0)
DIM = (0.66, 0.66, 0.64, 1.0)
FAINT = (1.0, 1.0, 1.0, 0.07)
GLASS = (0.047, 0.047, 0.055, 0.95)
BLACK = (0.0, 0.0, 0.0, 1.0)

_UI = {"shader": None, "white": None, "mono": None, "thumbs": {}, "op": None}


def _shader():
    if _UI["shader"]:
        return _UI["shader"]
    iface = gpu.types.GPUStageInterfaceInfo("perch_rr")
    iface.smooth("VEC2", "loc")
    iface.smooth("VEC2", "uv")
    info = gpu.types.GPUShaderCreateInfo()
    info.push_constant("MAT4", "ModelViewProjectionMatrix")
    info.push_constant("VEC4", "rect")    # x, y, w, h (px)
    info.push_constant("VEC4", "color")
    info.push_constant("VEC4", "params")  # radius, texture on, ring width (0 = filled), softness
    info.sampler(0, "FLOAT_2D", "image")
    info.vertex_in(0, "VEC2", "pos")
    info.vertex_in(1, "VEC2", "texco")
    info.vertex_out(iface)
    info.fragment_out(0, "VEC4", "FragColor")
    info.vertex_source("void main() { loc = pos; uv = texco; gl_Position = ModelViewProjectionMatrix * vec4(pos, 0.0, 1.0); }")
    info.fragment_source(
        "float sdr(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + vec2(r); return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }\n"
        "void main() {\n"
        "  float r = min(params.x, min(rect.z, rect.w) * 0.5);\n"
        "  float d = sdr(loc - rect.xy - rect.zw * 0.5, rect.zw * 0.5, r);\n"
        "  float s = max(params.w, 1.0);\n"
        "  float a = clamp(0.5 - d / s, 0.0, 1.0);\n"
        "  if (params.z > 0.0) a *= clamp(0.5 + d + params.z, 0.0, 1.0);\n"
        "  vec4 c = color;\n"
        "  if (params.y > 0.5) c = texture(image, uv) * color;\n"
        "  if (c.a * a < 0.002) discard;\n"
        "  FragColor = vec4(c.rgb, c.a * a);\n"
        "}\n")
    _UI["shader"] = gpu.shader.create_from_info(info)
    buf = gpu.types.Buffer("FLOAT", 4, [1.0, 1.0, 1.0, 1.0])
    _UI["white"] = gpu.types.GPUTexture((1, 1), format="RGBA8", data=buf)
    return _UI["shader"]


def _lin(c):
    """Our colours are sRGB (as in Oddments' CSS); the 3D view's frame is linear and encodes on output."""
    return (_srgb2lin(c[0]), _srgb2lin(c[1]), _srgb2lin(c[2]), c[3])


def _rect(x, y, w, h, color, radius=0.0, tex=None, ring=0.0, soft=1.0, uv=(0.0, 0.0, 1.0, 1.0), grow=0.0):
    if w <= 0 or h <= 0 or color[3] <= 0.003:
        return
    sh = _shader()
    e = grow + soft
    u0, v0, u1, v1 = uv
    pos = ((x - e, y - e), (x + w + e, y - e), (x + w + e, y + h + e), (x - e, y + h + e))
    # texture coordinates follow the grown quad so the picture is not stretched
    du, dv = (u1 - u0) / w, (v1 - v0) / h
    tc = tuple((u0 + (px - x) * du, v0 + (py - y) * dv) for px, py in pos)
    batch = batch_for_shader(sh, "TRI_FAN", {"pos": pos, "texco": tc})
    gpu.state.blend_set("ALPHA")  # blf switches blending off after each text
    sh.bind()
    sh.uniform_float("rect", (x, y, w, h))
    sh.uniform_float("color", color if tex else _lin(color))
    sh.uniform_float("params", (radius, 1.0 if tex else 0.0, ring, soft))
    sh.uniform_sampler("image", tex or _UI["white"])
    batch.draw(sh)


def _font(mono=False):
    if not mono:
        return 0
    if _UI["mono"] is None:
        _UI["mono"] = 0
        try:
            p = os.path.join(bpy.utils.system_resource("DATAFILES"), "fonts", "DejaVuSansMono.woff2")
            if os.path.exists(p):
                fid = blf.load(p)
                _UI["mono"] = fid if fid >= 0 else 0
        except Exception:
            pass
    return _UI["mono"]


def _text(x, y, s, size, color, mono=False, maxw=0.0, center=False, right=False):
    f = _font(mono)
    blf.size(f, size)
    if maxw and blf.dimensions(f, s)[0] > maxw:
        while s and blf.dimensions(f, s + "…")[0] > maxw:
            s = s[:-1]
        s = s.rstrip() + "…"
    w = blf.dimensions(f, s)[0]
    if center:
        x -= w / 2
    elif right:
        x -= w
    blf.color(f, *_lin(color))
    blf.position(f, x, y, 0)
    blf.draw(f, s)
    return w


def _tw(s, size, mono=False):
    f = _font(mono)
    blf.size(f, size)
    return blf.dimensions(f, s)[0]


def _wrap(s, size, width):
    lines, line = [], ""
    for word in s.split():
        t = (line + " " + word).strip()
        if line and _tw(t, size) > width:
            lines.append(line)
            line = word
        else:
            line = t
    if line:
        lines.append(line)
    return lines


def _mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def _alpha(c, k):
    return (c[0], c[1], c[2], c[3] * k)


def _ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


class _Fetcher:
    """Downloads on a background thread (thumbnails, files); results are picked up by the modal timer."""

    def __init__(self, base, token):
        self.base, self.token = base, token
        self.jobs, self.done = queue.Queue(), queue.Queue()
        self.stop = False
        self.cache = os.path.join(tempfile.gettempdir(), "oddments-blender")
        threading.Thread(target=self.run, daemon=True).start()

    def get(self, kind, key, rel):
        self.jobs.put((kind, key, rel))

    def run(self):
        while not self.stop:
            try:
                kind, key, rel = self.jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            sub = "thumbs" if kind == "thumb" else "files"
            dest = os.path.join(self.cache, sub, key + "-" + os.path.basename(rel))
            try:
                if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    q = urllib.parse.urlencode({"token": self.token, "path": rel})
                    with _open("%s/file?%s" % (self.base, q), timeout=120) as r, open(dest + ".part", "wb") as f:
                        shutil.copyfileobj(r, f, 1 << 20)
                    os.replace(dest + ".part", dest)
                self.done.put((kind, key, dest, None))
            except Exception as e:
                self.done.put((kind, key, None, e))


def _thumb_texture(key, path):
    """bpy image → GPU texture (main thread). Images are named with a leading dot and have no users: not saved."""
    name = ".perch-" + key
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(path, check_existing=False)
        img.name = name
    tex = gpu.texture.from_image(img)
    _UI["thumbs"][key] = (tex, img.size[0] or 1, img.size[1] or 1)


def _drop_thumbs():
    _UI["thumbs"].clear()
    for img in [i for i in bpy.data.images if i.name.startswith(".perch-")]:
        try:
            bpy.data.images.remove(img)
        except Exception:
            pass


# ---------- SVG → 3D: icon sets ----------
# The mesh is made by Oddments itself (the same generator as its «SVG в 3D» window; bridge POST /mesh): clean quads,
# a safe bevel, UVs laid out from the shape and a part per face — front, back, bevel, wall, one material slot each.
# The add-on asks for every icon of a set with ONE style (depth, bevel, rounding, segments, slot materials), in the
# drawing's own frame: icons of a 24 px set come out the same size and depth. Each object remembers its source
# (custom property «perch_icon»): «Обновить» re-makes the mesh with the current style and keeps the object, its
# modifiers and its materials. Styles are JSON files in <library folder>/icon-styles (a shared folder — the team's).
ICON_PARTS = ("Лицо", "Тыл", "Фаска", "Стенка")
ICON_KEY = "perch_icon"
ICON_STYLE_DEF = {"depth": 0.24, "bevel": 0.04, "round": 0.0, "bseg": 3, "sseg": 1, "dens": 18, "fix": True, "mats": {}}
ICON_SCALE = 0.5  # the generator's frame is 2 units wide: an icon is 1 m across
ICON_STEP = 1.35  # grid step of a set, in metres
ICON_COLS = 8
_PART_COLORS = ((0.92, 0.92, 0.9), (0.5, 0.5, 0.5), (0.8, 0.8, 0.78), (0.62, 0.62, 0.6))


def _styles_dir(create=False):
    d = os.path.join(matlib_dir(create=create), "icon-styles")
    if create:
        os.makedirs(d, exist_ok=True)
    return d


def icon_style_names():
    d = _styles_dir()
    if not os.path.isdir(d):
        return []
    return sorted((os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith(".json")), key=str.lower)


def load_icon_style(name):
    with open(os.path.join(_styles_dir(), _file_name(name) + ".json"), encoding="utf-8") as f:
        st = json.load(f)
    out = dict(ICON_STYLE_DEF)
    out.update({k: st[k] for k in ICON_STYLE_DEF if k in st})
    out["name"] = name
    return out


def save_icon_style(name, st):
    data = {k: st.get(k, ICON_STYLE_DEF[k]) for k in ICON_STYLE_DEF}
    with open(os.path.join(_styles_dir(create=True), _file_name(name) + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def current_icon_style():
    try:
        st = json.loads(_prefs().icon_style or "{}")
    except Exception:
        st = {}
    out = dict(ICON_STYLE_DEF)
    out.update(st)
    return out


def set_icon_style(st):
    _prefs().icon_style = json.dumps(st, ensure_ascii=False)


def icon_set_name(st):
    return st.get("name") or "Набор"  # not translated: the set's key must not change with the language


def icon_style_changed(st):
    """True when the style differs from the saved file of the same name (the set's style was changed here)."""
    if not st.get("name"):
        return False
    try:
        saved = load_icon_style(st["name"])
    except Exception:
        return True
    return any(saved.get(k) != st.get(k) for k in ICON_STYLE_DEF)


def _icon_meta(ob):
    try:
        return json.loads(ob.get(ICON_KEY) or "{}")
    except Exception:
        return {}


def icon_objects(scene, set_name=None):
    out = []
    for o in scene.objects:
        if o.type == "MESH" and o.get(ICON_KEY):
            if set_name is None or _icon_meta(o).get("set") == set_name:
                out.append(o)
    return out


def _part_material(i, st):
    want = (st.get("mats") or {}).get(ICON_PARTS[i])
    if want:
        try:
            return material_from_library(want)
        except Exception as e:
            print("Oddments: материал слота не найден", want, e)
    name = "Oddments · " + ICON_PARTS[i]
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        if not m.node_tree:
            m.use_nodes = True
        c = _PART_COLORS[i]
        m.diffuse_color = (c[0], c[1], c[2], 1.0)
        b = _principled(m)
        if b:
            b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1.0)
            r = _input(b, "Roughness")
            if r:
                r.default_value = 0.35
    return m


def icon_mesh(name, data, bseg=3):
    """{v, f, p, uv} from the generator → a Blender mesh: standing up, facing the front view (−Y), 1 m per frame."""
    v, k = data["v"], ICON_SCALE
    verts = [(v[i] * k, -v[i + 2] * k, v[i + 1] * k) for i in range(0, len(v), 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], data["f"])
    flat = [c for cs in data.get("uv") or [] for c in cs]
    if len(flat) == 2 * len(me.loops):
        me.uv_layers.new(name="UVMap").data.foreach_set("uv", flat)
    parts = data.get("p") or []
    for _ in ICON_PARTS:
        me.materials.append(None)
    if len(parts) == len(me.polygons):
        me.polygons.foreach_set("material_index", parts)
    angle = math.radians(min(60.0, max(30.0, 90.0 / max(1, bseg) + 6)))
    me.shade_smooth()
    me.set_sharp_from_angle(angle=angle)
    # seams exactly where the UV islands split: the layout reads in the UV editor, and a re-unwrap keeps it
    if me.uv_layers:
        bm = bmesh.new()
        bm.from_mesh(me)
        uv = bm.loops.layers.uv.active
        for e in bm.edges:
            if len(e.link_loops) == 2:
                l0, l1 = e.link_loops
                e.seam = (l0[uv].uv - l1.link_loop_next[uv].uv).length > 1e-5 or (l0.link_loop_next[uv].uv - l1[uv].uv).length > 1e-5
        bm.to_mesh(me)
        bm.free()
    me.update()
    if len(parts) == len(me.polygons):
        flat_caps(me, [x in (0, 1) for x in parts], angle)  # parts 0 / 1: the front and the back cap
    return me


def icon_collection(scene, set_name):
    name = "Icons · " + set_name
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
    if c.name not in scene.collection.children and not any(c.name in x.children for x in bpy.data.collections):
        scene.collection.children.link(c)
    return c


def place_icon(scene, res, meta, st):
    """One icon into the set: an object of the same source and set gets the new mesh (live link), else a new one
    goes to the set's grid. → (object, made_new)"""
    set_name = icon_set_name(st)
    meta = dict(meta, set=set_name)
    key = meta.get("id") or meta.get("name")
    name = meta.get("name") or "Icon"
    me = icon_mesh(name, res["mesh"], int(st.get("bseg") or 3))
    for o in icon_objects(scene, set_name):
        m0 = _icon_meta(o)
        if (m0.get("id") or m0.get("name")) == key:
            old = o.data
            for i, m in enumerate(old.materials[:len(ICON_PARTS)]):
                me.materials[i] = m  # the materials stay as the designer left them
            o.data = me
            o[ICON_KEY] = json.dumps(meta, ensure_ascii=False)
            if old.users == 0:
                bpy.data.meshes.remove(old)
            return o, False
    for i in range(len(ICON_PARTS)):
        me.materials[i] = _part_material(i, st)
    coll = icon_collection(scene, set_name)
    n = sum(1 for o in coll.objects if o.get(ICON_KEY))
    ob = bpy.data.objects.new(name, me)
    ob[ICON_KEY] = json.dumps(meta, ensure_ascii=False)
    r, c = divmod(n, ICON_COLS)
    ob.location = scene.cursor.location + Vector((c * ICON_STEP, 0.0, -r * ICON_STEP))
    coll.objects.link(ob)
    return ob, True


def set_slot_material(scene, st, i, name):
    """A material of the add-on's library into slot i of the style and of every icon of the set in the scene."""
    mats = dict(st.get("mats") or {})
    if name:
        mats[ICON_PARTS[i]] = name
    else:
        mats.pop(ICON_PARTS[i], None)
    st["mats"] = mats
    set_icon_style(st)
    mat = _part_material(i, st)
    n = 0
    for o in icon_objects(scene, icon_set_name(st)):
        if len(o.data.materials) > i:
            o.data.materials[i] = mat
            n += 1
    return n


def import_icon_set(path):
    """A .perchicons file from Oddments («Набор в Blender»): {set, style, icons: [{name, id, file, mesh}]}."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    st = dict(ICON_STYLE_DEF)
    st.update(data.get("style") or {})
    if data.get("set"):
        st["name"] = data["set"]
    scene = bpy.context.scene
    made = 0
    for ic in data.get("icons") or []:
        if ic.get("mesh"):
            place_icon(scene, {"mesh": ic["mesh"]}, {k: ic.get(k) for k in ("id", "name", "file")}, st)
            made += 1
    bpy.ops.ed.undo_push(message="Oddments: иконки")
    return made


class _IconJobs:
    """SVG → mesh requests on a background thread: the SVG (downloaded from the library unless given) goes to
    Oddments' /mesh, the answer is picked up by the browser's timer and built on the main thread."""

    def __init__(self, base, token):
        self.base, self.token = base, token
        self.jobs, self.done = queue.Queue(), queue.Queue()
        self.stop = False
        threading.Thread(target=self.run, daemon=True).start()

    def add(self, meta, style, svg=None):
        self.jobs.put((meta, style, svg))

    def run(self):
        while not self.stop:
            try:
                meta, style, svg = self.jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                if svg is None:
                    q = urllib.parse.urlencode({"token": self.token, "path": meta["file"]})
                    with _open("%s/file?%s" % (self.base, q), timeout=30) as r:
                        svg = r.read().decode("utf-8", "replace")
                body = json.dumps({"svg": svg, "name": meta.get("name"), "style": {k: style[k] for k in ICON_STYLE_DEF if k != "mats"}}).encode()
                req = urllib.request.Request("%s/mesh?%s" % (self.base, urllib.parse.urlencode({"token": self.token})), data=body,
                                             method="POST", headers={"Content-Type": "application/json"})
                with _open(req, timeout=90) as r:
                    res = json.loads(r.read().decode())
                self.done.put((meta, style, res, None if res.get("mesh") else res.get("error") or "?"))
            except Exception as e:
                self.done.put((meta, style, None, e))


def _look_at(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


class PERCH_OT_render_icons(bpy.types.Operator):
    bl_idname = "perch.render_icons"
    bl_label = "Рендер иконок в Oddments"
    bl_description = ("Каждая иконка набора (выделенные, иначе все) — отдельным PNG с прозрачным фоном, анфас, камерой "
                      "по размеру иконки — и в библиотеку Oddments. Нет света в сцене — ставится временная студия")
    size: bpy.props.IntProperty(name="Размер", default=1024, min=64, max=4096)

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        sc = context.scene
        objs = [o for o in context.selected_objects if o.get(ICON_KEY)] or icon_objects(sc)
        if not objs:
            self.report({"WARNING"}, _t("В сцене нет иконок Oddments"))
            return {"CANCELLED"}
        r = sc.render
        keep = (sc.camera, r.film_transparent, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
                r.image_settings.file_format, r.image_settings.color_mode)
        hide = {o: o.hide_render for o in sc.objects}
        cam = bpy.data.objects.new(".perch-cam", bpy.data.cameras.new(".perch-cam"))
        cam.data.type = "ORTHO"
        sc.collection.objects.link(cam)
        temp = [cam]
        studio = not any(o.type == "LIGHT" and not o.hide_render for o in sc.objects)
        if studio:  # key, fill and rim, removed afterwards
            for nm, power, size in (("key", 600, 3.0), ("fill", 200, 4.0), ("rim", 400, 2.0)):
                ld = bpy.data.lights.new(".perch-" + nm, "AREA")
                ld.energy, ld.size = power, size
                lo = bpy.data.objects.new(".perch-" + nm, ld)
                sc.collection.objects.link(lo)
                temp.append(lo)
        out = os.path.join(tempfile.gettempdir(), "oddments-blender", "renders")
        os.makedirs(out, exist_ok=True)
        sent, failed = 0, []
        try:
            sc.camera = cam
            r.film_transparent = True
            r.resolution_x = r.resolution_y = self.size
            r.resolution_percentage = 100
            r.image_settings.file_format = "PNG"
            r.image_settings.color_mode = "RGBA"
            for ob in objs:
                for o in sc.objects:
                    if o.type not in {"LIGHT", "CAMERA"}:
                        o.hide_render = o is not ob
                pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
                lo_, hi_ = Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])
                c, size = (lo_ + hi_) / 2, hi_ - lo_
                cam.location = (c.x, lo_.y - 10.0, c.z)
                cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
                cam.data.ortho_scale = max(size.x, size.z) * 1.16 or 1.0
                cam.data.clip_end = 100.0
                if studio:
                    d = max(size.x, size.z) * 3 + 2
                    for lo, off in zip(temp[1:], ((-0.8, -1.0, 0.9), (1.0, -0.9, -0.1), (0.2, 1.0, 1.0))):
                        lo.location = c + Vector(off) * d
                        _look_at(lo, c)
                png = os.path.join(out, _file_name(ob.name) + ".png")
                r.filepath = png
                bpy.ops.render.render(write_still=True)
                try:
                    _send(png, ob.name + " · 3D.png")
                    sent += 1
                except Exception as e:
                    failed.append("%s: %s" % (ob.name, e))
        finally:
            for o, h in hide.items():
                try:
                    o.hide_render = h
                except ReferenceError:
                    pass
            (sc.camera, r.film_transparent, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
             r.image_settings.file_format, r.image_settings.color_mode) = keep
            for o in temp:
                data = o.data
                bpy.data.objects.remove(o)
                if isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
                else:
                    bpy.data.lights.remove(data)
        if failed:
            self.report({"WARNING"}, _t("В Oddments: %d, не получилось: %s") % (sent, "; ".join(failed)[:200]))
        else:
            self.report({"INFO"}, _t("Рендеры иконок в Oddments: %d") % sent)
        return {"FINISHED"}


# ---------- Gaussian splat in Cycles quality ----------
# Oddments makes a splat from a model without training: its points lie on the surface and their colours come from views
# of it. Here the views are Cycles renders of the selection — the scene's own materials (procedural too) and light,
# reflections and shadows included. The same 64 cameras as in the app (a Fibonacci sphere, 35°, square), one render per
# timer tick so Blender stays alive (Esc stops). The geometry goes as GLB (world transforms applied), the cameras in glTF's
# frame (Y up) in cameras.json, everything zipped into «<name>.oddsplatviews» and sent to Oddments, which builds the splat.
SPLAT_FOV = 35.0
SPLAT_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
_SPLAT_PACK = {"path": ""}


def _fib_dirs(k):
    """Directions evenly over a sphere, in glTF's frame — exactly the app's sphereDirs()."""
    ga = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(k):
        y = 1 - ((i + 0.5) / k) * 2
        r = math.sqrt(max(0.0, 1 - y * y))
        out.append((math.cos(i * ga) * r, y, math.sin(i * ga) * r))
    return out


def _gl_to_bl(v):
    """glTF (Y up) → Blender (Z up): (x, y, z) → (x, −z, y), the same turn the glTF exporter makes the other way."""
    return Vector((v[0], -v[2], v[1]))


def _bl_to_gl(v):
    return [v.x, v.z, -v.y]


class PERCH_OT_splat_cycles(bpy.types.Operator):
    bl_idname = "perch.splat_cycles"
    bl_label = "Сплат в Oddments (Cycles)"
    bl_description = ("Выделенное — в гауссов сплат с качеством Cycles: 64 рендера со всех сторон с материалами и светом "
                      "сцены, Oddments раскладывает их цвет по поверхности. Несколько минут; Esc — остановить")
    views: bpy.props.IntProperty(name="Ракурсов", default=64, min=16, max=256)
    size: bpy.props.IntProperty(name="Размер рендера", default=768, min=256, max=2048)
    samples: bpy.props.IntProperty(name="Сэмплов", default=64, min=4, max=4096)
    # tests: only build the zip (its path in _SPLAT_PACK), send nothing, keep the folder
    pack_only: bpy.props.BoolProperty(default=False, options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return any(o.type in SPLAT_TYPES for o in context.selected_objects)

    def invoke(self, context, event):
        if _no_token(self):
            return {"CANCELLED"}
        if not self.prepare(context):
            return {"CANCELLED"}
        wm = context.window_manager
        self.timer = wm.event_timer_add(0.05, window=context.window)
        wm.modal_handler_add(self)
        wm.progress_begin(0, self.views)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        """Without a window (a script, a test): all views in one go."""
        if not self.prepare(context):
            return {"CANCELLED"}
        try:
            while self.i < self.views:
                self.render_next(context)
            self.send(context)
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        finally:
            self.finish(context)
        self.report({"INFO"}, _t("Сплат «%s» собирается в Oddments") % self.title)
        return {"FINISHED"}

    def prepare(self, context):
        sc, r = context.scene, context.scene.render
        self.timer = None
        self.objs = [o for o in context.selected_objects if o.type in SPLAT_TYPES]
        if not self.objs:
            return False
        self.title = (context.active_object if context.active_object in self.objs else self.objs[0]).name
        dg = context.evaluated_depsgraph_get()
        pts = [o.matrix_world @ Vector(c) for o in self.objs for c in o.evaluated_get(dg).bound_box]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        self.center = (lo + hi) / 2
        self.radius = max((p - self.center).length for p in pts) or 1.0
        self.dist = self.radius * 1.08 / math.sin(math.radians(SPLAT_FOV) / 2)
        self.dir = tempfile.mkdtemp(prefix="oddments-splat-")
        try:
            known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
            opts = dict(export_format="GLB", use_selection=True, export_apply=True, export_cameras=False, export_lights=False,
                        export_materials="NONE", export_texcoords=False, export_normals=True)
            with _Keep():
                for o in context.view_layer.objects:
                    o.select_set(o in self.objs)
                bpy.ops.export_scene.gltf(filepath=os.path.join(self.dir, "model.glb"), **{k: v for k, v in opts.items() if k in known})
        except Exception as e:
            shutil.rmtree(self.dir, ignore_errors=True)
            _explain(self, e)
            return False
        cy = getattr(sc, "cycles", None)
        self.keep = (sc.camera, r.engine, r.film_transparent, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
                     r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.color_depth)
        self.keep_cy = (cy.samples, cy.use_denoising) if cy else None
        self.hide = {o: o.hide_render for o in sc.objects}
        for o in sc.objects:
            if o.type not in {"LIGHT", "CAMERA"} and o not in self.objs:
                o.hide_render = True  # only the selection is seen; the scene's lights and world stay
        cam = bpy.data.objects.new(".oddments-splat-cam", bpy.data.cameras.new(".oddments-splat-cam"))
        cam.data.lens_unit = "FOV"
        cam.data.angle = math.radians(SPLAT_FOV)
        cam.data.sensor_fit = "AUTO"
        cam.data.clip_start = max(1e-4, self.dist - self.radius * 1.3)
        cam.data.clip_end = self.dist + self.radius * 1.3
        sc.collection.objects.link(cam)
        self.cam = cam
        sc.camera = cam
        r.engine = "CYCLES"
        r.film_transparent = True
        r.resolution_x = r.resolution_y = self.size
        r.resolution_percentage = 100
        r.image_settings.file_format = "PNG"
        r.image_settings.color_mode = "RGBA"
        r.image_settings.color_depth = "8"
        if cy:
            cy.samples = self.samples
            cy.use_denoising = True
        self.dirs, self.cams, self.i = _fib_dirs(self.views), [], 0
        return True

    def render_next(self, context):
        d = self.dirs[self.i]
        # the camera as three.js's lookAt makes it: z back from the target, x = up × z, y = z × x
        up_gl = (1.0, 0.0, 0.0) if abs(d[1]) > 0.99 else (0.0, 1.0, 0.0)
        pos = self.center + _gl_to_bl(d) * self.dist
        z = (pos - self.center).normalized()
        x = _gl_to_bl(up_gl).cross(z).normalized()
        y = z.cross(x)
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = pos
        self.cam.matrix_world = m
        png = os.path.join(self.dir, "v%03d.png" % self.i)
        context.scene.render.filepath = png
        bpy.ops.render.render(write_still=True)
        self.cams.append({"pos": _bl_to_gl(pos), "target": _bl_to_gl(self.center), "up": list(up_gl), "file": os.path.basename(png)})
        self.i += 1

    def _status(self, context, text):
        try:
            context.workspace.status_text_set(text)
        except Exception:
            pass

    def modal(self, context, event):
        if event.type == "ESC":
            self.finish(context)
            self.report({"WARNING"}, _t("Сплат остановлен"))
            return {"CANCELLED"}
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
        if self.i < self.views:
            self.render_next(context)
            context.window_manager.progress_update(self.i)
            self._status(context, _t("Oddments: сплат (Cycles) · ракурс %d из %d · Esc — остановить") % (self.i, self.views))
            return {"RUNNING_MODAL"}
        try:
            self.send(context)
        except Exception as e:
            self.finish(context)
            _explain(self, e)
            return {"CANCELLED"}
        self.finish(context)
        self.report({"INFO"}, _t("Сплат «%s» собирается в Oddments") % self.title)
        return {"FINISHED"}

    def send(self, context):
        meta = {"oddsplatviews": 1, "name": self.title, "fov": SPLAT_FOV, "size": self.size, "samples": self.samples,
                "engine": "CYCLES", "blender": bpy.app.version_string,
                "sphere": {"center": _bl_to_gl(self.center), "radius": self.radius}, "views": self.cams}
        with open(os.path.join(self.dir, "cameras.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f)
        pack = os.path.join(self.dir, _file_name(self.title) + ".oddsplatviews")
        with zipfile.ZipFile(pack, "w", zipfile.ZIP_STORED) as z:  # PNGs are compressed already
            for fn in ["cameras.json", "model.glb"] + [c["file"] for c in self.cams]:
                z.write(os.path.join(self.dir, fn), fn)
        if self.pack_only:
            _SPLAT_PACK["path"] = pack
            return
        _send(pack, self.title + ".oddsplatviews")

    def finish(self, context):
        wm = context.window_manager
        if self.timer:
            wm.event_timer_remove(self.timer)
            self.timer = None
            wm.progress_end()
            self._status(context, None)
        sc, r = context.scene, context.scene.render
        for o, h in self.hide.items():
            try:
                o.hide_render = h
            except ReferenceError:
                pass
        (sc.camera, r.engine, r.film_transparent, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath,
         r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.color_depth) = self.keep
        if self.keep_cy:
            sc.cycles.samples, sc.cycles.use_denoising = self.keep_cy
        data = self.cam.data
        bpy.data.objects.remove(self.cam)
        bpy.data.cameras.remove(data)
        if not self.pack_only:
            shutil.rmtree(self.dir, ignore_errors=True)


class PERCH_OT_icon_style_save(bpy.types.Operator):
    bl_idname = "perch.icon_style_save"
    bl_label = "Сохранить стиль набора"
    bl_description = "Глубина, фаска, скругление, сегменты и материалы слотов — файлом в библиотеке (в общей папке — для всей команды)"
    name: bpy.props.StringProperty(name="Название", default="")

    def invoke(self, context, event):
        self.name = current_icon_style().get("name") or "Набор"
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        n = _file_name(self.name.strip() or "Набор")
        st = current_icon_style()
        old = icon_set_name(st)
        save_icon_style(n, st)
        st["name"] = n
        set_icon_style(st)
        if old != n:
            for o in icon_objects(context.scene, old):
                m = _icon_meta(o)
                m["set"] = n
                o[ICON_KEY] = json.dumps(m, ensure_ascii=False)
            c = bpy.data.collections.get("Icons · " + old)
            if c and not bpy.data.collections.get("Icons · " + n):
                c.name = "Icons · " + n
        self.report({"INFO"}, _t("Стиль «%s» сохранён") % n)
        return {"FINISHED"}


MAKE_TIP = ("В 3D", "Выбранные SVG становятся моделями одного стиля: чистые квады, фаска без самопересечений, UV по форме, "
            "слоты материалов лицо / тыл / фаска / стенка. Иконки встают сеткой в коллекцию «Icons · стиль». "
            "Уже сделанные из того же SVG — обновляются на месте.", None)
UPD_TIP = ("Обновить набор", "Пересобрать все иконки набора в сцене текущим стилем. Объекты, модификаторы и материалы остаются — "
           "меняется только сетка. Ползунки стиля обновляют набор сами.", None)
RENDER_TIP = ("Рендер в Oddments", "Каждая иконка — PNG 1024 с прозрачным фоном, анфас, в библиотеку Oddments. Свет — "
              "ваш (или пресет из «Ещё»); если света в сцене нет, ставится временная студия.", None)
SLOT_TIP = "Нажмите и выберите материал из библиотеки аддона — он ляжет на эту часть всех иконок набора."
SLOT_PUT_TIP = ("В слот", "Материал — в слот стиля и на эту часть всех иконок набора в сцене.", None)
SLOT_CLEAR_TIP = ("Без материала", "Слот вернётся к простому серому материалу Oddments.", None)
STYLE_TIP = ("Стиль набора", "Сохранённые стили — в папке библиотеки, «icon-styles» (общая папка — у всей команды один стиль). "
             "< > переключают стиль; точка — стиль изменён и не сохранён.", None)
FIX_TIP = ("Исправлять SVG", "Перед 3D Oddments чинит точки SVG: шум и лишние точки, изломы, почти прямые линии, самопересечения, "
           "наложения фигур, обводки → контуры. Вид иконки не меняется, сам файл SVG тоже.", None)
STYLE_SAVE_TIP = ("Сохранить стиль", "Глубина, фаска, скругление, сегменты и материалы слотов — файлом стиля.", None)
STEP_TIPS = {
    "depth": ("Глубина", "Толщина иконки, в процентах от её кадра (у 24 px — от 24 px). Колесо мыши тоже меняет.", None),
    "bevel": ("Фаска", "Ширина скругления края. В тонких местах сама уменьшается, чтобы не было самопересечений.", None),
    "round": ("Скругление углов", "Острые углы контура становятся плавными изгибами.", None),
    "bseg": ("Сегменты фаски", "Сколько петель в скруглении края: больше — глаже на рендере.", None),
}
# English for the icon sets and the panel's tabs (the long hints are keyed by their own text)
EN.update({
    MAKE_TIP[0]: "To 3D", MAKE_TIP[1]: "The chosen SVGs become models of one style: clean quads, a bevel without self-intersections, UVs by the shape, "
    "material slots front / back / bevel / wall. The icons line up in a grid in the collection «Icons · style». "
    "Ones already made from the same SVG are updated in place.",
    UPD_TIP[0]: "Update the set", UPD_TIP[1]: "Rebuild every icon of the set in the scene with the current style. Objects, modifiers and materials stay — "
    "only the mesh changes. The style's values update the set by themselves.",
    RENDER_TIP[0]: "Render to Oddments", RENDER_TIP[1]: "Every icon as a 1024 PNG with a transparent background, front view, into the Oddments library. "
    "The light is yours (or a preset from «More»); with no light in the scene a temporary studio is set up.",
    SLOT_TIP: "Click and choose a material from the add-on's library — it goes onto this part of every icon of the set.",
    SLOT_PUT_TIP[0]: "Into the slot", SLOT_PUT_TIP[1]: "The material goes into the style's slot and onto this part of every icon of the set in the scene.",
    SLOT_CLEAR_TIP[0]: "No material", SLOT_CLEAR_TIP[1]: "The slot goes back to the plain grey Oddments material.",
    STYLE_TIP[0]: "Style of the set", STYLE_TIP[1]: "Saved styles are in the library folder, «icon-styles» (a shared folder — one style for the whole team). "
    "< > switch the style; a dot — the style was changed and not saved.",
    FIX_TIP[0]: "Clean SVG", FIX_TIP[1]: "Before 3D Oddments mends the SVG's points: noise and extra points, kinks, almost straight lines, "
    "self-crossings, overlapping shapes, strokes → outlines. The icon looks the same, the SVG file itself is not changed.",
    "ИСПРАВЛЯТЬ SVG": "CLEAN SVG", "ВКЛ": "ON", "ВЫКЛ": "OFF",
    STYLE_SAVE_TIP[0]: "Save the style", STYLE_SAVE_TIP[1]: "Depth, bevel, rounding, segments and slot materials as a style file.",
    "Глубина": "Depth", "Толщина иконки, в процентах от её кадра (у 24 px — от 24 px). Колесо мыши тоже меняет.": "The icon's thickness in percent of its frame (24 px for a 24 px icon). The mouse wheel changes it too.",
    "Фаска": "Bevel", "Ширина скругления края. В тонких местах сама уменьшается, чтобы не было самопересечений.": "The width of the rounded edge. It shrinks by itself in thin places, so nothing self-intersects.",
    "Скругление углов": "Corner rounding", "Острые углы контура становятся плавными изгибами.": "Sharp corners of the outline become smooth bends.",
    "Сегменты фаски": "Bevel segments", "Сколько петель в скруглении края: больше — глаже на рендере.": "How many loops in the rounded edge: more — smoother on a render.",
    "ГЛУБИНА": "DEPTH", "ФАСКА": "BEVEL", "СКРУГЛЕНИЕ": "ROUNDING", "СЕГМЕНТЫ": "SEGMENTS", "НЕТ": "NONE",
    "Лицо": "Front", "Тыл": "Back", "Стенка": "Wall",
    "Рендер иконок в Oddments": "Render the icons to Oddments",
    PERCH_OT_render_icons.bl_description: "Every icon of the set (the selected ones, else all) as its own PNG with a transparent background, front view, "
    "the camera fitted to the icon — into the Oddments library. No light in the scene — a temporary studio is set up",
    "Размер": "Size", "В сцене нет иконок Oddments": "There are no Oddments icons in the scene", "Рендеры иконок в Oddments: %d": "Icon renders in Oddments: %d",
    "Сохранить стиль набора": "Save the set's style",
    "Глубина, фаска, скругление, сегменты и материалы слотов — файлом в библиотеке (в общей папке — для всей команды)": "Depth, bevel, rounding, segments and slot materials as a file in the library (in a shared folder — for the whole team)",
    "Набор": "Set", "Стиль «%s» сохранён": "Style «%s» saved", "Стиль набора иконок": "Icon set style",
    "Открыть Oddments": "Open Oddments", "Закрыть Oddments": "Close Oddments",
    "Модели, материалы, иконки, всё остальное — в панели во вьюпорте · Ctrl+Shift+P": "Models, materials, icons, everything else — in the panel in the viewport · Ctrl+Shift+P",
    "Все команды списком": "All commands as a list", "Иконки:": "Icons:",
    "НА СВЯЗИ": "CONNECTED", "БЕЗ ПРИЛОЖЕНИЯ": "NO APP",
    "МОДЕЛИ": "MODELS", "МАТЕРИАЛЫ": "MATERIALS", "ИКОНКИ": "ICONS", "ЕЩЁ": "MORE",
    "ОТМЕНА": "CANCEL", "БЕЗ МАТЕРИАЛА": "NO MATERIAL", "В СЛОТ «%s»": "INTO «%s»",
    "ОБНОВИТЬ · %d": "UPDATE · %d", "В 3D · %d": "TO 3D · %d", "РЕНДЕР В ODDMENTS": "RENDER TO ODDMENTS",
    "СНЯТЬ ВЫБОР": "CLEAR", "ВЫБРАТЬ ВСЕ · %d": "SELECT ALL · %d", "Слот «%s»": "Slot «%s»",
    "Сейчас: %s. ": "Now: %s. ", "Сейчас: простой материал Oddments. ": "Now: the plain Oddments material. ",
    "СОХРАНИТЬ": "SAVE", "без названия": "untitled", "СТИЛЬ: ": "STYLE: ",
    "КЛИК — ВЫБРАТЬ НЕСКОЛЬКО · ДВОЙНОЙ — В 3D": "CLICK — PICK SEVERAL · DOUBLE — TO 3D",
    "НАВЕДИТЕ НА КНОПКУ — ПОДСКАЗКА": "HOVER A BUTTON FOR A HINT",
    "ВЫБЕРИТЕ МАТЕРИАЛ ДЛЯ СЛОТА «%s»": "CHOOSE A MATERIAL FOR THE «%s» SLOT",
    "SVG в Oddments нет": "No SVGs in Oddments", "Иконки делает приложение Oddments — откройте его": "Icons are made by the Oddments app — open it",
    "В ODDMENTS": "TO ODDMENTS", "ВЫДЕЛЕННОЕ": "SELECTION", "ФАЙЛ .BLEND": ".BLEND FILE", "СНИМОК ВЬЮПОРТА": "VIEWPORT SHOT",
    "МАТЕРИАЛ": "MATERIAL", "ВСЕ МАТЕРИАЛЫ СЦЕНЫ": "ALL SCENE MATS", "ИЗ ODDMENTS": "FROM ODDMENTS",
    "ВСТАВИТЬ ВЫДЕЛЕННОЕ": "INSERT SELECTED", "ПРИМЕНИТЬ МАТЕРИАЛ": "APPLY MATERIAL", "СИНХРОНИЗАЦИЯ…": "SYNCING…",
    "МОДЕЛИ → ASSET BROWSER": "MODELS → ASSET BROWSER", "МОДЕЛЬ": "MODEL", "ПРОВЕРИТЬ": "CHECK", "ИСПРАВИТЬ": "FIX", "УМНАЯ UV": "SMART UV",
    "СВЕТ И РЕНДЕР КОМАНДЫ": "TEAM LIGHT AND RENDER", "+ СОХРАНИТЬ ТЕКУЩИЙ": "+ SAVE THE CURRENT ONE",
    "СВЯЗЬ И НАСТРОЙКИ": "CONNECTION AND SETTINGS", "ПРИНИМАТЬ ИЗ ODDMENTS": "RECEIVE FROM ODDMENTS", "ЗАПЕКАТЬ ПРОЦЕДУРНЫЕ": "BAKE PROCEDURAL",
    "ТЕКСТУРЫ %s": "TEXTURES %s", "ПРОВЕРИТЬ СВЯЗЬ": "CHECK CONNECTION", "НАСТРОЙКИ АДДОНА": "ADD-ON SETTINGS",
    "АКТИВНЫЙ МАТЕРИАЛ": "ACTIVE MATERIAL", "В БИБЛИОТЕКУ АДДОНА": "TO THE ADD-ON LIBRARY", "В ASSET BROWSER": "TO ASSET BROWSER", "+ СОХРАНИТЬ СВЕТ": "+ SAVE THE LIGHT",
    "Размер текстур, в которые запекаются процедурные материалы: 512 → 1024 → 2048.": "The size of the textures procedural materials are baked into: 512 → 1024 → 2048.",
    "Настройки аддона": "Add-on settings", "Токен, порт, язык, папка библиотеки — Edit › Preferences › Add-ons › Oddments.": "Token, port, language, library folder — Edit › Preferences › Add-ons › Oddments.",
    "СТАВЛЮ СВЕТ": "SETTING THE LIGHT", "РАБОТАЮ": "WORKING", "РЕНДЕРЮ ИКОНКИ": "RENDERING THE ICONS",
    "ИКОНКИ ДЕЛАЕТ ПРИЛОЖЕНИЕ ODDMENTS — ОНО НЕ ОТВЕЧАЕТ": "ICONS ARE MADE BY THE ODDMENTS APP — IT DOES NOT ANSWER",
    "СЕТКА: ОСТАЛОСЬ %d": "MESH: %d LEFT", "СТИЛЕЙ ПОКА НЕТ — «СОХРАНИТЬ»": "NO STYLES YET — «SAVE»", "СТИЛЬ НЕ ЧИТАЕТСЯ: %s": "CANNOT READ THE STYLE: %s",
    "СЛОТ «%s» — ПРОСТОЙ МАТЕРИАЛ · %d": "SLOT «%s» — PLAIN MATERIAL · %d", "В СЛОТ — МАТЕРИАЛЫ БИБЛИОТЕКИ АДДОНА (BLENDER)": "SLOTS TAKE MATERIALS OF THE ADD-ON'S LIBRARY (BLENDER)",
    "ГОТОВО — ПОДРОБНОСТИ ВНИЗУ, В СТРОКЕ BLENDER": "DONE — DETAILS BELOW, IN BLENDER'S STATUS BAR", "ОТМЕНЕНО": "CANCELLED", "ОТКРЫТО ОКНО": "A DIALOG IS OPEN",
    "только обводки (Outline stroke в Figma)": "strokes only (Outline stroke in Figma)", "нет залитых фигур": "no filled shapes",
    "Oddments: иконки": "Oddments: icons", "В 3D: ": "TO 3D: ", "НОВЫХ %d": "NEW %d", "ОБНОВЛЕНО %d": "UPDATED %d", "НЕ ВЫШЛО %d: %s": "FAILED %d: %s",
})


SWAP_TIP = ("Заменить выделенное",
            "Модель встанет на место каждого выделенного объекта: положение, поворот, масштаб, родитель, коллекции и имя. "
            "Старые объекты не удаляются — они в скрытой коллекции «Oddments · заменённые». Ctrl+Z вернёт всё.", "swap")
PLACE_TIP = ("Вставить у 3D-курсора", "Модель целиком, как в Oddments, — там, где стоит 3D-курсор.", "place")
FIT_TIP = ("Подогнать размер", "Новая модель вписывается в габариты старой по самой большой стороне и встаёт по её центру. "
           "Без этого — точка начала новой модели совпадает с точкой начала старой.", "fit")
MATS_TIP = ("Материалы старого", "На новую модель надеваются материалы заменяемого объекта — удобно, когда меняете "
            "только форму.", "mats")
ASSIGN_TIP = ("Назначить выделенному", "Материал — на все выделенные объекты (активным слотом). Из библиотеки аддона он "
              "приходит как был сохранён: ноды, группы, картинки.", "assign")
SAVE_TIP = ("Сохранить активный", "Материал активного объекта — в библиотеку аддона как есть, без переделки: процедурные "
            "ноды остаются нодами. Папка библиотеки видна и в Asset Browser («Oddments»).", None)
DEL_TIP = ("Убрать из библиотеки", "Удаляет файл материала из библиотеки аддона (нажмите ещё раз, чтобы подтвердить). "
           "Материалы в ваших сценах не трогаются.", None)
TOFILE_TIP = ("В файл", "Материал добавляется в этот .blend как ассет (виден в Asset Browser › Current File), "
              "выделенное не меняется.", "tofile")


class PERCH_OT_browser(bpy.types.Operator):
    bl_idname = "perch.browser"
    bl_label = "Браузер Oddments"
    bl_description = "Панель Oddments во вьюпорте: модели и материалы с превью, SVG-иконки в 3D набором, все команды аддона"

    def invoke(self, context, event):
        if _UI["op"] is not None:
            _UI["op"].closing = True  # a second call closes the open browser
            return {"CANCELLED"}
        # the add-on's own material library works without Oddments; models need Oddments running
        items, note = [], ""
        if not _prefs().token.strip():
            note = _t("НЕТ ТОКЕНА ODDMENTS — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ")
        else:
            try:
                with _open(_url("/items"), timeout=4) as r:
                    items = json.loads(r.read().decode())
            except Exception:
                note = _t("ODDMENTS НЕ ОТВЕЧАЕТ — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ")
        self.area = context.area if context.area and context.area.type == "VIEW_3D" else None
        if self.area is None:
            for a in context.screen.areas:
                if a.type == "VIEW_3D":
                    self.area = a
                    break
        if self.area is None:
            self.report({"ERROR"}, _t("Нужно окно 3D-вида"))
            return {"CANCELLED"}
        self.region = next(r for r in self.area.regions if r.type == "WINDOW")
        self.online = not note
        self.perch_items = [it for it in items if it.get("kind") in ("model", "material") and it.get("file")]
        # SVGs of the library are the «ИКОНКИ» tab: they become 3D right here
        self.perch_items += [dict(it, kind="icon") for it in items if (it.get("ext") or "").lower() == "svg" and it.get("file")]
        try:
            migrate_old_library()
        except Exception as e:
            print("Oddments: старые материалы не перенеслись", e)
        self.reload_lib()
        self.tab = _UI.get("tab") or ("model" if any(it["kind"] == "model" for it in self.items) or not self.items else "material")
        self.icon_sel, self.pick_slot, self.pending_op, self.auto_at = set(), None, None, 0.0
        self.job_left, self.job_made, self.job_upd, self.job_err = 0, 0, 0, []
        self.query, self.sel, self.scroll, self.scroll_to = "", None, 0.0, 0.0
        self.hits, self.hover, self.hover_at, self.mouse = [], None, 0.0, (-1, -1)
        self.anim = {}  # hover progress per hit key
        self.opened, self.closing, self.closed_at = time.time(), False, 0.0
        self.status, self.status_kind, self.status_at = "", "ok", 0.0
        self.busy, self.last_click = None, (None, 0.0)
        self.requested = set()
        p = _prefs()
        self.fetch = _Fetcher("http://127.0.0.1:%d" % p.port, p.token.strip())
        self.jobs = _IconJobs("http://127.0.0.1:%d" % p.port, p.token.strip())
        self.handle = bpy.types.SpaceView3D.draw_handler_add(self.paint, (), "WINDOW", "POST_PIXEL")
        self.timer = context.window_manager.event_timer_add(1 / 60, window=context.window)
        self.window = context.window
        context.window_manager.modal_handler_add(self)
        _UI["op"] = self
        if note:
            self.say(note, "warn")
        elif not self.items:
            self.say(_t("В Oddments пока нет моделей и материалов"), "warn")
        self.area.tag_redraw()
        return {"RUNNING_MODAL"}

    # ---- data ----
    def reload_lib(self):
        # the add-on's materials first: they are Blender's own, with procedural nodes intact
        try:
            self.items = matlib_items() + self.perch_items
        except Exception as e:
            self.items = list(self.perch_items)
            self.say(_t("БИБЛИОТЕКА МАТЕРИАЛОВ НЕ ЧИТАЕТСЯ: %s") % e, "err")

    def visible(self):
        words = self.query.lower().split()
        out = []
        for it in self.items:
            if it["kind"] != self.tab:
                continue
            hay = " ".join([it.get("name", ""), it.get("ext", "")] + list(it.get("tags") or []) + list(it.get("ai") or [])).lower()
            if all(w in hay for w in words):
                out.append(it)
        return out

    def selected_item(self):
        return next((it for it in self.items if it["id"] == self.sel), None)

    def say(self, text, kind="ok"):
        self.status, self.status_kind, self.status_at = text, kind, time.time()

    def targets(self, context):
        hidden = _hidden()
        return [o for o in context.selected_objects if not (hidden and o.name in hidden.objects)]

    # ---- geometry ----
    def scale(self):
        return bpy.context.preferences.system.ui_scale

    def panel(self):
        s, r = self.scale(), self.region
        right = 0
        for ui in self.area.regions:
            # the sidebar (N) is drawn over the 3D view when region overlap is on: keep the panel left of it
            if ui.type == "UI" and ui.width > 1 and ui.x > r.x and ui.x < r.x + r.width:
                right = r.x + r.width - ui.x
        # a small view keeps most of itself: the panel takes at most ~45 % of the width and ~760 px of the height
        free = r.width - right - 24 * s
        w = min(372 * s, max(240 * s, free * 0.45), free)
        x = r.width - right - w - 12 * s
        top = r.height - 52 * s
        y = max(12 * s, top - 760 * s)
        return x, y, w, top - y

    # ---- drawing ----
    def hit(self, key, x, y, w, h, action, tip=None):
        self.hits.append((key, x, y, w, h, action, tip))
        return self.anim.get(key, 0.0)

    def pill(self, key, x, y, w, h, label, action, tip=None, primary=False, on=False, enabled=True, s=1.0):
        t = self.hit(key, x, y, w, h, action if enabled else None, tip)
        if primary:
            bg = _alpha(LIME, (1.0 if enabled else 0.25) * (0.88 + 0.12 * t))
            fg = BLACK if enabled else _alpha(BLACK, 0.6)
        elif on:
            bg = _alpha(LIME, 0.16 + 0.08 * t)
            fg = LIME
        else:
            bg = (1, 1, 1, 0.06 + 0.07 * t)
            fg = INK if enabled else DIM
        grow = 1.5 * s * t if enabled else 0
        _rect(x, y, w, h, bg, radius=h / 2, grow=grow)
        if on and not primary:
            _rect(x, y, w, h, _alpha(LIME, 0.55), radius=h / 2, ring=1.2 * s)
        _text(x + w / 2, y + h / 2 - 4.2 * s, label, 11 * s, fg, mono=True, center=True, maxw=max(w - 16 * s, h))

    def paint(self):
        if bpy.context.area != self.area:
            return
        try:
            self._paint()
        except Exception as e:  # never break the viewport
            if not getattr(self, "_err", None):
                self._err = str(e)
                print("Oddments browser:", repr(e))
            gpu.state.scissor_test_set(False)
            gpu.state.blend_set("NONE")

    TABS = (("model", "МОДЕЛИ"), ("material", "МАТЕРИАЛЫ"), ("icon", "ИКОНКИ"), ("more", "ЕЩЁ"))

    def _paint(self):
        now = time.time()
        s = self.scale()
        x, y, w, h = self.panel()
        if w < 200 * s or h < 240 * s:
            return
        # open / close: rise and fade
        k = _ease((now - self.opened) / 0.28)
        if self.closing:
            k = 1 - _ease((now - self.closed_at) / 0.2)
        y += -(1 - k) * 14 * s
        self.hits = []
        gpu.state.blend_set("ALPHA")
        _rect(x, y - 6 * s, w, h, (0, 0, 0, 0.45 * k), radius=22 * s, soft=26 * s)
        _rect(x, y, w, h, _alpha(GLASS, k), radius=20 * s)
        _rect(x, y, w, h, (1, 1, 1, 0.07 * k), radius=20 * s, ring=1.0 * s)
        pad = 16 * s
        cx, top = x + pad, y + h - pad
        iw = w - 2 * pad
        # title row: the dot says whether Oddments answers
        _text(cx, top - 14 * s, "ODDMENTS", 13 * s, _alpha(INK, k), mono=True)
        tw0 = _tw("ODDMENTS", 13 * s, True)
        _rect(cx + tw0 + 7 * s, top - 11 * s, 6 * s, 6 * s, _alpha(LIME if self.online else MAGENTA, k), radius=3 * s)
        _text(cx + tw0 + 20 * s, top - 14 * s, _t("НА СВЯЗИ") if self.online else _t("БЕЗ ПРИЛОЖЕНИЯ"), 10 * s, _alpha(DIM, k), mono=True)
        self.pill("close", x + w - pad - 28 * s, top - 22 * s, 28 * s, 28 * s, "×", "close", (_t("Закрыть"), _t("Esc или та же кнопка в панели Oddments."), None), s=s)
        # tabs: with counts while they fit
        ty = top - 34 * s - 28 * s
        counts = {t: sum(1 for it in self.items if it["kind"] == t) for t in ("model", "material", "icon")}
        labels = [(t, _t(l) + ((" %d" % counts[t]) if t in counts else "")) for t, l in self.TABS]
        gap = 6 * s
        if sum(_tw(l, 11 * s, True) + 22 * s for _, l in labels) + gap * 3 > iw:
            labels = [(t, _t(l)) for t, l in self.TABS]
        ws = [_tw(l, 11 * s, True) + 22 * s for _, l in labels]
        extra = max(0.0, (iw - sum(ws) - gap * 3) / 4)  # the row spans the panel
        tx = cx
        for (t, l), tw_ in zip(labels, ws):
            self.pill("tab-" + t, tx, ty, tw_ + extra, 28 * s, l, "tab:" + t, on=self.tab == t, s=s)
            tx += tw_ + extra + gap
        # search (not on «ЕЩЁ»)
        if self.tab != "more":
            sy = ty - 10 * s - 36 * s
            t = self.hit("search", cx, sy, iw, 36 * s, "search")
            _rect(cx, sy, iw, 36 * s, (1, 1, 1, 0.06 + 0.04 * t), radius=18 * s)
            if self.query:
                tw = _text(cx + 16 * s, sy + 13 * s, self.query, 13 * s, INK, maxw=iw - 40 * s)
                if int(now * 2) % 2 == 0:
                    _rect(cx + 18 * s + tw, sy + 10 * s, 1.5 * s, 16 * s, LIME)
            else:
                _text(cx + 16 * s, sy + 13 * s, _t("Поиск: название или тег"), 13 * s, DIM)
                if int(now * 2) % 2 == 0 and self.over_panel():
                    _rect(cx + 15 * s, sy + 10 * s, 1.5 * s, 16 * s, LIME)
            area_top = sy - 12 * s
        else:
            area_top = ty - 14 * s
        # footer of the tab, then the status line above it
        fy = y + pad
        if self.tab == "icon":
            fh = self.footer_icons(cx, fy, iw, s, now)
        elif self.tab == "more":
            fh = 0.0
        else:
            fh = self.footer_lib(cx, fy, iw, s, now)
        st_y = fy + fh + (10 * s if fh else 0)
        self.status_line(cx, st_y, iw, s, now)
        gy0, gy1 = st_y + 22 * s, area_top
        if self.tab == "more":
            self.paint_more(cx, gy0, iw, gy1, s, now)
        else:
            self.paint_grid(cx, gy0, iw, gy1, s, now)
        # scroll fades: the content melts into the glass at its edges
        if self.scroll > 1:
            for i in range(10):
                _rect(cx - 6 * s, gy1 - (i + 1) * 2 * s, iw + 12 * s, 2 * s, _alpha(GLASS, 0.9 * (1 - i / 10)))
        if self.scroll < self.max_scroll - 1:
            for i in range(10):
                _rect(cx - 6 * s, gy0 + i * 2 * s, iw + 12 * s, 2 * s, _alpha(GLASS, 0.9 * (1 - i / 10)))
        self.draw_tip(now, s, x)
        gpu.state.blend_set("NONE")

    def footer_lib(self, cx, fy, iw, s, now):
        targets = self.targets(bpy.context)
        it_sel = self.selected_item()
        p = _prefs()
        ow = bw = (iw - 6 * s) / 2
        if self.tab == "model":
            self.pill("fit", cx, fy + 44 * s, ow, 28 * s, _t("ПОДОГНАТЬ РАЗМЕР"), "toggle:fit", FIT_TIP, on=p.swap_fit, s=s)
            self.pill("mats", cx + ow + 6 * s, fy + 44 * s, ow, 28 * s, _t("МАТЕРИАЛЫ СТАРОГО"), "toggle:mats", MATS_TIP, on=p.swap_materials, s=s)
            self.pill("place", cx, fy, bw, 36 * s, _t("ВСТАВИТЬ"), "place", PLACE_TIP, enabled=bool(it_sel) and not self.busy, s=s)
            self.pill("swap", cx + bw + 6 * s, fy, bw, 36 * s, _t("ЗАМЕНИТЬ · %d") % len(targets), "swap", SWAP_TIP, primary=True,
                      enabled=bool(it_sel and targets) and not self.busy, s=s)
        elif self.pick_slot is not None:
            # choosing a material for a slot of the icon set
            part = _t(ICON_PARTS[self.pick_slot]).upper()
            lib = bool(it_sel and it_sel.get("src") == "lib")
            self.pill("slot-cancel", cx, fy + 44 * s, ow, 28 * s, _t("ОТМЕНА"), "slot:cancel", s=s)
            self.pill("slot-clear", cx + ow + 6 * s, fy + 44 * s, ow, 28 * s, _t("БЕЗ МАТЕРИАЛА"), "slot:clear", SLOT_CLEAR_TIP, s=s)
            self.pill("slot-put", cx, fy, iw, 36 * s, _t("В СЛОТ «%s»") % part, "slot:put", SLOT_PUT_TIP, primary=True, enabled=lib and not self.busy, s=s)
        else:
            ob = bpy.context.active_object
            has = bool(ob and ob.active_material)
            self.pill("save", cx, fy + 44 * s, ow, 28 * s, _t("+ СОХРАНИТЬ АКТИВНЫЙ"), "save", SAVE_TIP, enabled=has and not self.busy, s=s)
            lib = bool(it_sel and it_sel.get("src") == "lib")
            armed = getattr(self, "armed", 0) and now - self.armed < 3
            self.pill("delete", cx + ow + 6 * s, fy + 44 * s, ow, 28 * s, _t("ТОЧНО УБРАТЬ?") if armed and lib else _t("УБРАТЬ"), "delete", DEL_TIP,
                      enabled=lib and not self.busy, s=s)
            self.pill("tofile", cx, fy, bw, 36 * s, _t("В ФАЙЛ"), "tofile", TOFILE_TIP, enabled=bool(it_sel) and not self.busy, s=s)
            self.pill("assign", cx + bw + 6 * s, fy, bw, 36 * s, _t("НАЗНАЧИТЬ · %d") % len(targets), "assign", ASSIGN_TIP, primary=True,
                      enabled=bool(it_sel and targets) and not self.busy, s=s)
        return 72 * s

    STEPS = {"depth": ("ГЛУБИНА", 0.02, 1.0, 0.02, lambda v: "%d%%" % round(v * 50)),
             "bevel": ("ФАСКА", 0.0, 0.12, 0.004, lambda v: ("%.1f%%" % (v * 50)) if v else _t("НЕТ")),
             "round": ("СКРУГЛЕНИЕ", 0.0, 0.3, 0.01, lambda v: ("%.1f%%" % (v * 50)) if v else _t("НЕТ")),
             "bseg": ("СЕГМЕНТЫ", 1, 8, 1, lambda v: "%d" % v)}

    def stepper(self, key, x, y, w, h, st, s):
        label, lo, hi, step, fmt = self.STEPS[key]
        t = self.hit("st-" + key, x, y, w, h, None, STEP_TIPS[key])
        _rect(x, y, w, h, (1, 1, 1, 0.05 + 0.03 * t), radius=h / 2)
        b = h - 6 * s
        _text(x + 12 * s, y + h / 2 - 4.2 * s, _t(label) + " " + fmt(st[key]), 10 * s, INK, mono=True, maxw=w - 2 * b - 22 * s)
        self.pill("st-" + key + "-", x + w - 2 * b - 6 * s, y + 3 * s, b, b, "-", "step:%s:-1" % key, enabled=st[key] > lo + 1e-9, s=s)
        self.pill("st-" + key + "+", x + w - b - 3 * s, y + 3 * s, b, b, "+", "step:%s:1" % key, enabled=st[key] < hi - 1e-9, s=s)

    def footer_icons(self, cx, fy, iw, s, now):
        st = current_icon_style()
        sc = bpy.context.scene
        in_set = icon_objects(sc, icon_set_name(st))
        half = (iw - 6 * s) / 2
        busy = bool(self.busy)
        n = len(self.icon_sel)
        self.pill("i-upd", cx, fy, half, 36 * s, _t("ОБНОВИТЬ · %d") % len(in_set), "icons:update", UPD_TIP, enabled=bool(in_set) and not busy and self.online, s=s)
        self.pill("i-make", cx + half + 6 * s, fy, half, 36 * s, _t("В 3D · %d") % n, "icons:make", MAKE_TIP, primary=True,
                  enabled=n > 0 and not busy and self.online, s=s)
        y1 = fy + 44 * s
        self.pill("i-render", cx, y1, half, 28 * s, _t("РЕНДЕР В ODDMENTS"), "icons:render", RENDER_TIP, enabled=bool(in_set) and not busy and self.online, s=s)
        vis = self.visible()
        alls = bool(vis) and all(it["id"] in self.icon_sel for it in vis)
        self.pill("i-all", cx + half + 6 * s, y1, half, 28 * s, _t("СНЯТЬ ВЫБОР") if alls else _t("ВЫБРАТЬ ВСЕ · %d") % len(vis), "icons:all", enabled=bool(vis), s=s)
        # material slots: one per part of the mesh
        y2 = y1 + 36 * s
        q = (iw - 18 * s) / 4
        mats = st.get("mats") or {}
        for i, part in enumerate(ICON_PARTS):
            m = mats.get(part)
            tip = (_t("Слот «%s»") % _t(part), (_t("Сейчас: %s. ") % m if m else _t("Сейчас: простой материал Oddments. ")) + _t(SLOT_TIP), None)
            self.pill("slot%d" % i, cx + i * (q + 6 * s), y2, q, 28 * s, _t(part).upper(), "slot:%d" % i, tip, on=bool(m), s=s)
        # style values
        y3 = y2 + 36 * s
        self.stepper("round", cx, y3, half, 28 * s, st, s)
        self.stepper("bseg", cx + half + 6 * s, y3, half, 28 * s, st, s)
        self.stepper("depth", cx, y3 + 34 * s, half, 28 * s, st, s)
        self.stepper("bevel", cx + half + 6 * s, y3 + 34 * s, half, 28 * s, st, s)
        fix = st.get("fix", True)
        self.pill("i-fix", cx, y3 + 68 * s, iw, 28 * s, _t("ИСПРАВЛЯТЬ SVG") + ": " + (_t("ВКЛ") if fix else _t("ВЫКЛ")), "icons:fix", FIX_TIP, on=fix, s=s)
        # the set's style: switch between saved ones, save; a dot when it differs from its file
        y4 = y3 + 102 * s
        b = 28 * s
        sw = _tw(_t("СОХРАНИТЬ"), 11 * s, True) + 26 * s
        self.pill("style-prev", cx, y4, b, b, "<", "style:-1", STYLE_TIP, enabled=bool(self.style_names()), s=s)
        mid = iw - 2 * b - sw - 18 * s
        t = self.hit("style-name", cx + b + 6 * s, y4, mid, b, None, STYLE_TIP)
        _rect(cx + b + 6 * s, y4, mid, b, (1, 1, 1, 0.05 + 0.03 * t), radius=b / 2)
        dirty = icon_style_changed(st)
        name = (st.get("name") or _t("без названия")).upper()
        _text(cx + b + 6 * s + mid / 2, y4 + b / 2 - 4.2 * s, _t("СТИЛЬ: ") + name, 10 * s, INK if st.get("name") else DIM, mono=True, center=True, maxw=mid - 24 * s)
        if dirty:
            _rect(cx + b + 6 * s + mid - 14 * s, y4 + b / 2 - 3 * s, 6 * s, 6 * s, MAGENTA, radius=3 * s)
        self.pill("style-next", cx + b + 12 * s + mid, y4, b, b, ">", "style:1", STYLE_TIP, enabled=bool(self.style_names()), s=s)
        self.pill("style-save", cx + iw - sw, y4, sw, b, _t("СОХРАНИТЬ"), "style:save", STYLE_SAVE_TIP, on=dirty or not st.get("name"), s=s)
        return y4 + b - fy

    def status_line(self, cx, st_y, iw, s, now):
        age = now - self.status_at
        if self.busy:
            dots = "·" * (1 + int(now * 3) % 3)
            _text(cx, st_y, self.busy + " " + dots, 11 * s, LIME, mono=True, maxw=iw)
        elif self.status and age < 6:
            a = 1.0 if age < 5 else 1 - (age - 5)
            col = {"ok": LIME, "warn": DIM, "err": MAGENTA}.get(self.status_kind, INK)
            _text(cx, st_y, self.status, 11 * s, _alpha(col, a), mono=True, maxw=iw)
        else:
            targets = self.targets(bpy.context)
            if self.tab == "icon":
                hint = _t("КЛИК — ВЫБРАТЬ НЕСКОЛЬКО · ДВОЙНОЙ — В 3D")
            elif self.tab == "more":
                hint = _t("НАВЕДИТЕ НА КНОПКУ — ПОДСКАЗКА")
            elif self.pick_slot is not None:
                hint = _t("ВЫБЕРИТЕ МАТЕРИАЛ ДЛЯ СЛОТА «%s»") % _t(ICON_PARTS[self.pick_slot]).upper()
            else:
                hint = _t("КЛИК — ВЫБРАТЬ · ДВОЙНОЙ — ") + (_t("ЗАМЕНИТЬ") if targets and self.tab == "model" else _t("НАЗНАЧИТЬ") if targets else _t("ВСТАВИТЬ") if self.tab == "model" else _t("В ФАЙЛ"))
            _text(cx, st_y, hint, 10 * s, _alpha(DIM, 0.8), mono=True, maxw=iw)

    def paint_grid(self, cx, gy0, iw, gy1, s, now):
        self.grid_box = (cx - 4 * s, gy0, iw + 8 * s, gy1 - gy0)
        vis = self.visible()
        cols, gap = (3 if iw >= 280 * s else 2), 8 * s
        tile = (iw - gap * (cols - 1)) / cols
        row_h = tile + 24 * s
        rows = (len(vis) + cols - 1) // cols
        self.max_scroll = max(0.0, rows * row_h - (gy1 - gy0))
        self.scroll_to = max(0.0, min(self.scroll_to, self.max_scroll))
        self.row_h = row_h
        self.scroll += (self.scroll_to - self.scroll) * 0.3
        if abs(self.scroll - self.scroll_to) < 0.5:
            self.scroll = self.scroll_to
        gpu.state.scissor_test_set(True)
        # region coordinates: the 3D view draws into its own framebuffer (adding reg.x hid the grid when
        # another area sat to the left of the view)
        gpu.state.scissor_set(int(cx - 6 * s), int(gy0), int(iw + 12 * s), int(gy1 - gy0))
        if not vis:
            if self.query:
                msg = _t("Ничего не нашлось")
            elif self.tab == "model":
                msg = _t("Моделей нет")
            elif self.tab == "icon":
                msg = _t("SVG в Oddments нет") if self.online else _t("Иконки делает приложение Oddments — откройте его")
            else:
                msg = _t("Пусто — «+ Сохранить активный»")
            _text(cx + iw / 2, (gy0 + gy1) / 2, msg, 13 * s, DIM, center=True, maxw=iw)
        for i, it in enumerate(vis):
            r, c = divmod(i, cols)
            tx = cx + c * (tile + gap)
            ty0 = gy1 - (r + 1) * row_h + self.scroll + 24 * s
            if ty0 + tile < gy0 - row_h or ty0 > gy1:
                continue
            key = "it:" + it["id"]
            inside = ty0 + tile > gy0 and ty0 < gy1
            t = self.hit(key, tx, max(ty0, gy0), tile, min(ty0 + tile, gy1) - max(ty0, gy0), "pick:" + it["id"],
                         ("item", it)) if inside else 0.0
            g = 3 * s * t
            th = _UI["thumbs"].get(it["id"])
            if th:
                tex, tw_, thh = th
                a = tw_ / thh
                uv = ((1 - 1 / a) / 2, 0.0, 1 - (1 - 1 / a) / 2, 1.0) if a > 1 else (0.0, (1 - a) / 2, 1.0, 1 - (1 - a) / 2)
                if self.tab == "icon":  # icons sit on a light plate, as in Oddments
                    _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, 0.9), radius=14 * s)
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, 1), radius=14 * s, tex=tex, uv=uv)
            else:
                pulse = 0.05 + 0.03 * math.sin(now * 4 + i)
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, pulse), radius=14 * s)
                self.want_thumb(it)
            chosen = it["id"] in self.icon_sel if self.tab == "icon" else it["id"] == self.sel
            if chosen:
                _rect(tx - g - 3 * s, ty0 - g - 3 * s, tile + 2 * g + 6 * s, tile + 2 * g + 6 * s, LIME, radius=17 * s, ring=2 * s)
            elif t > 0.01:
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, 0.35 * t), radius=14 * s, ring=1.2 * s)
            badge = "BLENDER" if it.get("src") == "lib" else it.get("ext", "").upper()
            _rect(tx + 7 * s, ty0 + 7 * s, _tw(badge, 9 * s, True) + 12 * s, 16 * s, (0, 0, 0, 0.55), radius=8 * s)
            _text(tx + 13 * s, ty0 + 11.5 * s, badge, 9 * s, LIME if it.get("src") == "lib" else INK, mono=True)
            if self.tab == "icon" and chosen:
                _rect(tx + tile - 23 * s, ty0 + tile - 23 * s, 16 * s, 16 * s, LIME, radius=8 * s)
                _text(tx + tile - 15 * s, ty0 + tile - 19.5 * s, "✓", 10 * s, BLACK, center=True)
            _text(tx + 2 * s, ty0 - 16 * s, it.get("name", ""), 11 * s, INK if chosen else _mix(DIM, INK, t), maxw=tile - 4 * s)
        gpu.state.scissor_test_set(False)

    # ---- «ЕЩЁ»: every other command of the add-on, in sections ----
    def style_names(self):
        now = time.time()
        if now - getattr(self, "_styles_at", 0) > 2:
            try:
                self._styles = icon_style_names()
            except Exception:
                self._styles = []
            self._styles_at = now
        return self._styles

    def light_names(self):
        now = time.time()
        if now - getattr(self, "_lights_at", 0) > 2:
            d = _presets_dir()
            try:
                self._lights = sorted(os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith(".json")) if os.path.isdir(d) else []
            except Exception:
                self._lights = []
            self._lights_at = now
        return self._lights

    def more_sections(self):
        p = _prefs()
        wm = bpy.context.window_manager
        cur = getattr(wm, "perch_light", "")
        return [
            (_t("В ODDMENTS"), [("op:send_selected", _t("ВЫДЕЛЕННОЕ"), False), ("op:send_file", _t("ФАЙЛ .BLEND"), False),
                                ("op:send_snapshot", _t("СНИМОК ВЬЮПОРТА"), False), ("op:send_material", _t("МАТЕРИАЛ"), False),
                                ("op:send_scene_materials", _t("ВСЕ МАТЕРИАЛЫ СЦЕНЫ"), False), ("op:splat_cycles", _t("СПЛАТ (CYCLES)"), False)]),
            (_t("ИЗ ODDMENTS"), [("op:insert", _t("ВСТАВИТЬ ВЫДЕЛЕННОЕ"), False), ("op:apply_material", _t("ПРИМЕНИТЬ МАТЕРИАЛ"), False),
                                 ("op:sync_models", _t("СИНХРОНИЗАЦИЯ…") if _SYNC["busy"] else _t("В ASSET BROWSER"), _SYNC["busy"])]),
            (_t("В БИБЛИОТЕКУ АДДОНА"), [("op:save_material_lib", _t("АКТИВНЫЙ МАТЕРИАЛ"), False),
                                      ("op:save_material_lib?all", _t("ВСЕ МАТЕРИАЛЫ СЦЕНЫ"), False)]),
            (_t("МОДЕЛЬ"), [("op:check_model", _t("ПРОВЕРИТЬ"), False), ("op:fix_model", _t("ИСПРАВИТЬ"), False), ("op:smart_uv", _t("УМНАЯ UV"), False)]),
            (_t("СВЕТ И РЕНДЕР КОМАНДЫ"), [("light:" + n, n.upper(), n == cur) for n in self.light_names()] +
             [("op:light_save", _t("+ СОХРАНИТЬ СВЕТ"), False)]),
            (_t("СВЯЗЬ И НАСТРОЙКИ"), [("toggle:receive", _t("ПРИНИМАТЬ ИЗ ODDMENTS"), p.receive), ("toggle:bake", _t("ЗАПЕКАТЬ ПРОЦЕДУРНЫЕ"), p.bake),
                                      ("size", _t("ТЕКСТУРЫ %s") % p.bake_size, False), ("op:check", _t("ПРОВЕРИТЬ СВЯЗЬ"), False),
                                      ("prefs", _t("НАСТРОЙКИ АДДОНА"), False)]),
        ]

    def more_tip(self, action):
        p = _prefs()
        if action.startswith("op:"):
            cls = _OPS.get(action[3:].split("?")[0])
            if action.endswith("?all"):
                return (_t("Все материалы сцены в библиотеку"), cls.bl_description, None)
            return (cls.bl_label, cls.bl_description, None) if cls else None
        if action.startswith("light:"):
            return (_t("Пресет «%s»") % action[6:], PERCH_OT_light_apply.bl_description, None)
        if action.startswith("toggle:"):
            prop = p.bl_rna.properties[action[7:]]
            return (prop.name, prop.description, None)
        if action == "size":
            return (p.bl_rna.properties["bake_size"].name, _t("Размер текстур, в которые запекаются процедурные материалы: 512 → 1024 → 2048."), None)
        if action == "prefs":
            return (_t("Настройки аддона"), _t("Токен, порт, язык, папка библиотеки — Edit › Preferences › Add-ons › Oddments."), None)
        return None

    def paint_more(self, cx, gy0, iw, gy1, s, now):
        self.grid_box = (cx - 4 * s, gy0, iw + 8 * s, gy1 - gy0)
        self.row_h = 40 * s
        secs = self.more_sections()
        # content height first: the scroll needs it
        bh, gap, half = 32 * s, 6 * s, (iw - 6 * s) / 2
        total = 0.0
        for _, btns in secs:
            total += 22 * s + ((len(btns) + 1) // 2) * (bh + gap) + 10 * s
        self.max_scroll = max(0.0, total - (gy1 - gy0))
        self.scroll_to = max(0.0, min(self.scroll_to, self.max_scroll))
        self.scroll += (self.scroll_to - self.scroll) * 0.3
        if abs(self.scroll - self.scroll_to) < 0.5:
            self.scroll = self.scroll_to
        gpu.state.scissor_test_set(True)
        gpu.state.scissor_set(int(cx - 6 * s), int(gy0), int(iw + 12 * s), int(gy1 - gy0))
        yy = gy1 + self.scroll
        for title, btns in secs:
            _text(cx + 4 * s, yy - 14 * s, title, 10 * s, DIM, mono=True)
            if title == _t("ИЗ ODDMENTS") and _SYNC["msg"]:
                _text(cx + iw, yy - 14 * s, _SYNC["msg"].upper(), 9 * s, _alpha(DIM, 0.7), mono=True, right=True, maxw=iw * 0.55)
            yy -= 22 * s
            for i, (action, label, on) in enumerate(btns):
                r, c = divmod(i, 2)
                by = yy - (r + 1) * (bh + gap) + gap
                if by + bh < gy0 - 4 or by > gy1 + 4:
                    continue
                visible = by >= gy0 - 1 and by + bh <= gy1 + 1
                busy = bool(self.busy) or (action == "op:sync_models" and _SYNC["busy"])
                if visible:
                    self.pill("more:" + action, cx + c * (half + 6 * s), by, half, bh, label, action, self.more_tip(action),
                              on=on, enabled=not busy, s=s)
                else:  # half under the edge: drawn, not clickable
                    _rect(cx + c * (half + 6 * s), by, half, bh, (1, 1, 1, 0.06), radius=bh / 2)
                    _text(cx + c * (half + 6 * s) + half / 2, by + bh / 2 - 4.2 * s, label, 11 * s, DIM, mono=True, center=True, maxw=half - 16 * s)
            yy -= ((len(btns) + 1) // 2) * (bh + gap) + 10 * s
        gpu.state.scissor_test_set(False)

    def draw_tip(self, now, s, panel_x):
        hv = self.hover
        if not hv or not hv[6] or now - self.hover_at < 0.45:
            return
        k = _ease((now - self.hover_at - 0.45) / 0.18)
        tip = hv[6]
        w = 268 * s
        pad = 14 * s
        lines, title, extra, anim = [], "", [], None
        if tip[0] == "item":
            it = tip[1]
            title = it.get("name", "")
            tags = list(it.get("tags") or []) + ["✦ " + t for t in (it.get("ai") or [])[:3]]
            sub = it.get("ext", "").upper() + ((" · %d × %d" % (it["w"], it["h"])) if it.get("w") and it.get("kind") == "material" else "")
            lines = [sub] + ([", ".join(tags[:6])] if tags else [])
            extra = []
        else:
            title, body, anim = _t(tip[0]), _t(tip[1]), tip[2]
            lines = _wrap(body, 12 * s, w - 2 * pad) if body else []
        ill = 74 * s if anim in ("swap", "place", "fit", "mats") else 0
        lh = 17 * s
        h = pad * 2 + 18 * s + len(lines) * lh + ill
        x = panel_x - w - 10 * s
        y = min(max(hv[2] + hv[4] / 2 - h / 2, 12 * s), self.region.height - h - 52 * s) - (1 - k) * 6 * s
        _rect(x, y - 4 * s, w, h, (0, 0, 0, 0.4 * k), radius=18 * s, soft=18 * s)
        _rect(x, y, w, h, _alpha(GLASS, k), radius=16 * s)
        _rect(x, y, w, h, _alpha((1, 1, 1, 0.08), k), radius=16 * s, ring=1 * s)
        ty = y + h - pad - 13 * s
        _text(x + pad, ty, title, 13 * s, _alpha(INK, k), maxw=w - 2 * pad)
        for i, ln in enumerate(lines):
            _text(x + pad, ty - (i + 1) * lh - 2 * s, ln, 11 * s if tip[0] == "item" else 12 * s, _alpha(DIM, k), mono=tip[0] == "item" and i == 0, maxw=w - 2 * pad)
        if ill:
            self.draw_anim(anim, x + pad, y + pad, w - 2 * pad, ill - 10 * s, now - self.hover_at, k, s)

    def draw_anim(self, kind, x, y, w, h, t, k, s):
        """Little looping illustrations for the hints (like the add-ons with animated tooltips)."""
        _rect(x, y, w, h, _alpha((1, 1, 1, 0.04), k), radius=12 * s)
        cx, cy = x + w / 2, y + h / 2
        ph = (t % 2.4) / 2.4
        box = h * 0.56
        if kind == "swap":
            # the old object fades out, the new one pops in on the same spot
            a_old = 1 - _ease((ph - 0.25) / 0.2)
            pop = _ease((ph - 0.35) / 0.25)
            if ph > 0.9:
                a_old, pop = _ease((ph - 0.9) / 0.1), 1 - _ease((ph - 0.9) / 0.1)
            _rect(cx - box / 2, cy - box / 2, box, box, _alpha((1, 1, 1, 0.22), k * a_old), radius=6 * s)
            b = box * (0.6 + 0.4 * pop) * (1 + 0.08 * math.sin(pop * math.pi))
            _rect(cx - b / 2, cy - b / 2, b, b, _alpha(LIME, k * pop), radius=b / 2.4)
            _text(cx - w / 2 + 8 * s, y + 7 * s, _t("БЫЛО"), 9 * s, _alpha(DIM, k * a_old), mono=True)
            _text(cx + w / 2 - 8 * s, y + 7 * s, _t("СТАЛО"), 9 * s, _alpha(LIME, k * pop), mono=True, right=True)
        elif kind == "place":
            # the 3D cursor, the model drops onto it
            for r_, a_ in ((10 * s, 1.0), (6 * s, 0.6)):
                _rect(cx - r_, cy - h * 0.3 - r_, 2 * r_, 2 * r_, _alpha(MAGENTA, k * a_), radius=r_, ring=1.5 * s)
            d = _ease(ph / 0.5)
            b = box * 0.7
            _rect(cx - b / 2, cy - h * 0.3 + (1 - d) * h * 0.6, b, b, _alpha(LIME, k * min(1, d * 2)), radius=b / 2.4)
        elif kind == "fit":
            # a big new model shrinks into the old one's frame
            _rect(cx - box / 2, cy - box / 2, box, box, _alpha((1, 1, 1, 0.5), k), radius=6 * s, ring=1.2 * s)
            sc = 1.7 - 0.7 * _ease((ph - 0.2) / 0.4) if ph < 0.9 else 1.7 - 0.7 * (1 - _ease((ph - 0.9) / 0.1))
            b = box * sc
            _rect(cx - b / 2, cy - b / 2, b, b, _alpha(LIME, k * 0.85), radius=b / 2.4)
        elif kind == "mats":
            # the old colour flows onto the new shape
            _rect(cx - box * 1.2, cy - box / 2, box, box, _alpha(MAGENTA, k), radius=6 * s)
            c = _mix(LIME, MAGENTA, _ease((ph - 0.3) / 0.35) if ph < 0.9 else 1 - _ease((ph - 0.9) / 0.1))
            _rect(cx + box * 0.2, cy - box / 2, box, box, _alpha(c, k), radius=box / 2.4)
            _text(cx, cy - 4 * s, "→", 12 * s, _alpha(DIM, k), center=True)

    # ---- events ----
    def over_panel(self):
        x, y, w, h = self.panel()
        mx, my = self.mouse
        return x - 4 <= mx <= x + w + 4 and y - 4 <= my <= y + h + 4

    def hit_at(self):
        mx, my = self.mouse
        for hv in reversed(self.hits):
            key, x, y, w, h = hv[:5]
            if x <= mx <= x + w and y <= my <= y + h:
                return hv
        return None

    def want_thumb(self, it):
        if it["id"] in self.requested:
            return
        if it.get("local_thumb"):
            self.requested.add(it["id"])
            try:
                _thumb_texture(it["id"], it["local_thumb"])
            except Exception as e:
                print("Oddments: превью не загрузилось", it["name"], e)
            return
        if not it.get("thumb"):
            return
        self.requested.add(it["id"])
        self.fetch.get("thumb", it["id"], it["thumb"])

    def finish(self, context):
        bpy.types.SpaceView3D.draw_handler_remove(self.handle, "WINDOW")
        context.window_manager.event_timer_remove(self.timer)
        self.fetch.stop = True
        self.jobs.stop = True
        _UI["op"], _UI["tab"] = None, self.tab
        if self.area:
            self.area.tag_redraw()
        return {"FINISHED"}

    def modal(self, context, event):
        if self.area is None or not any(a == self.area for a in context.window.screen.areas):
            return self.finish(context)  # the area went away (another workspace)
        if event.type == "TIMER":
            if self.closing and time.time() - self.closed_at > 0.22:
                return self.finish(context)
            self.tick(context)
            return {"PASS_THROUGH"}
        r = self.region
        self.mouse = (event.mouse_x - r.x, event.mouse_y - r.y)
        over = self.over_panel() and not self.closing
        hv = self.hit_at() if over else None
        if (hv and hv[0]) != (self.hover and self.hover[0]):
            self.hover, self.hover_at = hv, time.time()
        if not over:
            return {"PASS_THROUGH"}
        if event.type in {"MOUSEMOVE", "INBETWEEN_MOUSEMOVE"}:
            return {"PASS_THROUGH"}
        if event.type in {"WHEELDOWNMOUSE", "WHEELUPMOUSE"} and hv and hv[0].startswith("st-"):
            self.act(context, "step:%s:%d" % (hv[0][3:-1], 1 if event.type == "WHEELUPMOUSE" else -1))
            return {"RUNNING_MODAL"}
        if event.type in {"WHEELDOWNMOUSE", "WHEELUPMOUSE"}:
            step = self.row_h * (1 if event.type == "WHEELDOWNMOUSE" else -1) * 0.6
            self.scroll_to = max(0.0, min(getattr(self, "max_scroll", 0.0), self.scroll_to + step))
            return {"RUNNING_MODAL"}
        if event.type == "TRACKPADPAN":
            self.scroll_to = max(0.0, min(getattr(self, "max_scroll", 0.0), self.scroll_to + (event.mouse_y - event.mouse_prev_y)))
            return {"RUNNING_MODAL"}
        if event.value != "PRESS":
            return {"RUNNING_MODAL"} if event.type in {"LEFTMOUSE", "RIGHTMOUSE"} else {"PASS_THROUGH"} if event.ctrl or event.alt else {"RUNNING_MODAL"}
        if event.type == "LEFTMOUSE":
            if hv and hv[5]:
                self.act(context, hv[5], double=self.is_double(hv[5]))
            return {"RUNNING_MODAL"}
        if event.type == "ESC":
            if self.pick_slot is not None:
                self.act(context, "slot:cancel")
            else:
                self.close()
            return {"RUNNING_MODAL"}
        if event.type == "BACK_SPACE":
            self.query = "" if event.ctrl else self.query[:-1]
            self.scroll_to = 0.0
            return {"RUNNING_MODAL"}
        if event.type in {"RET", "NUMPAD_ENTER"}:
            self.primary(context)
            return {"RUNNING_MODAL"}
        if event.type == "TAB":
            order = [t for t, _ in self.TABS]
            self.act(context, "tab:" + order[(order.index(self.tab) + (-1 if event.shift else 1)) % len(order)])
            return {"RUNNING_MODAL"}
        if event.type in {"LEFT_ARROW", "RIGHT_ARROW", "UP_ARROW", "DOWN_ARROW"}:
            self.move({"LEFT_ARROW": -1, "RIGHT_ARROW": 1, "UP_ARROW": -3, "DOWN_ARROW": 3}[event.type])
            return {"RUNNING_MODAL"}
        if event.ctrl or event.oskey or event.alt:
            return {"PASS_THROUGH"}  # Ctrl+Z, Ctrl+S… still work with the pointer over the panel
        if event.unicode and event.unicode.isprintable() and self.tab != "more":
            self.query += event.unicode
            self.scroll_to = 0.0
            return {"RUNNING_MODAL"}
        return {"RUNNING_MODAL"}

    def is_double(self, action):
        prev, at = self.last_click
        now = time.time()
        self.last_click = (action, now)
        return prev == action and now - at < 0.35

    def close(self):
        if not self.closing:
            self.closing, self.closed_at = True, time.time()

    def move(self, d):
        vis = self.visible()
        if not vis:
            return
        ids = [it["id"] for it in vis]
        i = ids.index(self.sel) if self.sel in ids else -1
        i = max(0, min(len(ids) - 1, i + d if i >= 0 else 0))
        self.sel = ids[i]
        row = i // 3
        x, y, w, h = getattr(self, "grid_box", (0, 0, 0, 0))
        top = row * self.row_h
        if top < self.scroll_to:
            self.scroll_to = top
        elif top + self.row_h > self.scroll_to + h:
            self.scroll_to = top + self.row_h - h

    def primary(self, context):
        targets = self.targets(context)
        if self.tab == "icon":
            self.act(context, "icons:make")
        elif self.tab == "more":
            pass
        elif self.pick_slot is not None:
            self.act(context, "slot:put")
        elif self.tab == "model":
            self.act(context, "swap" if targets else "place")
        else:
            self.act(context, "assign" if targets else "tofile")

    def act(self, context, action, double=False):
        p = _prefs()
        if action == "close":
            self.close()
        elif action.startswith("tab:"):
            if self.pick_slot is not None and action != "tab:material":
                self.pick_slot = None
            self.tab, self.scroll_to, self.scroll, self.sel = action[4:], 0.0, 0.0, None
        elif action.startswith("toggle:"):
            name = {"fit": "swap_fit", "mats": "swap_materials"}.get(action[7:], action[7:])
            setattr(p, name, not getattr(p, name))
        elif action == "size":
            sizes = ["512", "1024", "2048"]
            p.bake_size = sizes[(sizes.index(p.bake_size) + 1) % len(sizes)]
        elif action == "prefs":
            with context.temp_override(window=self.window, area=self.area, region=self.region):
                bpy.ops.preferences.addon_show(module=ADDON)
        elif action.startswith("light:"):
            try:
                context.window_manager.perch_light = action[6:]
            except TypeError:
                return
            self.queue_op("light_apply", _t("СТАВЛЮ СВЕТ"))
        elif action.startswith("op:"):
            name, _, arg = action[3:].partition("?")
            cls = _OPS.get(name)
            self.queue_op(name, _t(cls.bl_label).upper() if cls else "", {"all_scene": True} if arg == "all" else {})
        elif action.startswith("pick:") and self.tab == "icon":
            key = action[5:]
            if double:
                self.icon_sel.add(key)
                self.make_icons(context, [it for it in self.items if it["id"] == key])
            elif key in self.icon_sel:
                self.icon_sel.discard(key)
            else:
                self.icon_sel.add(key)
        elif action.startswith("pick:"):
            self.sel = action[5:]
            if double:
                self.primary(context)
        elif action.startswith("icons:") or action.startswith("slot:") or action.startswith("step:") or action.startswith("style:"):
            self.act_icons(context, action)
        elif action == "save":
            if not self.busy:
                self.busy = _t("СОХРАНЯЮ МАТЕРИАЛ")
                self.pending = ("save", None)
                self.save_at = time.time()  # done on a later tick, so the panel shows it first
        elif action == "delete":
            it = self.selected_item()
            if not it or it.get("src") != "lib":
                return
            if getattr(self, "armed", 0) and time.time() - self.armed < 3:
                self.armed = 0
                try:
                    remove_from_library(it["name"])
                except Exception as e:
                    self.say(_t("НЕ УДАЛИЛОСЬ: %s") % e, "err")
                    return
                self.sel = None
                self.reload_lib()
                self.say(_t("УБРАНО ИЗ БИБЛИОТЕКИ: ") + it["name"].upper())
            else:
                self.armed = time.time()
        elif action in ("swap", "place", "assign", "tofile"):
            it = self.selected_item()
            if not it or self.busy:
                return
            if it.get("src") == "lib":  # already on this computer: nothing to download
                self.run(context, action, it, it["path"])
                return
            self.busy = _t("СКАЧИВАЮ ") + it.get("name", "")[:24].upper()
            self.pending = (action, it)
            self.fetch.get("file", it["id"], it["file"])

    def queue_op(self, name, label, kw=None):
        """A command of the add-on, run on the next tick, so the panel shows that it is busy first."""
        if self.busy:
            return
        self.busy = label or _t("РАБОТАЮ")
        self.pending_op, self.op_kw, self.save_at = name, kw or {}, time.time()

    def make_icons(self, context, items):
        if not self.online:
            self.say(_t("ИКОНКИ ДЕЛАЕТ ПРИЛОЖЕНИЕ ODDMENTS — ОНО НЕ ОТВЕЧАЕТ"), "err")
            return
        st = current_icon_style()
        metas = [{"id": it.get("id"), "name": it.get("name"), "file": it.get("file")} for it in items if it.get("file")]
        if not metas:
            return
        for m in metas:
            self.jobs.add(m, st)
        self.job_left += len(metas)
        self.busy = _t("СЕТКА: ОСТАЛОСЬ %d") % self.job_left

    def act_icons(self, context, action):
        sc = context.scene
        st = current_icon_style()
        if action == "icons:make":
            self.make_icons(context, [it for it in self.items if it["kind"] == "icon" and it["id"] in self.icon_sel])
        elif action == "icons:update":
            objs = icon_objects(sc, icon_set_name(st))
            self.make_icons(context, [_icon_meta(o) for o in objs])
        elif action == "icons:render":
            self.queue_op("render_icons", _t("РЕНДЕРЮ ИКОНКИ"))
        elif action == "icons:all":
            vis = self.visible()
            if vis and all(it["id"] in self.icon_sel for it in vis):
                self.icon_sel -= {it["id"] for it in vis}
            else:
                self.icon_sel |= {it["id"] for it in vis}
        elif action == "icons:fix":
            st["fix"] = not st.get("fix", True)
            set_icon_style(st)
            if icon_objects(sc, icon_set_name(st)):
                self.auto_at = time.time() + 0.5
        elif action.startswith("step:"):
            _, key, d = action.split(":")
            label, lo, hi, step, fmt = self.STEPS[key]
            v = st[key] + step * int(d)
            v = max(lo, min(hi, round(v / step) * step))
            st[key] = int(round(v)) if isinstance(step, int) else round(v, 4)
            set_icon_style(st)
            if icon_objects(sc, icon_set_name(st)):
                self.auto_at = time.time() + 0.5  # the set in the scene follows the style
        elif action.startswith("style:"):
            arg = action[6:]
            if arg == "save":
                with context.temp_override(window=self.window, area=self.area, region=self.region):
                    bpy.ops.perch.icon_style_save("INVOKE_DEFAULT")
                self._styles_at = 0
                return
            names = self.style_names()
            if not names:
                self.say(_t("СТИЛЕЙ ПОКА НЕТ — «СОХРАНИТЬ»"), "warn")
                return
            cur = st.get("name")
            i = names.index(cur) if cur in names else -1
            name = names[(i + int(arg)) % len(names)]
            try:
                set_icon_style(load_icon_style(name))
                self.say(_t("СТИЛЬ: ") + name.upper())
            except Exception as e:
                self.say(_t("СТИЛЬ НЕ ЧИТАЕТСЯ: %s") % e, "err")
        elif action == "slot:cancel":
            self.pick_slot, self.tab, self.sel = None, "icon", None
        elif action == "slot:clear":
            n = set_slot_material(sc, st, self.pick_slot, None)
            self.say(_t("СЛОТ «%s» — ПРОСТОЙ МАТЕРИАЛ · %d") % (_t(ICON_PARTS[self.pick_slot]).upper(), n))
            self.pick_slot, self.tab, self.sel = None, "icon", None
        elif action == "slot:put":
            it = self.selected_item()
            if not it or it.get("src") != "lib":
                self.say(_t("В СЛОТ — МАТЕРИАЛЫ БИБЛИОТЕКИ АДДОНА (BLENDER)"), "warn")
                return
            try:
                n = set_slot_material(sc, st, self.pick_slot, it["name"])
            except Exception as e:
                self.say(_t("НЕ ВЫШЛО: %s") % e, "err")
                return
            bpy.ops.ed.undo_push(message=_t("Oddments: материал"))
            self.say(_t("«%s» → %s · %d") % (it["name"].upper(), _t(ICON_PARTS[self.pick_slot]).upper(), n))
            self.pick_slot, self.tab, self.sel = None, "icon", None
        elif action.startswith("slot:"):
            self.pick_slot = int(action[5:])
            self.tab, self.scroll_to, self.scroll, self.sel, self.query = "material", 0.0, 0.0, None, ""

    def tick(self, context):
        if self.busy and self.pending_op and time.time() - self.save_at > 0.1:
            name, self.pending_op = self.pending_op, None
            with context.temp_override(window=self.window, area=self.area, region=self.region):
                try:
                    res = getattr(bpy.ops.perch, name)("INVOKE_DEFAULT", **getattr(self, "op_kw", {}))
                    self.say(_t("ГОТОВО — ПОДРОБНОСТИ ВНИЗУ, В СТРОКЕ BLENDER") if "FINISHED" in res else
                             _t("ОТМЕНЕНО") if "CANCELLED" in res else _t("ОТКРЫТО ОКНО"), "ok" if "FINISHED" in res else "warn")
                except Exception as e:
                    self.say(_t("НЕ ВЫШЛО: %s") % e, "err")
            self.busy = None
            self._lights_at = self._styles_at = 0
        if self.auto_at and time.time() > self.auto_at and not self.busy:
            self.auto_at = 0.0
            self.act_icons(context, "icons:update")
        got = 0
        while got < 4:
            try:
                meta, st, res, err = self.jobs.done.get_nowait()
            except queue.Empty:
                break
            got += 1
            self.job_left = max(0, self.job_left - 1)
            if err:
                why = {"strokes": _t("только обводки (Outline stroke в Figma)"), "empty": _t("нет залитых фигур")}.get(str(err), str(err))
                self.job_err.append("%s: %s" % (meta.get("name"), why))
            else:
                try:
                    _, new = place_icon(context.scene, res, meta, st)
                    if new:
                        self.job_made += 1
                    else:
                        self.job_upd += 1
                except Exception as e:
                    self.job_err.append("%s: %s" % (meta.get("name"), e))
            if self.job_left:
                self.busy = _t("СЕТКА: ОСТАЛОСЬ %d") % self.job_left
            else:
                self.busy = None
                bpy.ops.ed.undo_push(message=_t("Oddments: иконки"))
                parts = []
                if self.job_made:
                    parts.append(_t("НОВЫХ %d") % self.job_made)
                if self.job_upd:
                    parts.append(_t("ОБНОВЛЕНО %d") % self.job_upd)
                if self.job_err:
                    print("Oddments: иконки не вышли —", "; ".join(self.job_err))
                    parts.append(_t("НЕ ВЫШЛО %d: %s") % (len(self.job_err), self.job_err[0].upper()))
                self.say(_t("В 3D: ") + " · ".join(parts), "err" if self.job_err and not (self.job_made or self.job_upd) else "ok")
                self.job_made = self.job_upd = 0
                self.job_err = []
        if self.busy and getattr(self, "pending", (None,))[0] == "save" and time.time() - self.save_at > 0.1:
            self.pending = (None, None)
            ob = context.active_object
            name = ob.active_material.name if ob and ob.active_material else ""
            with context.temp_override(window=self.window, area=self.area, region=self.region):
                try:
                    res = bpy.ops.perch.save_material_lib()
                    self.say((_t("В БИБЛИОТЕКЕ: ") + name.upper()) if "FINISHED" in res else _t("НЕ ВЫШЛО"), "ok" if "FINISHED" in res else "err")
                except Exception as e:
                    self.say(_t("НЕ ВЫШЛО: %s") % e, "err")
            self.busy = None
            self.reload_lib()
            self.sel = next((it["id"] for it in self.items if it.get("src") == "lib" and it["name"] == _file_name(name)), self.sel)
        loaded = 0
        while loaded < 6:
            try:
                kind, key, path, err = self.fetch.done.get_nowait()
            except queue.Empty:
                break
            if kind == "thumb":
                if path:
                    try:
                        _thumb_texture(key, path)
                    except Exception as e:
                        print("Oddments: превью не загрузилось", key, e)
                loaded += 1
            elif kind == "file":
                action, it = self.pending
                self.busy = None
                if err or not path:
                    self.say(_t("НЕ СКАЧАЛОСЬ: %s") % err, "err")
                else:
                    self.run(context, action, it, path)
        # hover animation
        for hv in self.hits:
            key = hv[0]
            target = 1.0 if self.hover and self.hover[0] == key else 0.0
            cur = self.anim.get(key, 0.0)
            self.anim[key] = cur + (target - cur) * 0.25
        self.area.tag_redraw()

    def run(self, context, action, it, path):
        name = it.get("name") or os.path.splitext(os.path.basename(path))[0]
        p = _prefs()
        with context.temp_override(window=self.window, area=self.area, region=self.region):
            try:
                if action == "swap":
                    res = bpy.ops.perch.swap(filepath=path, name=name, fit=p.swap_fit, keep_materials=p.swap_materials)
                    msg = _t("ЗАМЕНЕНО: ") + name.upper()
                elif action == "place":
                    res = bpy.ops.perch.place(filepath=path, name=name)
                    msg = _t("ВСТАВЛЕНО: ") + name.upper()
                else:
                    mat = material_from_library(it["name"]) if it.get("src") == "lib" else perchmat_to_material(path)
                    if action == "assign":
                        n = assign_material(mat, self.targets(context))
                        msg = _t("НАЗНАЧЕН %s · %d") % (mat.name.upper(), n)
                    else:
                        msg = _t("В ФАЙЛЕ: ") + mat.name.upper()
                    bpy.ops.ed.undo_push(message=_t("Oddments: материал"))
                    res = {"FINISHED"}
                self.say(msg if "FINISHED" in res else _t("НЕ ВЫШЛО"), "ok" if "FINISHED" in res else "err")
            except Exception as e:
                self.say(_t("НЕ ВЫШЛО: %s") % e, "err")


class PERCH_OT_browser_close(bpy.types.Operator):
    bl_idname = "perch.browser_close"
    bl_label = "Закрыть браузер Oddments"

    def execute(self, context):
        if _UI["op"]:
            _UI["op"].close()
        return {"FINISHED"}


@bpy.app.handlers.persistent
def _on_load(_):
    _UI["thumbs"].clear()  # the images went with the old file
    op = _UI["op"]
    if op is not None:  # loading a file ends modal operators: take our drawing away too
        _UI["op"] = None
        try:
            op.fetch.stop = op.jobs.stop = True
            bpy.types.SpaceView3D.draw_handler_remove(op.handle, "WINDOW")
        except Exception:  # ReferenceError: Blender has already freed the operator
            pass


# ---------- Oddments' models in Blender's Asset Browser ----------
# The library folder (the same Asset Library as the materials) gets «Oddments Models.blend»: every model of Oddments
# as a collection asset, with Oddments' preview, its tags, and a catalog per Oddments collection
# («Oddments/Модели/<подборка>»). Written by a background Blender, like the material library, so the open scene is not
# touched. Each asset remembers its Oddments id and file: the next sync adds what is new, drops what left Oddments and
# reimports what changed.
MODELS_FILE = "Oddments Models.blend"
MODEL_EXT = (".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply", ".abc", ".usd", ".usdz", ".usdc", ".blend")

_MODELS_SCRIPT = r"""
import bpy, json, os, sys, shutil, tempfile, uuid, urllib.parse, urllib.request
a = json.loads(sys.argv[sys.argv.index("--") + 1])
lib, base, tok = a["lib"], a["base"], a["token"]
if not os.path.exists(lib):
    bpy.ops.wm.read_factory_settings(use_empty=True)
want = {x["id"]: x for x in a["items"]}
have, removed = {}, 0
for c in list(bpy.data.collections):
    oid = c.get("oddments_id")
    if not oid:
        continue
    x = want.get(oid)
    if x is None or c.get("oddments_stamp") != x["stamp"]:
        removed += x is None
        for ob in list(c.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(c)
    else:
        have[oid] = c
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
# catalogs: one per Oddments collection, kept in the library folder's catalog file next to what is there already
cats_file = os.path.join(os.path.dirname(lib), "blender_assets.cats.txt")
lines = open(cats_file, encoding="utf-8").read().splitlines() if os.path.exists(cats_file) else ["# This is an Asset Catalog Definition file for Blender.", "", "VERSION 1", ""]
known = {l.split(":")[1]: l.split(":")[0] for l in lines if l and not l.startswith("#") and not l.startswith("VERSION") and l.count(":") >= 2}
def cat(path):
    if path not in known:
        u = str(uuid.uuid5(uuid.NAMESPACE_URL, "oddments:" + path))
        known[path] = u
        lines.append("%s:%s:%s" % (u, path, path.replace("/", "-")))
    return known[path]
tmp = tempfile.mkdtemp(prefix="oddments-sync-")
def get(rel, name):
    dest = os.path.join(tmp, name)
    q = urllib.parse.urlencode({"token": tok, "path": rel})
    with _open("%s/file?%s" % (base, q), timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    return dest
def imp(path):
    e = os.path.splitext(path)[1].lower()
    if e in (".glb", ".gltf"): bpy.ops.import_scene.gltf(filepath=path)
    elif e == ".fbx": bpy.ops.import_scene.fbx(filepath=path)
    elif e == ".obj": bpy.ops.wm.obj_import(filepath=path)
    elif e == ".stl": bpy.ops.wm.stl_import(filepath=path)
    elif e == ".ply": bpy.ops.wm.ply_import(filepath=path)
    elif e == ".abc": bpy.ops.wm.alembic_import(filepath=path, as_background_job=False)
    elif e in (".usd", ".usdz", ".usdc"): bpy.ops.wm.usd_import(filepath=path)
    elif e == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
added, failed = 0, []
for x in a["items"]:
    if x["id"] in have:
        continue
    try:
        path = get(x["file"], "m-" + x["id"] + x["ext"])
        before = set(bpy.data.objects)
        imp(path)
        new = [o for o in bpy.data.objects if o not in before]
        if a.get("smooth", "ANGLE") != "NONE" and x["ext"] != ".blend":
            for o in new:
                me = o.data if o.type == "MESH" else None
                if me is None or not me.polygons or me.has_custom_normals:
                    continue
                sh = me.attributes.get("sharp_edge")
                keep = None
                if sh and sh.domain == "EDGE" and sh.data_type == "BOOLEAN":
                    keep = [False] * len(me.edges); sh.data.foreach_get("value", keep)
                me.shade_smooth()
                me.set_sharp_from_angle(angle=a.get("angle", 0.5236))
                if keep and any(keep):
                    sh = me.attributes["sharp_edge"]; now = [False] * len(me.edges); sh.data.foreach_get("value", now)
                    sh.data.foreach_set("value", [u or v for u, v in zip(now, keep)])
        if not new:
            raise RuntimeError("в файле нет объектов")
        coll = bpy.data.collections.new(x["name"])
        for o in new:
            for uc in list(o.users_collection):
                uc.objects.unlink(o)
            coll.objects.link(o)
        coll["oddments_id"], coll["oddments_stamp"] = x["id"], x["stamp"]
        coll.use_fake_user = True
        coll.asset_mark()
        ad = coll.asset_data
        ad.description = "Из Oddments" + (" · " + x["folder"] if x["folder"] else "")
        for t in x["tags"][:16]:
            try: ad.tags.new(t, skip_if_exists=True)
            except Exception: pass
        ad.catalog_id = cat("Oddments/Модели" + ("/" + x["folder"].replace("/", "-") if x["folder"] else ""))
        if x.get("thumb"):
            try:
                img = bpy.data.images.load(get(x["thumb"], "t-" + x["id"] + os.path.splitext(x["thumb"])[1]))
                w, h = img.size
                k = 256 / max(w, h, 1)
                if k < 1:
                    img.scale(max(1, int(w * k)), max(1, int(h * k)))
                coll.preview_ensure()
                coll.preview.image_size = img.size[:]
                coll.preview.image_pixels_float[:] = img.pixels[:]
                bpy.data.images.remove(img)
            except Exception as e:
                print("ODDMENTS-PREVIEW-FAIL", x["name"], e)
        added += 1
    except Exception as e:
        failed.append("%s: %s" % (x["name"], e))
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
open(cats_file, "w", encoding="utf-8").write("\n".join(lines) + "\n")
bpy.ops.wm.save_as_mainfile(filepath=lib, compress=True)
if os.path.exists(lib + "1"):
    os.remove(lib + "1")
shutil.rmtree(tmp, ignore_errors=True)
print("ODDMENTS-SYNC " + json.dumps({"added": added, "removed": removed, "kept": len(have), "failed": failed[:5]}, ensure_ascii=False))
"""

_SYNC = {"busy": False, "msg": "", "thread": None, "result": None}


def _models_lib_path():
    return os.path.join(matlib_dir(), MODELS_FILE)


def _sync_items():
    """Oddments' models (the receiver's /items) as the background script wants them."""
    with _open(_url("/items"), timeout=6) as r:
        items = json.loads(r.read().decode())
    try:
        with _open(_url("/library"), timeout=6) as r:
            folders = {f["id"]: f["name"] for f in json.loads(r.read().decode()).get("folders", [])}
    except Exception:
        folders = {}
    out = []
    for it in items:
        ext = os.path.splitext(it.get("file") or "")[1].lower()
        if it.get("kind") != "model" or ext not in MODEL_EXT:
            continue
        fo = next((folders[f] for f in it.get("folders") or [] if f in folders), "")
        out.append({"id": it["id"], "name": it.get("name") or "Model", "file": it["file"], "ext": ext, "thumb": it.get("thumb") or "",
                    "tags": [t for t in it.get("tags") or [] if t], "folder": fo, "stamp": "%s|%s" % (it["file"], it.get("added", ""))})
    return out


class PERCH_OT_sync_models(bpy.types.Operator):
    bl_idname = "perch.sync_models"
    bl_label = "Модели Oddments → Asset Browser"
    bl_description = ("Все модели из Oddments — ассетами в Asset Browser Blender (библиотека «Oddments»): с превью, тегами и "
                      "каталогами по подборкам. Повторный запуск добавит новые и уберёт удалённые")

    def execute(self, context):
        if _SYNC["busy"]:
            self.report({"INFO"}, _t("Синхронизация уже идёт"))
            return {"CANCELLED"}
        try:
            items = _sync_items()
        except Exception as e:
            self.report({"ERROR"}, _t("Oddments не отвечает: %s") % e)
            return {"CANCELLED"}
        if not items:
            self.report({"WARNING"}, _t("В Oddments нет моделей, которые Blender умеет открыть"))
            return {"CANCELLED"}
        d = matlib_dir()
        ensure_asset_library(d)
        lib = os.path.join(d, MODELS_FILE)
        p = _prefs()
        args = json.dumps({"lib": lib, "base": "http://127.0.0.1:%d" % p.port, "token": p.token.strip(), "items": items,
                           "smooth": p.import_smooth, "angle": p.import_smooth_angle})
        cmd = [bpy.app.binary_path, "-b", "--factory-startup"] + ([lib] if os.path.exists(lib) else []) + ["--python-expr", _MODELS_SCRIPT, "--", args]

        def work():
            try:
                flags = 0x08000000 if os.name == "nt" else 0
                with _Lock(d):  # a shared library folder: one writer at a time
                    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600, creationflags=flags)
                line = next((l for l in (r.stdout or "").splitlines() if l.startswith("ODDMENTS-SYNC ")), None)
                _SYNC["result"] = json.loads(line[14:]) if line else {"error": ((r.stderr or r.stdout or "").strip().splitlines() or ["?"])[-1]}
            except Exception as e:
                _SYNC["result"] = {"error": str(e)}

        _SYNC.update(busy=True, result=None, msg=_t("Синхронизация: %d моделей…") % len(items))
        _SYNC["thread"] = threading.Thread(target=work, daemon=True)
        _SYNC["thread"].start()
        bpy.app.timers.register(_sync_done, first_interval=1.0)
        self.report({"INFO"}, _t("Модели уходят в Asset Browser в фоне: %d") % len(items))
        return {"FINISHED"}


def _sync_done():
    if _SYNC["result"] is None:
        return 1.0
    r = _SYNC["result"]
    _SYNC["busy"] = False
    if "error" in r:
        _SYNC["msg"] = _t("Не вышло: %s") % r["error"]
    else:
        _SYNC["msg"] = _t("Asset Browser: +%d, убрано %d, без изменений %d%s") % (r["added"], r["removed"], r["kept"], (_t(" · не открылись: %d") % len(r["failed"])) if r["failed"] else "")
        for f in r["failed"]:
            print("Oddments: модель не вошла в библиотеку —", f)
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            a.tag_redraw()
    return None


# ---------- the model check: what breaks a model on the way to a render, a game engine or a print ----------
def _check_object(ob, depsgraph=None):
    """[(level, text)] for one mesh object; level: 'err' / 'warn' / 'ok'."""
    import bmesh
    out = []
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    sc = ob.scale
    if any(abs(v - 1.0) > 1e-4 for v in sc):
        out.append(("warn", _t("Масштаб не применён (%.2f, %.2f, %.2f)") % tuple(sc)))
    if any(v < 0 for v in sc):
        out.append(("err", _t("Отрицательный масштаб — нормали вывернутся при применении")))
    dims = ob.dimensions
    big = max(dims) if dims else 0
    if big > 500:
        out.append(("warn", _t("Огромная модель: %.0f м — проверьте единицы (сантиметры вместо метров?)") % big))
    elif 0 < big < 0.005:
        out.append(("warn", _t("Крошечная модель: %.1f мм — проверьте единицы") % (big * 1000)))
    nonman = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    holes = sum(1 for e in bm.edges if e.is_boundary)
    if nonman:
        out.append(("err", _t("Неманифолдные рёбра: %d (больше двух граней на ребре)") % nonman))
    if holes:
        out.append(("warn", _t("Открытые края: %d рёбер — дырки, если модель должна быть замкнутой") % holes))
    loose = sum(1 for v in bm.verts if not v.link_edges)
    if loose:
        out.append(("warn", _t("Висящие вершины: %d") % loose))
    degen = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
    if degen:
        out.append(("err", _t("Грани нулевой площади: %d") % degen))
    ngons = sum(1 for f in bm.faces if len(f.verts) > 4)
    if ngons:
        out.append(("warn", _t("N-гоны: %d (больше 4 вершин) — могут криво сгладиться и триангулироваться") % ngons))
    # normals: an edge where two faces disagree on direction
    flip = 0
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            v1, v2 = e.verts
            # a consistent pair walks the shared edge in opposite directions
            def order(f):
                vs = list(f.verts)
                i = vs.index(v1)
                return vs[(i + 1) % len(vs)] == v2
            if order(f1) == order(f2):
                flip += 1
    if flip:
        out.append(("err", _t("Нормали смотрят в разные стороны на %d рёбрах") % flip))
    dup = 0
    if len(bm.verts) < 200000:
        from mathutils import kdtree
        kd = kdtree.KDTree(len(bm.verts))
        for i, v in enumerate(bm.verts):
            kd.insert(v.co, i)
        kd.balance()
        for v in bm.verts:
            if len(kd.find_range(v.co, 1e-5)) > 1:
                dup += 1
    if dup:
        out.append(("warn", _t("Вершины друг на друге: %d — стоит «Merge by Distance»") % dup))
    if not me.uv_layers:
        out.append(("warn", _t("Нет UV-развёртки — текстуры лягут криво")))
    else:
        uv = bm.loops.layers.uv.active
        outside = 0
        if uv:
            for f in bm.faces:
                for l in f.loops:
                    u, v = l[uv].uv
                    if u < -0.001 or u > 1.001 or v < -0.001 or v > 1.001:
                        outside += 1
                        break
        if outside:
            out.append(("warn", _t("UV за пределами квадрата 0–1 у %d граней") % outside))
    mods = [m for m in ob.modifiers if m.show_viewport]
    if mods:
        out.append(("warn", _t("Не применены модификаторы: %s") % ", ".join(m.name for m in mods[:4])))
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    if tris > 1000000:
        out.append(("warn", _t("Тяжёлая: %s треугольников") % f"{tris:,}".replace(",", " ")))
    if len(ob.material_slots) > 8:
        out.append(("warn", _t("Много материалов: %d") % len(ob.material_slots)))
    empty = sum(1 for s in ob.material_slots if not s.material)
    if empty:
        out.append(("warn", _t("Пустые слоты материалов: %d") % empty))
    bm.free()
    if not out:
        out.append(("ok", _t("Всё в порядке")))
    return out


_CHECK = {"lines": []}


class PERCH_OT_check_model(bpy.types.Operator):
    bl_idname = "perch.check_model"
    bl_label = "Проверить модель"
    bl_description = "Масштаб, единицы, дырки, неманифолд, вывернутые нормали, дубли вершин, n-гоны, UV, модификаторы — у выделенных объектов"

    def execute(self, context):
        obs = [o for o in context.selected_objects if o.type == "MESH"]
        if not obs:
            self.report({"WARNING"}, _t("Выделите меш-объекты"))
            return {"CANCELLED"}
        lines, bad = [], 0
        for ob in obs[:40]:
            res = _check_object(ob)
            bad += sum(1 for lv, _ in res if lv != "ok")
            lines.append(("head", ob.name))
            lines.extend(res)
        _CHECK["lines"] = lines

        def draw(menu, _ctx):
            col = menu.layout.column(align=True)
            for lv, text in _CHECK["lines"]:
                if lv == "head":
                    col.separator()
                    col.label(text=text, icon="OBJECT_DATA")
                else:
                    col.label(text=text, icon={"err": "ERROR", "warn": "INFO", "ok": "CHECKMARK"}[lv])
            col.separator()
            col.operator(PERCH_OT_fix_model.bl_idname, icon="TOOL_SETTINGS")
        title = _t("Проверка: замечаний %d") % bad if bad else _t("Проверка: всё в порядке")
        if bpy.app.background:  # no window to pop up in (a popup there crashes Blender): the console
            print(title, *(text for _lv, text in _CHECK["lines"]), sep="\n")
            return {"FINISHED"}
        context.window_manager.popup_menu(draw, title=title, icon="VIEWZOOM")
        return {"FINISHED"}


class PERCH_OT_fix_model(bpy.types.Operator):
    bl_idname = "perch.fix_model"
    bl_label = "Исправить, что можно"
    bl_description = ("Применить масштаб и поворот, склеить вершины друг на друге, убрать висящие вершины и грани нулевой "
                      "площади, развернуть нормали наружу. Дырки, n-гоны и UV не трогаются. Ctrl+Z вернёт как было")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        import bmesh
        obs = [o for o in context.selected_objects if o.type == "MESH"]
        if not obs:
            self.report({"WARNING"}, _t("Выделите меш-объекты"))
            return {"CANCELLED"}
        shared = [o for o in obs if o.data.users > 1]
        for o in obs:
            if o.data.users > 1:
                continue  # an instance shares its mesh: applying would change the others too
            mw = Matrix.LocRotScale(None, o.matrix_basis.to_quaternion(), o.matrix_basis.to_scale())
            o.data.transform(mw)
            o.matrix_basis = Matrix.Translation(o.matrix_basis.to_translation())
            if mw.determinant() < 0:
                o.data.flip_normals()
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
            loose = [v for v in bm.verts if not v.link_edges]
            if loose:
                bmesh.ops.delete(bm, geom=loose, context="VERTS")
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()
        self.report({"INFO"}, _t("Исправлено объектов: %d%s") % (len(obs) - len(shared), (_t(" · пропущены общие меши: %d") % len(shared)) if shared else ""))
        return {"FINISHED"}


# ---------- smart UV: seams from the shape, then Blender's minimum-stretch unwrap and packing ----------
# 1) seams on sharp edges (angle above the threshold) and on marked Sharp edges; 2) each part gets the cuts it needs to
# lie flat (a cut graph, see smart_seams: a tube's rims joined, a torus opened, a sphere cut); 3) Blender unwraps; 4) every
# island is measured (angle error, stretch, flipped faces) and a bad one is split in two and unwrapped again (refine_uv),
# up to 8 rounds; then with «Minimum Stretch» (SLIM, 4.3+) or
# «Angle Based», then packs the islands with rotation. Existing seams are replaced; Ctrl+Z brings them back.
def _regions(bm, seam):
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, reg = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            reg.append(g)
            for e in g.edges:
                if seam[e.index]:
                    continue
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(reg)
    return out


def _path(bm, starts, goals, allowed):
    """Shortest edge path (Dijkstra over edge lengths) from any of `starts` to any of `goals`, inside `allowed` edges."""
    import heapq
    dist, prev, heap = {}, {}, []
    for v in starts:
        dist[v.index] = 0.0
        heapq.heappush(heap, (0.0, v.index, v))
    goal = {v.index for v in goals}
    while heap:
        d, i, v = heapq.heappop(heap)
        if d > dist.get(i, 1e30):
            continue
        if i in goal and d > 0:
            path, k = [], i
            while k in prev:
                e, k = prev[k]
                path.append(e)
            return path
        for e in v.link_edges:
            if e.index not in allowed:
                continue
            w = e.other_vert(v)
            nd = d + e.calc_length()
            if nd < dist.get(w.index, 1e30):
                dist[w.index] = nd
                prev[w.index] = (e, i)
                heapq.heappush(heap, (nd, w.index, w))
    return []


def smart_seams(me, angle_deg=66.0):
    """Seams that let every part lie flat. Sharp edges first; then, in each part, a cut graph (tree–cotree): a spanning
    tree of the faces across the part's edges keeps the long smooth edges joined, the edges left out — pruned of dead
    ends, kept where they reach the part's border — are exactly the cuts the part needs to become a disk (one cut joins
    a tube's two rims, two loops open a torus). A closed part with nothing left (a sphere) is cut between its two
    farthest points. Returns (seam edges, edges added by the cut graph)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    lim = math.radians(angle_deg)
    seam = [False] * len(bm.edges)
    # Sharp marks count when they are a choice: a flat-shaded import (OBJ without smoothing) marks every edge
    sharp_ok = sum(1 for e in bm.edges if not e.smooth) < 0.5 * max(1, len(bm.edges))
    for e in bm.edges:
        if e.is_boundary or not e.is_manifold or (sharp_ok and not e.smooth) or e.calc_face_angle(0.0) > lim:
            seam[e.index] = True
    added = 0
    for reg in _regions(bm, seam):
        if len(reg) < 2:
            continue
        inner = {}
        for f in reg:
            for e in f.edges:
                if not seam[e.index] and len(e.link_faces) == 2:
                    inner[e.index] = e
        # the dual tree: Kruskal over faces, the longest and flattest edges joined first
        parent = {f.index: f.index for f in reg}

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        tree = set()
        for e in sorted(inner.values(), key=lambda e: -e.calc_length() * (1.0 + math.cos(min(e.calc_face_angle(0.0), math.pi)))):
            a, b = root(e.link_faces[0].index), root(e.link_faces[1].index)
            if a != b:
                parent[a] = b
                tree.add(e.index)
        cut = {i for i in inner if i not in tree}
        # prune dead ends; a vertex on the part's border (a seam or an open edge) anchors the cut
        border_v = {v.index for f in reg for e in f.edges if seam[e.index] for v in e.verts}
        at = {}
        for i in cut:
            for v in inner[i].verts:
                at.setdefault(v.index, set()).add(i)
        stack = [v for v, es in at.items() if len(es) == 1 and v not in border_v]
        while stack:
            v = stack.pop()
            if len(at.get(v, ())) != 1:
                continue
            i = next(iter(at[v]))
            cut.discard(i)
            for w in inner[i].verts:
                at[w.index].discard(i)
                if len(at[w.index]) == 1 and w.index not in border_v:
                    stack.append(w.index)
        if not cut and not border_v:
            vs = list({v for f in reg for v in f.verts})
            far = lambda s: max(vs, key=lambda v: (v.co - s.co).length)
            b = far(vs[0])
            cut = {e.index for e in _path(bm, [b], [far(b)], set(inner))}
        for i in cut:
            if not seam[i]:
                seam[i] = True
                added += 1
    for e in bm.edges:
        e.seam = seam[e.index]
    bm.to_mesh(me)
    bm.free()
    me.update()
    return sum(seam), added


def _island_quality(faces, uv):
    """(mean angle error in degrees, area distortion, share of flipped faces) of one island: scale-free — the UV areas
    are compared with the 3D areas as shares of the island's own totals."""
    a3 = [f.calc_area() for f in faces]
    def a2(f):
        p = [l[uv].uv for l in f.loops]
        return sum(p[i].x * p[(i + 1) % len(p)].y - p[(i + 1) % len(p)].x * p[i].y for i in range(len(p))) / 2
    s2 = [a2(f) for f in faces]
    t3, t2 = sum(a3) or 1e-12, sum(abs(x) for x in s2) or 1e-12
    sign = 1 if sum(s2) >= 0 else -1
    flips = sum(1 for x in s2 if x * sign < -1e-14) / max(1, len(faces))
    area = sum(abs(math.log(max(abs(b) / t2, 1e-12) / max(a / t3, 1e-12))) * a / t3 for a, b in zip(a3, s2))
    ang, w = 0.0, 0.0
    for f, a in zip(faces, a3):
        ls = f.loops
        for i in range(len(ls)):
            p0, p1, p2 = ls[i - 1], ls[i], ls[(i + 1) % len(ls)]
            v1, v2 = p0.vert.co - p1.vert.co, p2.vert.co - p1.vert.co
            u1, u2 = p0[uv].uv - p1[uv].uv, p2[uv].uv - p1[uv].uv
            if v1.length < 1e-12 or v2.length < 1e-12 or u1.length < 1e-12 or u2.length < 1e-12:
                continue
            ang += abs(v1.angle(v2) - u1.angle(u2)) * a
            w += a
    return (math.degrees(ang / w) if w else 0.0), area, flips


def _bisect(bm, faces, seam):
    """Split an island in two. First by the way its faces look (two groups of normals, k-means seeded with the two most
    different ones, smoothed by neighbours): the cut then runs along a bevel or a fold — where a person would put it on a
    hard-surface model or an icon. When the normals barely differ (a smooth, nearly flat island), by distance: the two
    faces farthest apart grow regions until they meet. The edges between the halves become a seam. → new seam edges."""
    import heapq
    fs = set(faces)
    nbr = {f: [g for e in f.edges if not seam[e.index] for g in e.link_faces if g is not f and g in fs] for f in faces}
    side = None
    area = {f: f.calc_area() for f in faces}
    n0 = max(faces, key=lambda f: area[f]).normal.copy()
    n1 = min(faces, key=lambda f: f.normal.dot(n0)).normal.copy()
    if n0.dot(n1) < 0.6:
        for _ in range(8):
            side = {f: f.normal.dot(n0) >= f.normal.dot(n1) for f in faces}
            a, b = Vector(), Vector()
            for f in faces:
                (a if side[f] else b).__iadd__(f.normal * area[f])
            if a.length < 1e-12 or b.length < 1e-12:
                side = None
                break
            n0, n1 = a.normalized(), b.normalized()
        if side:
            for _ in range(3):  # a face goes with most of its neighbours: no specks
                side = {f: (sum(1 for g in nbr[f] if side[g]) * 2 > len(nbr[f])) if nbr[f] else side[f] for f in faces}
            if all(side.values()) or not any(side.values()):
                side = None
    if side is None:
        def walk(start):
            dist = {start: 0.0}
            heap = [(0.0, start.index, start)]
            while heap:
                d, _, f = heapq.heappop(heap)
                if d > dist.get(f, 1e30):
                    continue
                c = f.calc_center_median()
                for g in nbr[f]:
                    nd = d + (g.calc_center_median() - c).length
                    if nd < dist.get(g, 1e30):
                        dist[g] = nd
                        heapq.heappush(heap, (nd, g.index, g))
            return dist
        d0 = walk(faces[0])
        a = max(d0, key=d0.get)
        da = walk(a)
        b = max(da, key=da.get)
        db = walk(b)
        side = {f: da.get(f, 1e30) <= db.get(f, 1e30) for f in faces}
    added = 0
    for f in faces:
        for e in f.edges:
            if seam[e.index] or len(e.link_faces) != 2:
                continue
            g = e.link_faces[0] if e.link_faces[1] is f else e.link_faces[1]
            if g in fs and side[g] != side[f]:
                seam[e.index] = True
                e.seam = True
                added += 1
    return added



def _uv_score(o):
    """One number for a layout (lower is better): mean angle error in degrees, stretch between islands, flipped faces,
    and a mild price per island (fewer seams to paint over)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    if uv is None or not bm.faces:
        bm.free()
        return 1e9
    parent = list(range(len(bm.faces)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a, b = e.link_faces
        la = {l.vert.index: l[uv].uv for l in a.loops}
        lb = {l.vert.index: l[uv].uv for l in b.loops}
        if all((la[v.index] - lb[v.index]).length < 1e-6 for v in e.verts):
            parent[root(a.index)] = root(b.index)
    islands = len({root(i) for i in range(len(bm.faces))})
    ang, area, flips = _island_quality(list(bm.faces), uv)
    bm.free()
    return ang + 8.0 * area + 400.0 * flips + 2.0 * math.log10(islands + 1)


def best_uv(o, ours):
    """Our layout against Blender's Smart UV Project on a second UV layer: the better one stays. → 'ours' | 'smart'"""
    me = o.data
    name = me.uv_layers.active.name  # layer references go stale when a layer is added or removed: names only
    s_ours = _uv_score(o)
    alt_name = me.uv_layers.new(name="UV_smart").name
    me.uv_layers.active = me.uv_layers[alt_name]
    sel = [x for x in bpy.context.selected_objects]
    for x in sel:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o
    # Smart UV Project also cuts at seams: ours come off for its try and go back if ours win
    seams = [e.use_seam for e in me.edges]
    for e in me.edges:
        e.use_seam = False
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    s_smart = _uv_score(o)
    for x in sel:
        x.select_set(True)
    if s_smart < s_ours:
        # the smart layout goes into the layer the materials read; seams follow its islands
        src, dst = me.uv_layers[alt_name].data, me.uv_layers[name].data
        for i in range(len(dst)):
            dst[i].uv = src[i].uv
        me.uv_layers.remove(me.uv_layers[alt_name])
        me.uv_layers.active = me.uv_layers[name]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        try:
            bpy.ops.uv.seams_from_islands()
        except Exception:
            pass
        bpy.ops.object.mode_set(mode="OBJECT")
        return "smart"
    me.uv_layers.remove(me.uv_layers[alt_name])
    me.uv_layers.active = me.uv_layers[name]
    for e, v in zip(me.edges, seams):
        e.use_seam = v
    return "ours"

def _shoelace(f, uv):
    p = [l[uv].uv for l in f.loops]
    return sum(p[i].x * p[(i + 1) % len(p)].y - p[(i + 1) % len(p)].x * p[i].y for i in range(len(p))) / 2


def _island_score(q):
    """(angle error, stretch, share of flipped faces) of an island as one number, lower is better."""
    return q[0] + 8.0 * q[1] + 400.0 * q[2]


def slit_path(bm, faces, uv, seam):
    """The cut that relieves a stretched island without splitting it (as in Geometry Images, Gu, Gortler, Hoppe 2002):
    from its most squeezed inner vertex — the UV share of its faces far below their 3D share, where the surface bulges
    like a fingertip — by the shortest way to the island's edge. → edges, or [] when nothing is squeezed."""
    a3 = {f: f.calc_area() for f in faces}
    a2 = {f: abs(_shoelace(f, uv)) for f in faces}
    t3, t2 = sum(a3.values()) or 1e-12, sum(a2.values()) or 1e-12
    acc = {}
    for f in faces:
        s = math.log(max(a2[f] / t2, 1e-12) / max(a3[f] / t3, 1e-12))
        for v in f.verts:
            x = acc.setdefault(v, [0.0, 0.0])
            x[0] += s * a3[f]
            x[1] += a3[f]
    fs = set(faces)
    border, allowed = set(), set()
    for f in faces:
        for e in f.edges:
            if seam[e.index] or len(e.link_faces) != 2 or any(g not in fs for g in e.link_faces):
                border.update(e.verts)
            else:
                allowed.add(e.index)
    inner = [(x[0] / x[1], v) for v, x in acc.items() if x[1] > 0 and v not in border]
    if not inner or not border:
        return []
    s, v = min(inner, key=lambda t: t[0])
    if s > -0.15:
        return []
    return _path(bm, [v], list(border), allowed)


def _unwrap_selected(margin, iterations=30):
    """Blender's Minimum Stretch (SLIM, 4.3+) on the selected faces; Angle Based before it."""
    try:
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=margin, iterations=iterations, fill_holes=True)
    except TypeError:
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=margin)


def refine_uv(o, margin=0.004, rounds=8, max_angle=4.0, max_area=0.12, max_flip=0.003, slit_angle=2.5, slit_area=0.06):
    """Unwrap and measure every island. A stretched island first gets a slit (slit_path), kept when it lowers the
    island's score by 15 % without overlaps; when a slit does not help and the island is bad (angle, stretch, flipped
    faces, or it covers a place twice) it is split in two (_bisect). Rounds until every island is good or they run out;
    a round looks only at the islands the previous one unwrapped. The object is selected and active. → {split, slit}"""
    import bmesh
    me = o.data
    its = 30 if len(me.polygons) <= 30000 else 20
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    _unwrap_selected(margin, its)
    stat = {"split": 0, "slit": 0}
    noslit = set()  # islands (by their first face) where a slit did not help
    dirty = None  # faces unwrapped in the previous round
    for _ in range(rounds):
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        uv = bm.loops.layers.uv.active
        seam = [e.seam for e in bm.edges]
        tries, cut = [], []
        for reg in _regions(bm, seam):
            if len(reg) < 6 or (dirty is not None and reg[0].index not in dirty):
                continue
            q = _island_quality(reg, uv)
            bad = q[0] > max_angle or q[1] > max_area or q[2] > max_flip or _overlaps(reg, uv)
            key = min(f.index for f in reg)
            if (bad or q[0] > slit_angle or q[1] > slit_area or q[2] > 0) and key not in noslit:
                p = slit_path(bm, reg, uv, seam)
                if p:
                    for e in p:
                        e.seam = True
                    tries.append(([f.index for f in reg], [e.index for e in p], q, bad, key))
                    continue
            if bad:
                cut.append(([f.index for f in reg], True))
        if not tries and not cut:
            break
        dirty = {i for t in tries for i in t[0]} | {i for c in cut for i in c[0]}
        if tries:
            for f in bm.faces:
                f.select = False
            for t in tries:
                for i in t[0]:
                    bm.faces[i].select = True
            bmesh.update_edit_mesh(me)
            _unwrap_selected(margin, its)
            bm = bmesh.from_edit_mesh(me)
            bm.faces.ensure_lookup_table()
            bm.edges.ensure_lookup_table()
            uv = bm.loops.layers.uv.active
            for ids, path, q0, bad, key in tries:
                faces = [bm.faces[i] for i in ids]
                if _island_score(_island_quality(faces, uv)) < 0.85 * _island_score(q0) and not _overlaps(faces, uv):
                    stat["slit"] += 1
                    continue
                noslit.add(key)
                for i in path:
                    bm.edges[i].seam = False
                cut.append((ids, bad))  # a bad island is split; a fine one is unwrapped again without the slit
            bmesh.update_edit_mesh(me)
        if cut:
            bm = bmesh.from_edit_mesh(me)
            bm.faces.ensure_lookup_table()
            bm.edges.ensure_lookup_table()
            seam = [e.seam for e in bm.edges]
            for f in bm.faces:
                f.select = False
            for ids, split in cut:
                faces = [bm.faces[i] for i in ids]
                if split and _bisect(bm, faces, seam):
                    stat["split"] += 1
                for f in faces:
                    f.select = True
            bmesh.update_edit_mesh(me)
            _unwrap_selected(margin, its)
    bpy.ops.object.mode_set(mode="OBJECT")
    return stat


# ---------- smart UV 2 (26.10.2026): straight ribbons, extruded shapes, three layouts compete ----------
# Measured on the user's 3D icons (Key, Face ID, Figner, plate, Glass Plate) and test shapes, against the previous
# pipeline: quad strips (bevels, walls, tubes) are laid out straight (Follow Active Quads, kept only when the island stays
# unfolded and stretches little), tubes and tori are cut along their own quad lines, an extruded shape (an icon, a logo)
# gets front / back / wall seams at 45° with the wall in even pieces, and islands are packed without free rotation (a
# straight ribbon stays straight). Our seams, Blender's Smart UV Project and the extruded seams are each laid out this way
# and the best by layout_score stays. Key: angle error 2.7° → 0.5°, stretch 0.05 → 0.01; Glass Plate: the square filled
# 38 % → 58 %; Face ID: straight quads 15 % → 55 %.
import bmesh


def _islands_uv(bm, uv):
    """Faces grouped by shared UVs (what the texture sees as one piece)."""
    parent = list(range(len(bm.faces)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f0, f1 = e.link_faces
        l0 = {l.vert.index: l[uv].uv for l in f0.loops}
        l1 = {l.vert.index: l[uv].uv for l in f1.loops}
        if all((l0[v.index] - l1[v.index]).length < 1e-6 for v in e.verts):
            parent[root(f0.index)] = root(f1.index)
    out = {}
    for f in bm.faces:
        out.setdefault(root(f.index), []).append(f)
    return list(out.values())


def _overlaps(faces, uv, n=96):
    """Does the island cover any place twice? Face centres of a coarse grid inside each UV polygon."""
    pts = [[l[uv].uv.copy() for l in f.loops] for f in faces]
    xs = [p.x for ps in pts for p in ps]; ys = [p.y for ps in pts for p in ps]
    x0, y0, w, h = min(xs), min(ys), (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9
    k = n / max(w, h)
    seen = set()
    for ps in pts:
        cx0 = int((min(p.x for p in ps) - x0) * k); cx1 = int((max(p.x for p in ps) - x0) * k)
        cy0 = int((min(p.y for p in ps) - y0) * k); cy1 = int((max(p.y for p in ps) - y0) * k)
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                x, y = x0 + (cx + 0.5) / k, y0 + (cy + 0.5) / k
                inside = False
                j = len(ps) - 1
                for i in range(len(ps)):
                    if (ps[i].y > y) != (ps[j].y > y) and x < (ps[j].x - ps[i].x) * (y - ps[i].y) / ((ps[j].y - ps[i].y) or 1e-12) + ps[i].x:
                        inside = not inside
                    j = i
                if inside:
                    if (cx, cy) in seen:
                        return True
                    seen.add((cx, cy))
    return False


def straighten(o, max_area=0.1):
    """Quad islands laid out as a straight grid (Follow Active Quads, average lengths) — a bevel or a wall becomes a
    ribbon, a tube a rectangle. Kept only when the island stays unfolded and stretches little more (angle error
    +1.5° at most)."""
    me = o.data
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    islands = [[f.index for f in isl] for isl in _islands_uv(bm, uv)]
    done = 0
    for ids in islands:
        bm = bmesh.from_edit_mesh(me); bm.faces.ensure_lookup_table(); uv = bm.loops.layers.uv.active
        faces = [bm.faces[i] for i in ids]
        if len(faces) < 3 or any(len(f.verts) != 4 for f in faces):
            continue
        ang0, area0, fl0 = _island_quality(faces, uv)
        keep = [[l[uv].uv.copy() for l in f.loops] for f in faces]
        # the active quad: the most rectangular one in 3D; its UV becomes a rectangle of its own edge lengths, turned
        # like its current UV so the island stays where it was
        def squareness(f):
            ls = f.loops
            return sum(abs((ls[i - 1].vert.co - ls[i].vert.co).angle(ls[(i + 1) % 4].vert.co - ls[i].vert.co, math.pi / 2) - math.pi / 2) for i in range(4))
        act = min(faces, key=squareness)
        ls = act.loops
        e0 = (ls[1].vert.co - ls[0].vert.co).length; e1 = (ls[2].vert.co - ls[1].vert.co).length
        u0 = ls[0][uv].uv.copy(); d = ls[1][uv].uv - u0
        s = d.length / e0 if e0 > 1e-12 and d.length > 1e-12 else 1.0
        ux = d.normalized() if d.length > 1e-12 else Vector((1, 0))
        uy = Vector((-ux.y, ux.x))
        # keep the UV winding
        side = (ls[2][uv].uv - ls[1][uv].uv).dot(uy)
        if side < 0:
            uy = -uy
        corners = [u0, u0 + ux * e0 * s, u0 + ux * e0 * s + uy * e1 * s, u0 + uy * e1 * s]
        for l, c in zip(ls, corners):
            l[uv].uv = c
        for f in bm.faces:
            f.select = False
        for f in faces:
            f.select = True
        bm.faces.active = act
        bmesh.update_edit_mesh(me)
        ok = True
        try:
            bpy.ops.uv.follow_active_quads(mode="LENGTH_AVERAGE")
        except Exception:
            ok = False
        bm = bmesh.from_edit_mesh(me); bm.faces.ensure_lookup_table(); uv = bm.loops.layers.uv.active
        faces = [bm.faces[i] for i in ids]
        if ok:
            ang1, area1, fl1 = _island_quality(faces, uv)
            ov = _overlaps(faces, uv)
            ok = fl1 <= fl0 + 1e-9 and area1 <= max(max_area, area0 * 1.25) and ang1 <= ang0 + 1.5 and not ov
        if not ok:
            for f, k in zip(faces, keep):
                for l, c in zip(f.loops, k):
                    l[uv].uv = c
        else:
            done += 1
        bmesh.update_edit_mesh(me)
    bpy.ops.object.mode_set(mode="OBJECT")
    return done


def _is_straight(faces, uv):
    """A ribbon laid out as a grid: all quads, their UV edges along U or V."""
    if any(len(f.loops) != 4 for f in faces):
        return False
    for f in faces:
        for i in range(4):
            d = f.loops[(i + 1) % 4][uv].uv - f.loops[i][uv].uv
            if d.length > 1e-9:
                t = abs(math.degrees(math.atan2(d.y, d.x))) % 90
                if min(t, 90 - t) > 3:
                    return False
    return True


def polish(o, margin):
    """The last unwrap of a layout: every island that is not a straight ribbon is unwrapped again with many more Minimum
    Stretch iterations (Smart UV Project's flat projections too: the same islands, far less stretch on bevels). An
    island that comes out worse or overlapping keeps what it had."""
    me = o.data
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    todo = []
    for faces in _islands_uv(bm, uv):
        if len(faces) > 1 and not _is_straight(faces, uv):
            todo.append(([f.index for f in faces], [[l[uv].uv.copy() for l in f.loops] for f in faces], _island_score(_island_quality(faces, uv))))
    if todo:
        for f in bm.faces:
            f.select = False
        for ids, _, _ in todo:
            for i in ids:
                bm.faces[i].select = True
        bmesh.update_edit_mesh(me)
        _unwrap_selected(margin, 60 if len(me.polygons) <= 30000 else 30)
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        uv = bm.loops.layers.uv.active
        for ids, keep, s0 in todo:
            faces = [bm.faces[i] for i in ids]
            if _island_score(_island_quality(faces, uv)) <= s0 and not _overlaps(faces, uv):
                continue
            for f, k in zip(faces, keep):
                for l, c in zip(f.loops, k):
                    l[uv].uv = c
        bmesh.update_edit_mesh(me)
    bpy.ops.object.mode_set(mode="OBJECT")


def _hull(pts):
    pts = sorted(set((round(p[0], 9), round(p[1], 9)) for p in pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def min_rect(pts):
    """The smallest rectangle around the points: (long side, short side, unit vector along the long side)."""
    h = _hull(pts)
    best = None
    for i in range(len(h) if len(h) >= 3 else 0):
        dx, dy = h[(i + 1) % len(h)][0] - h[i][0], h[(i + 1) % len(h)][1] - h[i][1]
        L = math.hypot(dx, dy)
        if L < 1e-12:
            continue
        ux, uy = dx / L, dy / L
        a = [p[0] * ux + p[1] * uy for p in h]
        b = [p[1] * ux - p[0] * uy for p in h]
        w, t = max(a) - min(a), max(b) - min(b)
        if best is None or w * t < best[0]:
            best = (w * t, w, t, (ux, uy))
    if best is None:
        return 0.0, 0.0, (1.0, 0.0)
    _, w, t, (ux, uy) = best
    return (w, t, (ux, uy)) if w >= t else (t, w, (-uy, ux))


def cut_long(o, thr=1.15, piece=0.75, most=24):
    """An island much longer than the layout is wide (a tube, a knot, a long wall) makes the packer shrink everything:
    it is cut across, evenly, into pieces about `piece` × √(UV area) long. → islands cut"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    S = sum(abs(_shoelace(f, uv)) for f in bm.faces)
    n = 0
    for faces in (_islands_uv(bm, uv) if S > 1e-12 else []):
        L, W, (ux, uy) = min_rect([(l[uv].uv.x, l[uv].uv.y) for f in faces for l in f.loops])
        if L <= thr * math.sqrt(S) or len(faces) < 8:
            continue
        k = min(most, max(2, math.ceil(L / (piece * math.sqrt(S)))))
        ts = {f: sum(l[uv].uv.x * ux + l[uv].uv.y * uy for l in f.loops) / len(f.loops) for f in faces}
        t0 = min(ts.values())
        step = (max(ts.values()) - t0) / k or 1e-9
        part = {f: min(k - 1, int((ts[f] - t0) / step)) for f in faces}
        for f in faces:
            for e in f.edges:
                if len(e.link_faces) == 2:
                    g = e.link_faces[0] if e.link_faces[1] is f else e.link_faces[1]
                    if g in part and part[g] != part[f]:
                        e.seam = True
        # the pieces apart in UV (the packer finds islands by shared UVs): each a step across the strip
        for f in faces:
            for l in f.loops:
                l[uv].uv += Vector((-uy, ux)) * (W * 0.1 * part[f])
        n += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    return n


def _uv_get(me):
    import numpy as np
    d = me.uv_layers.active.data
    a = np.empty(len(d) * 2, dtype=np.float32)
    d.foreach_get("uv", a)
    return a


def _uv_set(me, a):
    me.uv_layers.active.data.foreach_set("uv", a)
    me.update()


def _uv_shares(me):
    """(UV area of all faces — the share of the square filled once packed, share of it in straight ribbons)"""
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    a = st = 0.0
    for faces in _islands_uv(bm, uv):
        x = sum(abs(_shoelace(f, uv)) for f in faces)
        a += x
        if _is_straight(faces, uv):
            st += x
    bm.free()
    return a, (st / a if a > 1e-12 else 0.0)


def _pack(margin, rotate_method, shape):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(rotate=True, rotate_method=rotate_method, margin=margin, shape_method=shape)
    except TypeError:  # before 3.6
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def pack_best(o, margin, floor=None):
    """One texel density, then the packing that fills the square most: by boxes (instant) axis-aligned and with 90°
    turns; by exact shapes (nests notches and holes, finds a better scale even for rectangles, but can take many seconds
    on a few long islands: skipped once slow, or when `floor` is given and the boxes stay below it); at any angle when
    no island is a straight ribbon. → share of the square filled"""
    import time
    me = o.data
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    base = _uv_get(me)
    ways = [("AXIS_ALIGNED", "AABB"), ("CARDINAL", "AABB"), ("AXIS_ALIGNED", "CONCAVE")]
    if _uv_shares(me)[1] < 0.1:
        ways.append(("ANY", "CONCAVE"))
    best, slow = None, False
    for rm, sh in ways:
        if sh == "CONCAVE" and (slow or (floor is not None and best[0] < floor)):
            continue
        _uv_set(me, base)
        t = time.time()
        _pack(margin, rm, sh)
        slow = sh == "CONCAVE" and time.time() - t > 2.0
        c = _uv_shares(me)[0]
        if best is None or c > best[0] + 1e-4:
            best = (c, _uv_get(me))
    _uv_set(me, best[1])
    return best[0]


def finish(o, margin):
    """Pack; then long islands are cut into pieces (cut_long) when the square fills noticeably better. → islands cut"""
    me = o.data
    c0 = pack_best(o, margin)
    keep_uv, keep_seam = _uv_get(me), [e.use_seam for e in me.edges]
    n = cut_long(o)
    if n:
        if pack_best(o, margin, floor=c0 * 1.05) > c0 * 1.15 + 0.03:
            return n
        _uv_set(me, keep_uv)
        for e, s in zip(me.edges, keep_seam):
            e.use_seam = s
    return 0


# ---------- straight cuts for quad tubes and tori (instead of the zigzag the cut graph gives) ----------
def _opposite(v, e, inside):
    """Across a regular quad vertex: the edge that continues `e` straight on (not sharing a face with it), or None."""
    if len(v.link_edges) != 4 or len(v.link_faces) != 4 or any(f.index not in inside for f in v.link_faces):
        return None
    fe = set(f.index for f in e.link_faces)
    rest = [x for x in v.link_edges if x is not e and not (set(f.index for f in x.link_faces) & fe)]
    return rest[0] if len(rest) == 1 else None


def _walk(e, v, inside, stop):
    """Edges from `e` straight on through `v` and onwards until a vertex for which stop(vertex) is true (→ path, end)
    or the walk comes back to `e` (→ loop, None); [] when it cannot go on (a pole, the region's end)."""
    path = [e]
    for _ in range(100000):
        if stop(v):
            return path, v
        n = _opposite(v, path[-1], inside)
        if n is None:
            return [], None
        if n is e:
            return path, None
        path.append(n)
        v = n.other_vert(v)
    return [], None


def straight_cuts(bm, reg, seam, every=None):
    """Cuts for a region of quads shaped like a tube (two rims) or a torus (no rims), along the mesh's own lines →
    set of edge indices, or None when the region is something else."""
    if any(len(f.verts) != 4 for f in reg):
        return None
    inside = {f.index for f in reg}
    es = {e.index: e for f in reg for e in f.edges}
    vs = {v.index: v for f in reg for v in f.verts}
    if len(vs) - len(es) + len(reg) != 0:
        return None
    rim = {i for i, e in es.items() if seam[i] or sum(1 for f in e.link_faces if f.index in inside) < 2}
    rim_v = {v.index for i in rim for v in es[i].verts}
    inner = [e for i, e in es.items() if i not in rim]
    if not inner:
        return None
    # rims: connected groups of rim edges
    if rim:
        comp, cid = {}, 0
        for i in rim:
            if i in comp:
                continue
            stack = [i]; comp[i] = cid
            while stack:
                j = stack.pop()
                for v in es[j].verts:
                    for x in v.link_edges:
                        if x.index in rim and x.index not in comp:
                            comp[x.index] = cid; stack.append(x.index)
            cid += 1
        if cid != 2:
            return None
        vcomp = {v.index: comp[i] for i in rim for v in es[i].verts}
        best = None
        found = []
        for e in inner:
            a, b = e.verts
            for start, nxt in ((a, b), (b, a)):
                if start.index not in rim_v:
                    continue
                path, end = _walk(e, nxt, inside, lambda v: v.index in rim_v)
                if path and end is not None and vcomp.get(end.index) != vcomp[start.index]:
                    L = sum(x.calc_length() for x in path)
                    found.append((start if vcomp[start.index] == 0 else end, L, path))
                    if best is None or L < best[0]:
                        best = (L, path)
        if every is not None:
            every.extend(found)
            every.append(("rim", [es[i] for i in rim if comp[i] == 0]))
        return {x.index for x in best[1]} if best else None
    # a torus: the shortest closed line, then one crossing it
    loops = []
    for e in inner[:: max(1, len(inner) // 60)]:
        path, end = _walk(e, e.verts[1], inside, lambda v: False)
        if path and end is None:
            loops.append((sum(x.calc_length() for x in path), path))
    if not loops:
        return None
    loops.sort(key=lambda t: t[0])
    first = loops[0][1]
    on = {x.index for x in first}
    for x in first:
        for v in x.verts:
            for c in v.link_edges:
                if c.index in on or c.index not in es:
                    continue
                path, end = _walk(c, c.other_vert(v), inside, lambda w: False)
                if path and end is None:
                    return on | {y.index for y in path}
    return None


def smart_seams_straight(me, angle_deg=66.0):
    """The add-on's seams, with tubes and tori cut along their own quad lines."""
    smart_seams(me, angle_deg)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    # sharp seams only (the cut graph's own cuts are redone where a straight cut fits)
    lim = math.radians(angle_deg)
    sharp_ok = sum(1 for e in bm.edges if not e.smooth) < 0.5 * max(1, len(bm.edges))
    hard = [e.is_boundary or not e.is_manifold or (sharp_ok and not e.smooth) or e.calc_face_angle(0.0) > lim for e in bm.edges]
    seam = [e.seam for e in bm.edges]
    n = 0
    for reg in _regions(bm, hard):
        cut = straight_cuts(bm, reg, hard)
        if cut is None:
            continue
        for f in reg:
            for e in f.edges:
                if not hard[e.index]:
                    seam[e.index] = e.index in cut
        n += 1
    for e in bm.edges:
        e.seam = seam[e.index]
    bm.to_mesh(me); bm.free(); me.update()
    return n


def layout_score(o):
    """The add-on's score (angle error, stretch, flips, islands) minus what a texture artist gains: how much of the
    square the islands fill and how much of the quad area lies in straight rows. Lower is better."""
    base = _uv_score(o)
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    used = qa = qs = 0.0
    for f in bm.faces:
        p = [l[uv].uv for l in f.loops]
        used += abs(sum(p[i].x * p[(i + 1) % len(p)].y - p[(i + 1) % len(p)].x * p[i].y for i in range(len(p))) / 2)
        if len(p) == 4:
            A = f.calc_area(); qa += A
            if all(min(t, 90 - t) <= 3 for t in (abs(math.degrees(math.atan2((p[(i + 1) % 4] - p[i]).y, (p[(i + 1) % 4] - p[i]).x))) % 90 for i in range(4) if (p[(i + 1) % 4] - p[i]).length > 1e-9)):
                qs += A
    bm.free()
    return base - 10.0 * min(1.0, used) - 3.0 * (qs / qa if qa else 0.0)


# ---------- extruded shapes (icons, logos, lettering): front, back and a straight wall ----------
def extrude_seams(me, angle_deg=66.0):
    """For a shape pushed out along one axis: faces facing the axis within 45° are the front or the back, the rest the
    wall; seams between them (smoothed so they follow the mesh's rows), plus sharp edges. Walls are then cut straight
    and laid out as ribbons. → False when the mesh is not such a shape."""
    bm = bmesh.new(); bm.from_mesh(me)
    bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    area = [f.calc_area() for f in bm.faces]
    tot = sum(area) or 1e-12
    best = None
    for ax in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
        cap = sum(a for f, a in zip(bm.faces, area) if abs(f.normal.dot(ax)) > 0.95) / tot
        wall = sum(a for f, a in zip(bm.faces, area) if abs(f.normal.dot(ax)) < 0.1) / tot
        if best is None or cap + wall > best[0]:
            best = (cap + wall, cap, wall, ax)
    share, cap, wall, ax = best
    if share < 0.6 or cap < 0.15 or wall < 0.05:
        bm.free()
        return False
    c45 = math.cos(math.radians(45))
    lab = [1 if f.normal.dot(ax) > c45 else (-1 if f.normal.dot(ax) < -c45 else 0) for f in bm.faces]
    for _ in range(2):  # a face goes with most of its neighbours: the seam runs along a row, not in steps
        new = lab[:]
        for f in bm.faces:
            nb = [lab[g.index] for e in f.edges for g in e.link_faces if g is not f]
            if nb:
                top = max(set(nb), key=nb.count)
                if nb.count(top) * 2 > len(nb) and top != lab[f.index]:
                    new[f.index] = top
        lab = new
    lim = math.radians(angle_deg)
    sharp_ok = sum(1 for e in bm.edges if not e.smooth) < 0.5 * max(1, len(bm.edges))
    seam = [False] * len(bm.edges)
    for e in bm.edges:
        if e.is_boundary or not e.is_manifold or (sharp_ok and not e.smooth) or e.calc_face_angle(0.0) > lim:
            seam[e.index] = True
        elif len(e.link_faces) == 2 and lab[e.link_faces[0].index] != lab[e.link_faces[1].index]:
            seam[e.index] = True
    # walls: a straight cut (tube); a wall that is not a clean quad band gets the cut graph's cuts later from refine
    for reg in _regions(bm, seam):
        if lab[reg[0].index] != 0:
            continue
        cands = []
        cut = straight_cuts(bm, reg, seam, cands)
        if cut:
            for i in cut:
                seam[i] = True
            for i in band_pieces(cands):
                seam[i] = True
        else:
            # not a clean band: cut it like the add-on does (between its two farthest points)
            inner = {e.index for f in reg for e in f.edges if not seam[e.index]}
            vs = list({v for f in reg for v in f.verts})
            far = lambda s: max(vs, key=lambda v: (v.co - s.co).length)
            b = far(vs[0])
            for e in _path(bm, [b], [far(b)], inner):
                seam[e.index] = True
    for e in bm.edges:
        e.seam = seam[e.index]
    bm.to_mesh(me); bm.free(); me.update()
    return True


def band_pieces(cands, aspect_per_piece=2.0, most=12):
    """A long wall band packs badly as one ribbon: more straight cross cuts, evenly along it, so each piece is about
    `aspect_per_piece` times longer than tall. cands: the rim-to-rim paths straight_cuts found, the last entry the rim."""
    if not cands or cands[-1][0] != "rim":
        return set()
    rim = cands[-1][1]; paths = cands[:-1]
    if len(paths) < 2:
        return set()
    # the rim in order, with the length run so far at each vertex
    at = {}
    for e in rim:
        for v in e.verts:
            at.setdefault(v.index, []).append(e)
    start = rim[0].verts[0]
    pos, v, prev, run = {start.index: 0.0}, start, None, 0.0
    for _ in range(len(rim)):
        nxt = [e for e in at.get(v.index, []) if e is not prev]
        if not nxt:
            break
        e = nxt[0]
        run += e.calc_length()
        prev, v = e, e.other_vert(v)
        if v.index in pos:
            break
        pos[v.index] = run
    L = run
    H = sum(p[1] for p in paths) / len(paths)
    k = max(1, min(most, int(round(L / (H * aspect_per_piece))))) if H > 1e-9 else 1
    if k < 2:
        return set()
    ps = sorted(((pos[p[0].index], p) for p in paths if p[0].index in pos), key=lambda t: t[0])
    if not ps:
        return set()
    out, used = set(), set()
    first = ps[0][0]
    for j in range(1, k):
        target = (first + j * L / k) % L
        t, p = min(ps, key=lambda t: min(abs(t[0] - target), L - abs(t[0] - target)))
        if id(p) in used:
            continue
        used.add(id(p))
        out |= {x.index for x in p[2]}
    return out


# ---------- smart UV 3 (26.10.2026): slits, polish, long islands cut, the fuller packing ----------
# Measured against Blender's Smart UV Project and xatlas on the user's 3D icons and 11 test shapes (organic, tubes,
# hard surface): a stretched island first gets a slit from its most squeezed point to its edge (it stays one piece) and
# is split only when that does not help; every layout gets a last unwrap with many Minimum Stretch iterations (Smart UV
# Project's islands too); long islands are cut across when the square fills better; packing by boxes, by exact shapes
# and at any angle when nothing is a straight ribbon — the fullest stays. Knot: the square filled 6 % → 71 %; Suzanne:
# islands 32 → 24, angle error 3.0° → 1.8°; Face ID: stretch 0.09 → 0.02.
def smart_uv_best(o, angle=66.0, margin=0.004):
    """Up to three layouts — our seams (slits first, then splits), Blender's Smart UV Project and the extruded-shape
    seams — each straightened, unwrapped once more with many iterations (polish) and packed (long islands cut when the
    square fills better); the best by layout_score stays in the object's UV layer, its seams on the mesh."""
    import numpy as np
    me = o.data
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.context.view_layer.objects.active = o
    main = me.uv_layers.active.name
    tries = []

    def ours():
        smart_seams_straight(me, angle)
        refine_uv(o, margin=margin)
        return True

    def smart():
        for e in me.edges:
            e.use_seam = False
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
        bpy.ops.uv.select_all(action="SELECT")
        try:
            bpy.ops.uv.seams_from_islands()  # its islands as seams: the polish and the cuts go by them
        except Exception:
            pass
        bpy.ops.object.mode_set(mode="OBJECT")
        return True

    def extruded():
        if not extrude_seams(me, angle):
            return False
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        _unwrap_selected(margin)
        bpy.ops.object.mode_set(mode="OBJECT")
        return True

    for name, make in (("ours", ours), ("smart", smart), ("extruded", extruded)):
        lay = me.uv_layers.new(name="UV_try_" + name).name
        me.uv_layers.active = me.uv_layers[lay]
        if not make():
            me.uv_layers.remove(me.uv_layers[lay])
            continue
        n = straighten(o)
        polish(o, margin)
        cut = finish(o, margin)
        tries.append((layout_score(o), name, lay, n, [e.use_seam for e in me.edges], cut))
    if not tries:
        return "none"
    tries.sort(key=lambda t: t[0])
    score, name, lay, n, seams, cut = tries[0]
    a = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[lay].data.foreach_get("uv", a)
    me.uv_layers[main].data.foreach_set("uv", a)
    for t in tries:
        me.uv_layers.remove(me.uv_layers[t[2]])
    me.uv_layers.active = me.uv_layers[main]
    for e, v in zip(me.edges, seams):
        e.use_seam = v
    return name + f"+straight{n}+cut{cut} " + " ".join(f"{t[1]}={t[0]:.1f}" for t in tries)


class PERCH_OT_smart_uv(bpy.types.Operator):
    bl_idname = "perch.smart_uv"
    bl_label = "Умная UV-развёртка"
    bl_description = ("Швы по форме (острые и Sharp-рёбра, разрезы трубок и замкнутых частей, у выдавленных форм — лицо, "
                      "тыл и стенка); растянутый остров сначала надрезается, а не делится; полосы выпрямляются в ленты, "
                      "длинные режутся на куски, чтобы квадрат заполнялся плотно. Из трёх раскладок остаётся лучшая. "
                      "Старые швы заменяются, Ctrl+Z вернёт")
    bl_options = {"REGISTER", "UNDO"}

    angle: bpy.props.FloatProperty(name="Шов от угла", default=66.0, min=10.0, max=120.0, subtype="NONE")
    margin: bpy.props.FloatProperty(name="Отступ островов", default=0.004, min=0.0, max=0.05, precision=3)

    def execute(self, context):
        obs = [o for o in context.selected_objects if o.type == "MESH"]
        if not obs:
            self.report({"WARNING"}, _t("Выделите меш-объекты"))
            return {"CANCELLED"}
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        keep = list(context.selected_objects)
        picks = []
        for o in obs:
            if not o.data.uv_layers:
                o.data.uv_layers.new(name="UVMap")
            picks.append(smart_uv_best(o, self.angle, self.margin).split("+")[0])
        for o in context.view_layer.objects:
            o.select_set(o in keep)
        context.view_layer.objects.active = obs[0]
        smart, ext = picks.count("smart"), picks.count("extruded")
        extra = (_t(" · как выдавленная форма: %d") % ext if ext else "") + (_t(" · на островах Smart UV Project: %d") % smart if smart else "")
        self.report({"INFO"}, _t("Развёрнуто объектов: %d%s") % (len(obs), extra))
        return {"FINISHED"}


_keymaps = []


# ---------- light and render presets of the team: <library folder>/presets/<name>.json ----------
# Saved from a scene (lights, world, colour management, render settings) and applied to another one: renders of the
# team look alike. In a shared library folder everyone has the same presets.
def _presets_dir(create=False):
    d = os.path.join(matlib_dir(create=create), "presets")
    if create:
        os.makedirs(d, exist_ok=True)
    return d


_PRESET_ITEMS = []


def _preset_items(self, context):
    d = _presets_dir()
    names = sorted(os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith(".json")) if os.path.isdir(d) else []
    _PRESET_ITEMS[:] = [(n, n, "") for n in names] or [("", _t("Пресетов пока нет"), "")]  # Blender keeps no reference itself
    return _PRESET_ITEMS


def _light_data(sc):
    lights = []
    for o in sc.objects:
        if o.type != "LIGHT":
            continue
        L = o.data
        lights.append({"name": o.name, "type": L.type, "energy": L.energy, "color": list(L.color), "loc": list(o.location),
                       "rot": list(o.rotation_euler), "size": getattr(L, "size", 0.25), "size_y": getattr(L, "size_y", 0.25),
                       "shape": getattr(L, "shape", "SQUARE"), "spot": getattr(L, "spot_size", 0.8), "angle": getattr(L, "angle", 0.0)})
    w = sc.world
    bg = None
    if w and w.use_nodes:
        n = w.node_tree.nodes.get("Background")
        if n:
            bg = {"color": list(n.inputs[0].default_value), "strength": n.inputs[1].default_value}
    r, v = sc.render, sc.view_settings
    return {"v": 1, "lights": lights, "world": bg, "view": v.view_transform, "look": v.look, "exposure": v.exposure, "gamma": v.gamma,
            "engine": r.engine, "film_transparent": r.film_transparent, "res": [r.resolution_x, r.resolution_y],
            "samples": getattr(sc.cycles, "samples", None) if r.engine == "CYCLES" else None}


def _apply_light(sc, p):
    coll = bpy.data.collections.get("Свет · Oddments") or bpy.data.collections.new("Свет · Oddments")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    for o in list(coll.objects):  # the previous preset's lights go; the scene's own lights stay
        bpy.data.objects.remove(o, do_unlink=True)
    for l in p.get("lights", []):
        data = bpy.data.lights.new(l["name"], l["type"])
        data.energy = l["energy"]
        data.color = l["color"][:3]
        for k, a in (("size", "size"), ("size_y", "size_y"), ("shape", "shape"), ("spot", "spot_size"), ("angle", "angle")):
            if hasattr(data, a):
                try:
                    setattr(data, a, l[k])
                except (KeyError, TypeError, ValueError):
                    pass
        o = bpy.data.objects.new(l["name"], data)
        o.location, o.rotation_euler = l["loc"], l["rot"]
        coll.objects.link(o)
    if p.get("world"):
        if not sc.world:
            sc.world = bpy.data.worlds.new("World")
        sc.world.use_nodes = True
        n = sc.world.node_tree.nodes.get("Background")
        if n:
            n.inputs[0].default_value = p["world"]["color"]
            n.inputs[1].default_value = p["world"]["strength"]
    v, r = sc.view_settings, sc.render
    for k, a in (("view", "view_transform"), ("look", "look"), ("exposure", "exposure"), ("gamma", "gamma")):
        try:
            setattr(v, a, p[k])
        except (KeyError, TypeError):
            pass
    try:
        r.engine = p["engine"]
    except (KeyError, TypeError):
        pass
    r.film_transparent = bool(p.get("film_transparent"))
    if p.get("res"):
        r.resolution_x, r.resolution_y = p["res"]
    if p.get("samples") and r.engine == "CYCLES":
        sc.cycles.samples = p["samples"]


class PERCH_OT_light_save(bpy.types.Operator):
    bl_idname = "perch.light_save"
    bl_label = "Сохранить свет и рендер как пресет"
    bl_description = "Свет сцены, мир, цветокоррекция и настройки рендера — в пресет библиотеки (в общей папке — для всей команды)"
    name: bpy.props.StringProperty(name="Название", default="Студия")

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        n = _file_name(self.name.strip() or _t("Пресет"))
        with open(os.path.join(_presets_dir(create=True), n + ".json"), "w", encoding="utf-8") as f:
            json.dump(_light_data(context.scene), f, ensure_ascii=False, indent=1)
        try:
            context.window_manager.perch_light = n
        except TypeError:
            pass
        self.report({"INFO"}, _t("Пресет «%s» сохранён") % n)
        return {"FINISHED"}


class PERCH_OT_light_apply(bpy.types.Operator):
    bl_idname = "perch.light_apply"
    bl_label = "Применить пресет"
    bl_description = "Поставить свет пресета (в коллекцию «Свет · Oddments») и его мир и настройки рендера"

    def execute(self, context):
        n = context.window_manager.perch_light
        p = os.path.join(_presets_dir(), (n or "") + ".json")
        if not n or not os.path.exists(p):
            self.report({"WARNING"}, _t("Сначала сохраните пресет"))
            return {"CANCELLED"}
        with open(p, encoding="utf-8") as f:
            _apply_light(context.scene, json.load(f))
        self.report({"INFO"}, _t("Пресет «%s»") % n)
        return {"FINISHED"}


class PERCH_PT_panel(bpy.types.Panel):
    bl_label = "Oddments"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Oddments"

    def draw(self, context):
        col = self.layout.column(align=True)
        if not _prefs().token.strip():
            col.label(text=_t("Нужен токен из Oddments"), icon="ERROR")
            col.operator("preferences.addon_show", text=_t("Вставить токен…"), icon="PREFERENCES").module = ADDON
            col.separator()
        big = col.row(align=True)
        big.scale_y = 2.0
        if _UI["op"] is None:
            big.operator(PERCH_OT_browser.bl_idname, text=_t("Открыть Oddments"), icon="ASSET_MANAGER")
        else:
            big.operator(PERCH_OT_browser_close.bl_idname, text=_t("Закрыть Oddments"), icon="X")
        col.label(text=_t("Модели, материалы, иконки, всё остальное — в панели во вьюпорте · Ctrl+Shift+P"))


class PERCH_PT_all(bpy.types.Panel):
    """The same commands as a plain Blender list (search F3, hotkeys, Quick Favorites)."""
    bl_label = "Все команды списком"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Oddments"
    bl_parent_id = "PERCH_PT_panel"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        col = self.layout.column(align=True)
        col.operator(PERCH_OT_insert.bl_idname, icon="IMPORT")
        col.operator(PERCH_OT_swap.bl_idname, text=_t("Заменить на выделенное в Oddments"), icon="FILE_REFRESH")
        col.separator()
        col.operator(PERCH_OT_send_selected.bl_idname, icon="EXPORT")
        col.operator(PERCH_OT_send_file.bl_idname, icon="FILE_BLEND")
        col.operator(PERCH_OT_send_snapshot.bl_idname, icon="RESTRICT_RENDER_OFF")
        col.operator(PERCH_OT_splat_cycles.bl_idname, icon="POINTCLOUD_DATA")
        col.separator()
        col.operator(PERCH_OT_save_material_lib.bl_idname, text=_t("Материал в библиотеку"), icon="ASSET_MANAGER")
        col.operator(PERCH_OT_save_material_lib.bl_idname, text=_t("Все материалы сцены в библиотеку"), icon="MATERIAL_DATA").all_scene = True
        row = col.row(align=True)
        row.enabled = not _SYNC["busy"]
        row.operator(PERCH_OT_sync_models.bl_idname, text=_t("Синхронизация…") if _SYNC["busy"] else _t("Модели → Asset Browser"), icon="ASSET_MANAGER")
        if _SYNC["msg"]:
            col.label(text=_SYNC["msg"], icon="TIME" if _SYNC["busy"] else "INFO")
        col.separator()
        col.label(text=_t("Свет и рендер команды:"))
        row = col.row(align=True)
        row.prop(context.window_manager, "perch_light", text="")
        row.operator(PERCH_OT_light_apply.bl_idname, text="", icon="LIGHT_AREA")
        col.operator(PERCH_OT_light_save.bl_idname, icon="ADD")
        col.separator()
        col.label(text=_t("Модель:"))
        col.operator(PERCH_OT_check_model.bl_idname, icon="VIEWZOOM")
        col.operator(PERCH_OT_fix_model.bl_idname, icon="TOOL_SETTINGS")
        col.operator(PERCH_OT_smart_uv.bl_idname, icon="UV")
        col.separator()
        col.label(text=_t("Иконки:"))
        col.operator(PERCH_OT_render_icons.bl_idname, icon="RENDER_STILL")
        col.operator(PERCH_OT_icon_style_save.bl_idname, icon="ADD")
        col.separator()
        col.label(text=_t("Для приложения Oddments (с переделкой):"))
        col.operator(PERCH_OT_send_material.bl_idname, icon="MATERIAL")
        col.operator(PERCH_OT_send_scene_materials.bl_idname, icon="MATERIAL_DATA")
        col.operator(PERCH_OT_apply_material.bl_idname, icon="SHADING_TEXTURE")
        row = col.row(align=True)
        row.prop(_prefs(), "bake", text=_t("Запекать процедурные"))
        sub = row.row(align=True)
        sub.enabled = _prefs().bake
        sub.prop(_prefs(), "bake_size", text="")
        col.separator()
        col.operator(PERCH_OT_check.bl_idname, icon="LINKED")
        col.prop(_prefs(), "receive")


CLASSES = (PERCH_Prefs, PERCH_OT_send_selected, PERCH_OT_send_file, PERCH_OT_send_snapshot, PERCH_OT_send_material, PERCH_OT_send_scene_materials,
           PERCH_OT_apply_material, PERCH_OT_insert, PERCH_OT_check, PERCH_OT_swap, PERCH_OT_place, PERCH_OT_save_material_lib, PERCH_OT_browser,
           PERCH_OT_browser_close, PERCH_OT_sync_models, PERCH_OT_check_model, PERCH_OT_fix_model, PERCH_OT_smart_uv, PERCH_OT_light_save,
           PERCH_OT_light_apply, PERCH_OT_render_icons, PERCH_OT_icon_style_save, PERCH_OT_splat_cycles, PERCH_PT_panel, PERCH_PT_all)
# the panel's «ЕЩЁ» tab runs these by name (perch.<name>) and shows their own label and description as the hint
_OPS = {c.bl_idname.split(".", 1)[1]: c for c in CLASSES if getattr(c, "bl_idname", "").startswith("perch.")}


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    _apply_lang()
    bpy.types.WindowManager.perch_light = bpy.props.EnumProperty(name=_t("Пресет света"), items=_preset_items)
    if not bpy.app.background:
        bpy.app.timers.register(_poll_outbox, first_interval=2.0, persistent=True)
    bpy.app.handlers.load_post.append(_on_load)
    kc = bpy.context.window_manager.keyconfigs.addon
    if kc:  # Ctrl+Shift+P in the 3D view opens / closes the browser (changeable in Preferences › Keymap)
        km = kc.keymaps.new(name="3D View", space_type="VIEW_3D")
        _keymaps.append((km, km.keymap_items.new(PERCH_OT_browser.bl_idname, "P", "PRESS", ctrl=True, shift=True)))


def unregister():
    for km, kmi in _keymaps:
        km.keymap_items.remove(kmi)
    _keymaps.clear()
    if _on_load in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_on_load)
    if _UI["op"] is not None:
        _on_load(None)
    _drop_thumbs()
    if bpy.app.timers.is_registered(_poll_outbox):
        bpy.app.timers.unregister(_poll_outbox)
    del bpy.types.WindowManager.perch_light
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
    try:
        bpy.app.translations.unregister(ADDON)
    except Exception:
        pass
