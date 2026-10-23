# Oddments — Blender add-on: send models, materials and viewport snapshots to Oddments, insert files selected in Oddments.
# Install: Edit › Preferences › Add-ons › (menu) Install from Disk… → this file. Then paste the token
# from Oddments › Settings › Integrations into the add-on preferences.
# Talks to Oddments' local receiver on 127.0.0.1 only; nothing leaves the computer.
bl_info = {
    "name": "Oddments",
    "author": "Oddments",
    "version": (1, 10, 0),
    "blender": (4, 2, 0),
    "location": "3D Viewport › Sidebar (N) › Oddments",
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


def _prefs():
    return bpy.context.preferences.addons[__name__].preferences


def _url(path, **query):
    p = _prefs()
    query["token"] = p.token.strip()
    return "http://127.0.0.1:%d%s?%s" % (p.port, path, urllib.parse.urlencode(query))


def _ping():
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/ping" % _prefs().port, timeout=1.5) as r:
            return json.loads(r.read().decode()).get("app") == "perch"
    except Exception:
        return False


def _send(filepath, name):
    with open(filepath, "rb") as f:
        data = f.read()
    req = urllib.request.Request(_url("/import", name=name, source="blender"), data=data, method="POST",
                                 headers={"Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode()).get("ok", False)


TOKEN_HINT = "Oddments › Настройки › Интеграции › «Скопировать токен», затем Edit › Preferences › Add-ons › Oddments"


def _no_token(op):
    """True (and a clear message) when the token is not set yet: nothing is sent then."""
    if _prefs().token.strip():
        return False
    op.report({"ERROR"}, "Сначала вставьте токен: " + TOKEN_HINT)
    return True


def _explain(op, err):
    reason = getattr(err, "reason", None)
    if isinstance(err, urllib.error.HTTPError) and err.code == 401:
        op.report({"ERROR"}, "Oddments не принял токен — скопируйте его заново: " + TOKEN_HINT)
    elif isinstance(err, urllib.error.HTTPError) and err.code == 413:
        op.report({"ERROR"}, "Файл больше 1 ГБ — Oddments такие не принимает")
    elif isinstance(err, (ConnectionAbortedError, ConnectionResetError)) or isinstance(reason, (ConnectionAbortedError, ConnectionResetError)):
        # older Oddments closed the connection on a wrong token before reading the file
        op.report({"ERROR"}, "Oddments оборвал соединение — скорее всего, не подошёл токен: " + TOKEN_HINT)
    elif isinstance(err, urllib.error.URLError) or isinstance(err, ConnectionRefusedError):
        op.report({"ERROR"}, "Oddments не отвечает: откройте приложение Oddments (порт %d)" % _prefs().port)
    else:
        op.report({"ERROR"}, "Не получилось: %s" % err)


class PERCH_Prefs(bpy.types.AddonPreferences):
    bl_idname = __name__
    token: bpy.props.StringProperty(name="Токен", description="Из Oddments › Настройки › Интеграции", subtype="PASSWORD")
    port: bpy.props.IntProperty(name="Порт", default=47215, min=1024, max=65535)
    receive: bpy.props.BoolProperty(name="Принимать из Oddments", default=True,
                                    description="Файлы, отправленные кнопкой «В Blender» в Oddments, сразу появляются в сцене")
    bake: bpy.props.BoolProperty(name="Запекать процедурные материалы", default=True,
                                 description="Перед отправкой запечь в текстуры материалы из нод (шум, рампы, группы, Mix Shader): "
                                             "glTF и Oddments переносят только картинки и числа. Ваш .blend не меняется")
    bake_size: bpy.props.EnumProperty(name="Размер текстур", default="1024",
                                      items=[("512", "512", ""), ("1024", "1024", ""), ("2048", "2048", "")])
    mat_dir: bpy.props.StringProperty(name="Библиотека материалов", subtype="DIR_PATH", default="",
                                      description="Папка, где аддон хранит материалы Blender (пусто — Документы/Perch Library/Blender Materials — папка библиотеки Oddments)")
    swap_fit: bpy.props.BoolProperty(name="Подогнать размер при замене", default=False,
                                     description="Вписать новую модель в габариты заменяемого объекта")
    swap_materials: bpy.props.BoolProperty(name="Материалы старого при замене", default=False,
                                           description="Надеть на новую модель материалы заменяемого объекта")

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "token")
        col.prop(self, "port")
        col.prop(self, "receive")
        row = col.row()
        row.prop(self, "bake")
        sub = row.row()
        sub.enabled = self.bake
        sub.prop(self, "bake_size", text="")
        col.label(text="Токен — в Oddments › Настройки › Интеграции, кнопка «Скопировать токен».")
        col.separator()
        col.prop(self, "mat_dir")
        col.label(text="Пусто — " + MATLIB_DEFAULT)


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
                    self.report({"WARNING"}, "Текстуры через узлы, которые glTF не переносит (%s): в Oddments придёт без них. "
                                "Подключите Image Texture прямо к Principled BSDF или запеките карты." % ", ".join(missing[:3]))
                _send(tmp, name + ".glb")
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        finally:
            cleanup()
        self.report({"INFO"}, "Отправлено в Oddments: %s%s" % (name, " (запечено материалов: %d)" % n_baked if n_baked else ""))
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
        self.report({"INFO"}, "Отправлено в Oddments: %s" % base)
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
        name = (bpy.path.display_name_from_filepath(bpy.data.filepath) or "Blender") + " — снимок.png"
        tmp = os.path.join(tempfile.mkdtemp(prefix="perch-"), "snapshot.png")
        try:
            bpy.ops.render.opengl(view_context=True)
            img = bpy.data.images["Render Result"]
            img.save_render(tmp)
            _send(tmp, name)
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        self.report({"INFO"}, "Снимок отправлен в Oddments")
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
        self.report({"INFO"}, "Материал «%s» отправлен в Oddments (текстур: %d)" % (name, n))
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
            self.report({"WARNING"}, "В Oddments: %d, не получилось: %s" % (sent, ", ".join(failed)))
        else:
            self.report({"INFO"}, "Все материалы сцены в Oddments: %d" % sent)
        return {"FINISHED"}


class PERCH_OT_apply_material(bpy.types.Operator):
    bl_idname = "perch.apply_material"
    bl_label = "Применить материал из Oddments"
    bl_description = "Материал, выделенный в Oddments, — на выделенные объекты (текстуры упаковываются в .blend)"

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with urllib.request.urlopen(_url("/selection"), timeout=5) as r:
                paths = [p for p in json.loads(r.read().decode()) if p.lower().endswith(".perchmat")]
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        if not paths:
            self.report({"WARNING"}, "В Oddments не выделен материал")
            return {"CANCELLED"}
        try:
            mat = perchmat_to_material(paths[0])
        except Exception as e:
            self.report({"ERROR"}, "Не удалось прочитать материал: %s" % e)
            return {"CANCELLED"}
        n = assign_material(mat, context.selected_objects)
        self.report({"INFO"}, ("Материал «%s» назначен объектам: %d" % (mat.name, n)) if n
                    else "Материал «%s» добавлен в файл — выделите объекты, чтобы назначить" % mat.name)
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


def import_path(path, assign=True):
    ext = os.path.splitext(path)[1].lower()
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
    elif ext == ".usdz" or ext == ".usd":
        bpy.ops.wm.usd_import(filepath=path)
    elif ext == ".blend":
        _append_blend(path)
    elif ext in IMAGE_EXT:
        _import_image(path)
    elif ext == ".perchmat":
        mat = perchmat_to_material(path)
        if assign:
            assign_material(mat, bpy.context.selected_objects)
    else:
        return False
    return True


class PERCH_OT_insert(bpy.types.Operator):
    bl_idname = "perch.insert"
    bl_label = "Вставить из Oddments"
    bl_description = "Добавить в сцену файлы, выделенные сейчас в Oddments: модели — объектами, картинки — референсами"

    def execute(self, context):
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with urllib.request.urlopen(_url("/selection"), timeout=5) as r:
                paths = json.loads(r.read().decode())
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        if not paths:
            self.report({"WARNING"}, "В Oddments ничего не выделено")
            return {"CANCELLED"}
        done, skipped = 0, 0
        for p in paths:
            try:
                if import_path(p):
                    done += 1
                else:
                    skipped += 1
            except Exception as e:
                print("Oddments: не удалось вставить", p, e)
                skipped += 1
        self.report({"INFO"}, "Вставлено из Oddments: %d%s" % (done, (", пропущено: %d" % skipped) if skipped else ""))
        return {"FINISHED"}


class PERCH_OT_check(bpy.types.Operator):
    bl_idname = "perch.check"
    bl_label = "Проверить подключение"
    bl_description = "Найти Oddments на этом компьютере и проверить токен"

    def execute(self, context):
        if not _ping():
            self.report({"ERROR"}, "Oddments не отвечает: откройте приложение Oddments (порт %d)" % _prefs().port)
            return {"CANCELLED"}
        if _no_token(self):
            return {"CANCELLED"}
        try:
            with urllib.request.urlopen(_url("/selection"), timeout=5) as r:
                n = len(json.loads(r.read().decode()))
        except Exception as e:
            _explain(self, e)
            return {"CANCELLED"}
        self.report({"INFO"}, "Oddments на связи, токен подходит. Выделено в Oddments: %d" % n)
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
    try:
        with urllib.request.urlopen(_url("/outbox"), timeout=0.4) as r:
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
MATLIB_DEFAULT = os.path.join(os.path.expanduser("~"), "Documents", "Perch Library", "Blender Materials")
MATLIB_NAME = "Oddments · материалы"
MATLIB_FILE = "Oddments Materials.blend"
# names from before the rename to Oddments (bug #112): the file, the Asset Library and the hidden collection are
# renamed in place the first time they are met, nothing is copied or lost
OLD_MATLIB_NAME = "Perch · материалы"
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


def _lib_run(add=(), remove=()):
    """Change the library file in a background Blender: add materials from .blend files, remove by name."""
    lib = matlib_path()
    matlib_dir()
    fresh = not os.path.exists(lib)
    args = json.dumps({"lib": lib, "fresh": fresh, "add": list(add), "remove": list(remove)})
    cmd = [bpy.app.binary_path, "-b", "--factory-startup"] + ([] if fresh else [lib]) + ["--python-expr", _LIB_SCRIPT, "--", args]
    flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300, creationflags=flags)
    if "PERCH-LIB-OK" not in (r.stdout or ""):
        tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["?"])[-1]
        raise RuntimeError("библиотека не записалась: " + tail)
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
            if l.name == OLD_MATLIB_NAME:
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
            raise RuntimeError("в библиотеке нет «%s»" % name)
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
            self.report({"WARNING"}, "Выберите объект с материалом")
            return {"CANCELLED"}
        try:
            migrate_old_library()
            names, existed, added = save_materials_to_library(mats)
        except Exception as e:
            self.report({"ERROR"}, "Не сохранилось: %s" % e)
            return {"CANCELLED"}
        msg = ("В библиотеке: «%s»" % mats[0].name) if len(mats) == 1 else "В библиотеке: %d материалов" % len(mats)
        if added:
            msg += " · папка добавлена в Asset Browser («%s»)" % MATLIB_NAME
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
        raise RuntimeError("Этот тип файла в сцену не вставить")
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
        raise RuntimeError("В файле нет объектов")
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
    with urllib.request.urlopen(_url("/selection"), timeout=5) as r:
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
            self.report({"WARNING"}, "Выделите в сцене то, что заменить")
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
                self.report({"WARNING"}, "Выделите модель в Oddments")
                return {"CANCELLED"}
        name = self.name or os.path.splitext(os.path.basename(path))[0]
        try:
            new = _import_objects(path)
        except Exception as e:
            self.report({"ERROR"}, "Не вставилось: %s" % e)
            return {"CANCELLED"}
        sets = [new] + [_copy_tree(new) for _ in targets[1:]]
        done = []
        for old, objs in zip(targets, sets):
            done.append(swap_object(old, objs, name, self.fit, self.keep_materials, context.scene))
        _drop_empty_new_collections()
        _select_only(context, done)
        self.report({"INFO"}, "Заменено на «%s»: %d" % (name, len(done)))
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
            self.report({"ERROR"}, "Не вставилось: %s" % e)
            return {"CANCELLED"}
        root = _group(new, self.name or "Oddments")
        context.view_layer.update()
        root.matrix_world = Matrix.Translation(context.scene.cursor.location) @ root.matrix_world
        _drop_empty_new_collections()
        _select_only(context, [root])
        self.report({"INFO"}, "Вставлено: %s" % (self.name or root.name))
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
                    with urllib.request.urlopen("%s/file?%s" % (self.base, q), timeout=120) as r, open(dest + ".part", "wb") as f:
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
            "ноды остаются нодами. Папка библиотеки видна и в Asset Browser («Oddments · материалы»).", None)
