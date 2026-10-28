# Smart UV for Oddments' «Развернуть UV»: run by src-tauri/src/blender.rs (blender_uv) in a background Blender.
# The same as the Oddments add-on's «Умная UV-развёртка» (keep the two in step): seams by shape, straight ribbons,
# extruded shapes, the best of three layouts (smart_uv_best).
# argv after «--»: input model, output .glb, seam angle. Writes <output>.json with the counts.
import bpy, bmesh, json, math, os, sys
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
src, out, angle = a[0], a[1], float(a[2]) if len(a) > 2 else 66.0


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


bpy.ops.wm.read_factory_settings(use_empty=True)
# ---------- smart UV 2 (26.10.2026): straight ribbons, extruded shapes, three layouts compete ----------
# Measured on the user's 3D icons (Key, Face ID, Figner, plate, Glass Plate) and test shapes, against the previous
# pipeline: quad strips (bevels, walls, tubes) are laid out straight (Follow Active Quads, kept only when the island stays
# unfolded and stretches little), tubes and tori are cut along their own quad lines, an extruded shape (an icon, a logo)
# gets front / back / wall seams at 45° with the wall in even pieces, and islands are packed without free rotation (a
# straight ribbon stays straight). Our seams, Blender's Smart UV Project and the extruded seams are each laid out this way
# and the best by layout_score stays. Key: angle error 2.7° → 0.5°, stretch 0.05 → 0.01; Glass Plate: the square filled
# 38 % → 58 %; Face ID: straight quads 15 % → 55 %.
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


e = os.path.splitext(src)[1].lower()
if e in (".glb", ".gltf"): bpy.ops.import_scene.gltf(filepath=src)
elif e == ".fbx": bpy.ops.import_scene.fbx(filepath=src)
elif e == ".obj": bpy.ops.wm.obj_import(filepath=src)
elif e == ".stl": bpy.ops.wm.stl_import(filepath=src)
elif e == ".ply": bpy.ops.wm.ply_import(filepath=src)
elif e in (".usd", ".usdz", ".usdc"): bpy.ops.wm.usd_import(filepath=src)
elif e == ".abc": bpy.ops.wm.alembic_import(filepath=src, as_background_job=False)
elif e == ".blend":
    with bpy.data.libraries.load(src, link=False) as (s, d):
        d.objects = list(s.objects)
    for ob in d.objects:
        if ob is not None:
            bpy.context.scene.collection.objects.link(ob)
obs = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.data.users == 1]
seams = 0
for o in obs:
    if not o.data.uv_layers:
        o.data.uv_layers.new(name="UVMap")
for o in obs:
    smart_uv_best(o, angle)
seams = sum(sum(1 for e in o.data.edges if e.use_seam) for o in obs)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
open(out + ".json", "w").write(json.dumps({"meshes": len(obs), "seams": seams}))