DEL_TIP = ("Убрать из библиотеки", "Удаляет файл материала из библиотеки аддона (нажмите ещё раз, чтобы подтвердить). "
           "Материалы в ваших сценах не трогаются.", None)
TOFILE_TIP = ("В файл", "Материал добавляется в этот .blend как ассет (виден в Asset Browser › Current File), "
              "выделенное не меняется.", "tofile")


class PERCH_OT_browser(bpy.types.Operator):
    bl_idname = "perch.browser"
    bl_label = "Браузер Oddments"
    bl_description = "Модели и материалы из Oddments с превью: вставить, заменить выделенное, назначить материал"

    def invoke(self, context, event):
        if _UI["op"] is not None:
            _UI["op"].closing = True  # a second call closes the open browser
            return {"CANCELLED"}
        # the add-on's own material library works without Oddments; models need Oddments running
        items, note = [], ""
        if not _prefs().token.strip():
            note = "НЕТ ТОКЕНА PERCH — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ"
        else:
            try:
                with urllib.request.urlopen(_url("/items"), timeout=4) as r:
                    items = json.loads(r.read().decode())
            except Exception:
                note = "PERCH НЕ ОТВЕЧАЕТ — ТОЛЬКО БИБЛИОТЕКА МАТЕРИАЛОВ"
        self.area = context.area if context.area and context.area.type == "VIEW_3D" else None
        if self.area is None:
            for a in context.screen.areas:
                if a.type == "VIEW_3D":
                    self.area = a
                    break
        if self.area is None:
            self.report({"ERROR"}, "Нужно окно 3D-вида")
            return {"CANCELLED"}
        self.region = next(r for r in self.area.regions if r.type == "WINDOW")
        self.perch_items = [it for it in items if it.get("kind") in ("model", "material") and it.get("file")]
        try:
            migrate_old_library()
        except Exception as e:
            print("Oddments: старые материалы не перенеслись", e)
        self.reload_lib()
        self.tab = "model" if any(it["kind"] == "model" for it in self.items) or not self.items else "material"
        self.query, self.sel, self.scroll, self.scroll_to = "", None, 0.0, 0.0
        self.hits, self.hover, self.hover_at, self.mouse = [], None, 0.0, (-1, -1)
        self.anim = {}  # hover progress per hit key
        self.opened, self.closing, self.closed_at = time.time(), False, 0.0
        self.status, self.status_kind, self.status_at = "", "ok", 0.0
        self.busy, self.last_click = None, (None, 0.0)
        self.requested = set()
        p = _prefs()
        self.fetch = _Fetcher("http://127.0.0.1:%d" % p.port, p.token.strip())
        self.handle = bpy.types.SpaceView3D.draw_handler_add(self.paint, (), "WINDOW", "POST_PIXEL")
        self.timer = context.window_manager.event_timer_add(1 / 60, window=context.window)
        self.window = context.window
        context.window_manager.modal_handler_add(self)
        _UI["op"] = self
        if note:
            self.say(note, "warn")
        elif not self.items:
            self.say("В Oddments пока нет моделей и материалов", "warn")
        self.area.tag_redraw()
        return {"RUNNING_MODAL"}

    # ---- data ----
    def reload_lib(self):
        # the add-on's materials first: they are Blender's own, with procedural nodes intact
        try:
            self.items = matlib_items() + self.perch_items
        except Exception as e:
            self.items = list(self.perch_items)
            self.say("БИБЛИОТЕКА МАТЕРИАЛОВ НЕ ЧИТАЕТСЯ: %s" % e, "err")

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
        w = min(372 * s, r.width - right - 24 * s)
        x = r.width - right - w - 12 * s
        top = r.height - 52 * s
        y = 12 * s
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
        _text(x + w / 2, y + h / 2 - 4.2 * s, label, 11 * s, fg, mono=True, center=True, maxw=w - 16 * s)

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
        y_off = (1 - k) * 14 * s
        y += -y_off
        self.hits = []
        gpu.state.blend_set("ALPHA")
        _rect(x, y - 6 * s, w, h, (0, 0, 0, 0.45 * k), radius=22 * s, soft=26 * s)
        _rect(x, y, w, h, _alpha(GLASS, k), radius=20 * s)
        _rect(x, y, w, h, (1, 1, 1, 0.07 * k), radius=20 * s, ring=1.0 * s)
        if k < 0.98:
            pass
        pad = 16 * s
        cx, top = x + pad, y + h - pad
        iw = w - 2 * pad
        # title row
        _text(cx, top - 14 * s, "PERCH", 13 * s, _alpha(INK, k), mono=True)
        _rect(cx + _tw("PERCH", 13 * s, True) + 7 * s, top - 11 * s, 6 * s, 6 * s, _alpha(MAGENTA, k), radius=3 * s)
        _text(cx + _tw("PERCH", 13 * s, True) + 20 * s, top - 14 * s, "// БРАУЗЕР", 11 * s, _alpha(DIM, k), mono=True)
        self.pill("close", x + w - pad - 28 * s, top - 22 * s, 28 * s, 28 * s, "×", "close", ("Закрыть", "Esc или та же кнопка в панели Oddments.", None), s=s)
        # search
        sy = top - 34 * s - 36 * s
        t = self.hit("search", cx, sy, iw, 36 * s, "search")
        _rect(cx, sy, iw, 36 * s, (1, 1, 1, 0.06 + 0.04 * t), radius=18 * s)
        if self.query:
            tw = _text(cx + 16 * s, sy + 13 * s, self.query, 13 * s, INK, maxw=iw - 40 * s)
            if int(now * 2) % 2 == 0:
                _rect(cx + 18 * s + tw, sy + 10 * s, 1.5 * s, 16 * s, LIME)
        else:
            _text(cx + 16 * s, sy + 13 * s, "Поиск: название или тег", 13 * s, DIM)
            if int(now * 2) % 2 == 0 and self.over_panel():
                _rect(cx + 15 * s, sy + 10 * s, 1.5 * s, 16 * s, LIME)
        # tabs
        ty = sy - 12 * s - 28 * s
        nm = sum(1 for it in self.items if it["kind"] == "model")
        nt = sum(1 for it in self.items if it["kind"] == "material")
        l1, l2 = "МОДЕЛИ (%d)" % nm, "МАТЕРИАЛЫ (%d)" % nt
        w1, w2 = _tw(l1, 11 * s, True) + 28 * s, _tw(l2, 11 * s, True) + 28 * s
        self.pill("tab-m", cx, ty, w1, 28 * s, l1, "tab:model", on=self.tab == "model", s=s)
        self.pill("tab-t", cx + w1 + 6 * s, ty, w2, 28 * s, l2, "tab:material", on=self.tab == "material", s=s)
        # footer
        fh = 28 * s + 8 * s + 36 * s
        fy = y + pad
        targets = self.targets(bpy.context)
        it_sel = self.selected_item()
        p = _prefs()
        if self.tab == "model":
            ow = (iw - 6 * s) / 2
            self.pill("fit", cx, fy + 44 * s, ow, 28 * s, "ПОДОГНАТЬ РАЗМЕР", "toggle:fit", FIT_TIP, on=p.swap_fit, s=s)
            self.pill("mats", cx + ow + 6 * s, fy + 44 * s, ow, 28 * s, "МАТЕРИАЛЫ СТАРОГО", "toggle:mats", MATS_TIP, on=p.swap_materials, s=s)
            bw = (iw - 6 * s) / 2
            self.pill("place", cx, fy, bw, 36 * s, "ВСТАВИТЬ", "place", PLACE_TIP, enabled=bool(it_sel) and not self.busy, s=s)
            self.pill("swap", cx + bw + 6 * s, fy, bw, 36 * s, "ЗАМЕНИТЬ · %d" % len(targets), "swap", SWAP_TIP, primary=True,
                      enabled=bool(it_sel and targets) and not self.busy, s=s)
        else:
            ow = (iw - 6 * s) / 2
            ob = bpy.context.active_object
            has = bool(ob and ob.active_material)
            self.pill("save", cx, fy + 44 * s, ow, 28 * s, "+ СОХРАНИТЬ АКТИВНЫЙ", "save", SAVE_TIP, enabled=has and not self.busy, s=s)
            lib = bool(it_sel and it_sel.get("src") == "lib")
            armed = getattr(self, "armed", 0) and now - self.armed < 3
            self.pill("delete", cx + ow + 6 * s, fy + 44 * s, ow, 28 * s, "ТОЧНО УБРАТЬ?" if armed and lib else "УБРАТЬ", "delete", DEL_TIP,
                      enabled=lib and not self.busy, s=s)
            bw = (iw - 6 * s) / 2
            self.pill("tofile", cx, fy, bw, 36 * s, "В ФАЙЛ", "tofile", TOFILE_TIP, enabled=bool(it_sel) and not self.busy, s=s)
            self.pill("assign", cx + bw + 6 * s, fy, bw, 36 * s, "НАЗНАЧИТЬ · %d" % len(targets), "assign", ASSIGN_TIP, primary=True,
                      enabled=bool(it_sel and targets) and not self.busy, s=s)
        # status line
        st_y = fy + fh + 10 * s
        age = now - self.status_at
        if self.busy:
            dots = "·" * (1 + int(now * 3) % 3)
            _text(cx, st_y, self.busy + " " + dots, 11 * s, LIME, mono=True, maxw=iw)
        elif self.status and age < 6:
            a = 1.0 if age < 5 else 1 - (age - 5)
            col = {"ok": LIME, "warn": DIM, "err": MAGENTA}.get(self.status_kind, INK)
            _text(cx, st_y, self.status, 11 * s, _alpha(col, a), mono=True, maxw=iw)
        else:
            hint = "КЛИК — ВЫБРАТЬ · ДВОЙНОЙ — " + ("ЗАМЕНИТЬ" if targets and self.tab == "model" else "НАЗНАЧИТЬ" if targets else "ВСТАВИТЬ" if self.tab == "model" else "В ФАЙЛ")
            _text(cx, st_y, hint, 10 * s, _alpha(DIM, 0.8), mono=True, maxw=iw)
        # grid
        gy0, gy1 = st_y + 22 * s, ty - 14 * s
        self.grid_box = (cx - 4 * s, gy0, iw + 8 * s, gy1 - gy0)
        vis = self.visible()
        cols, gap = 3, 8 * s
        tile = (iw - gap * (cols - 1)) / cols
        row_h = tile + 24 * s
        rows = (len(vis) + cols - 1) // cols
        self.max_scroll = max(0.0, rows * row_h - (gy1 - gy0))
        self.scroll_to = max(0.0, min(self.scroll_to, self.max_scroll))
        self.row_h = row_h
        self.scroll += (self.scroll_to - self.scroll) * 0.3
        if abs(self.scroll - self.scroll_to) < 0.5:
            self.scroll = self.scroll_to
        reg = self.region
        gpu.state.scissor_test_set(True)
        gpu.state.scissor_set(int(reg.x + cx - 6 * s), int(reg.y + gy0), int(iw + 12 * s), int(gy1 - gy0))
        if not vis:
            msg = "Ничего не нашлось" if self.query else ("Моделей нет" if self.tab == "model" else "Пусто — «+ Сохранить активный»")
            _text(cx + iw / 2, (gy0 + gy1) / 2, msg, 13 * s, DIM, center=True)
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
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, 1), radius=14 * s, tex=tex, uv=uv)
            else:
                pulse = 0.05 + 0.03 * math.sin(now * 4 + i)
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, pulse), radius=14 * s)
                self.want_thumb(it)
            if it["id"] == self.sel:
                _rect(tx - g - 3 * s, ty0 - g - 3 * s, tile + 2 * g + 6 * s, tile + 2 * g + 6 * s, LIME, radius=17 * s, ring=2 * s)
            elif t > 0.01:
                _rect(tx - g, ty0 - g, tile + 2 * g, tile + 2 * g, (1, 1, 1, 0.35 * t), radius=14 * s, ring=1.2 * s)
            badge = "BLENDER" if it.get("src") == "lib" else it.get("ext", "").upper()
            _rect(tx + 7 * s, ty0 + 7 * s, _tw(badge, 9 * s, True) + 12 * s, 16 * s, (0, 0, 0, 0.55), radius=8 * s)
            _text(tx + 13 * s, ty0 + 11.5 * s, badge, 9 * s, LIME if it.get("src") == "lib" else INK, mono=True)
            _text(tx + 2 * s, ty0 - 16 * s, it.get("name", ""), 11 * s, INK if it["id"] == self.sel else _mix(DIM, INK, t), maxw=tile - 4 * s)
        gpu.state.scissor_test_set(False)
        # scroll fades: the grid melts into the glass at its edges
        if self.scroll > 1:
            for i in range(10):
                _rect(cx - 6 * s, gy1 - (i + 1) * 2 * s, iw + 12 * s, 2 * s, _alpha(GLASS, 0.9 * (1 - i / 10)))
        if self.scroll < self.max_scroll - 1:
            for i in range(10):
                _rect(cx - 6 * s, gy0 + i * 2 * s, iw + 12 * s, 2 * s, _alpha(GLASS, 0.9 * (1 - i / 10)))
        self.draw_tip(now, s, x)
        gpu.state.blend_set("NONE")

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
            title, body, anim = tip
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
            _text(cx - w / 2 + 8 * s, y + 7 * s, "БЫЛО", 9 * s, _alpha(DIM, k * a_old), mono=True)
            _text(cx + w / 2 - 8 * s, y + 7 * s, "СТАЛО", 9 * s, _alpha(LIME, k * pop), mono=True, right=True)
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
        _UI["op"] = None
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
            self.act(context, "tab:" + ("material" if self.tab == "model" else "model"))
            return {"RUNNING_MODAL"}
        if event.type in {"LEFT_ARROW", "RIGHT_ARROW", "UP_ARROW", "DOWN_ARROW"}:
            self.move({"LEFT_ARROW": -1, "RIGHT_ARROW": 1, "UP_ARROW": -3, "DOWN_ARROW": 3}[event.type])
            return {"RUNNING_MODAL"}
        if event.ctrl or event.oskey or event.alt:
            return {"PASS_THROUGH"}  # Ctrl+Z, Ctrl+S… still work with the pointer over the panel
        if event.unicode and event.unicode.isprintable():
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
        if self.tab == "model":
            self.act(context, "swap" if targets else "place")
        else:
            self.act(context, "assign" if targets else "tofile")

    def act(self, context, action, double=False):
        p = _prefs()
        if action == "close":
            self.close()
        elif action.startswith("tab:"):
            self.tab, self.scroll_to, self.sel = action[4:], 0.0, None
        elif action == "toggle:fit":
            p.swap_fit = not p.swap_fit
        elif action == "toggle:mats":
            p.swap_materials = not p.swap_materials
        elif action.startswith("pick:"):
            self.sel = action[5:]
            if double:
                self.primary(context)
        elif action == "save":
            if not self.busy:
                self.busy = "СОХРАНЯЮ МАТЕРИАЛ"
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
                    self.say("НЕ УДАЛИЛОСЬ: %s" % e, "err")
                    return
                self.sel = None
                self.reload_lib()
                self.say("УБРАНО ИЗ БИБЛИОТЕКИ: " + it["name"].upper())
            else:
                self.armed = time.time()
        elif action in ("swap", "place", "assign", "tofile"):
            it = self.selected_item()
            if not it or self.busy:
                return
            if it.get("src") == "lib":  # already on this computer: nothing to download
                self.run(context, action, it, it["path"])
                return
            self.busy = "СКАЧИВАЮ " + it.get("name", "")[:24].upper()
            self.pending = (action, it)
            self.fetch.get("file", it["id"], it["file"])

    def tick(self, context):
        if self.busy and getattr(self, "pending", (None,))[0] == "save" and time.time() - self.save_at > 0.1:
            self.pending = (None, None)
            ob = context.active_object
            name = ob.active_material.name if ob and ob.active_material else ""
            with context.temp_override(window=self.window, area=self.area, region=self.region):
                try:
                    res = bpy.ops.perch.save_material_lib()
                    self.say(("В БИБЛИОТЕКЕ: " + name.upper()) if "FINISHED" in res else "НЕ ВЫШЛО", "ok" if "FINISHED" in res else "err")
                except Exception as e:
                    self.say("НЕ ВЫШЛО: %s" % e, "err")
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
                    self.say("НЕ СКАЧАЛОСЬ: %s" % err, "err")
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
                    msg = "ЗАМЕНЕНО: " + name.upper()
                elif action == "place":
                    res = bpy.ops.perch.place(filepath=path, name=name)
                    msg = "ВСТАВЛЕНО: " + name.upper()
                else:
                    mat = material_from_library(it["name"]) if it.get("src") == "lib" else perchmat_to_material(path)
                    if action == "assign":
                        n = assign_material(mat, self.targets(context))
                        msg = "НАЗНАЧЕН %s · %d" % (mat.name.upper(), n)
                    else:
                        msg = "В ФАЙЛЕ: " + mat.name.upper()
                    bpy.ops.ed.undo_push(message="Oddments: материал")
                    res = {"FINISHED"}
                self.say(msg if "FINISHED" in res else "НЕ ВЫШЛО", "ok" if "FINISHED" in res else "err")
            except Exception as e:
                self.say("НЕ ВЫШЛО: %s" % e, "err")


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
        op.fetch.stop = True
        try:
            bpy.types.SpaceView3D.draw_handler_remove(op.handle, "WINDOW")
        except Exception:
            pass


_keymaps = []


class PERCH_PT_panel(bpy.types.Panel):
    bl_label = "Oddments"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Oddments"

    def draw(self, context):
        col = self.layout.column(align=True)
        if not _prefs().token.strip():
            col.label(text="Нужен токен из Oddments", icon="ERROR")
            col.operator("preferences.addon_show", text="Вставить токен…", icon="PREFERENCES").module = __name__
            col.separator()
        big = col.row(align=True)
        big.scale_y = 1.6
        if _UI["op"] is None:
            big.operator(PERCH_OT_browser.bl_idname, text="Браузер Oddments", icon="ASSET_MANAGER")
        else:
            big.operator(PERCH_OT_browser_close.bl_idname, text="Закрыть браузер", icon="X")
        col.separator()
        col.operator(PERCH_OT_insert.bl_idname, icon="IMPORT")
        col.operator(PERCH_OT_swap.bl_idname, text="Заменить на выделенное в Oddments", icon="FILE_REFRESH")
        col.separator()
        col.operator(PERCH_OT_send_selected.bl_idname, icon="EXPORT")
        col.operator(PERCH_OT_send_file.bl_idname, icon="FILE_BLEND")
        col.operator(PERCH_OT_send_snapshot.bl_idname, icon="RESTRICT_RENDER_OFF")
        col.separator()
        col.operator(PERCH_OT_save_material_lib.bl_idname, text="Материал в библиотеку", icon="ASSET_MANAGER")
        col.operator(PERCH_OT_save_material_lib.bl_idname, text="Все материалы сцены в библиотеку", icon="MATERIAL_DATA").all_scene = True
        col.separator()
        col.label(text="Для приложения Oddments (с переделкой):")
        col.operator(PERCH_OT_send_material.bl_idname, icon="MATERIAL")
        col.operator(PERCH_OT_send_scene_materials.bl_idname, icon="MATERIAL_DATA")
        col.operator(PERCH_OT_apply_material.bl_idname, icon="SHADING_TEXTURE")
        row = col.row(align=True)
        row.prop(_prefs(), "bake", text="Запекать процедурные")
        sub = row.row(align=True)
        sub.enabled = _prefs().bake
        sub.prop(_prefs(), "bake_size", text="")
        col.separator()
        col.operator(PERCH_OT_check.bl_idname, icon="LINKED")
        col.prop(_prefs(), "receive")


CLASSES = (PERCH_Prefs, PERCH_OT_send_selected, PERCH_OT_send_file, PERCH_OT_send_snapshot, PERCH_OT_send_material, PERCH_OT_send_scene_materials,
           PERCH_OT_apply_material, PERCH_OT_insert, PERCH_OT_check, PERCH_OT_swap, PERCH_OT_place, PERCH_OT_save_material_lib, PERCH_OT_browser,
           PERCH_OT_browser_close, PERCH_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
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
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
