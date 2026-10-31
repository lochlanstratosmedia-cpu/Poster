"""Build the Dove survey vessel in Blender from the written specification.

Run it either way:

  blender --background --python dove/build_dove.py -- [options]
  python dove/build_dove.py [options]          (with the bpy module installed)

Or open it in Blender's Text Editor and press Run Script. With no options it
adds the ship to the open scene and leaves everything else alone.

Options:
  --new-file        start from an empty factory scene first
  --replace         if a DOVE collection already exists, delete only that
                    collection and its objects, then rebuild. Without this flag
                    a versioned collection (DOVE_v2, DOVE_v3, ...) is created.
  --save PATH       save the .blend. An existing file is never overwritten
                    unless --overwrite is also given; a versioned name is used.
  --overwrite       allow --save to replace an existing file
  --render DIR      render side, top, front, rear and beauty PNGs into DIR
  --samples N       Cycles samples for --render (default 64)
  --percent N       render resolution percentage (default 100)
  --check           report overall size, part counts, intersections between
                    major parts and any hardware not connected to the ship

Units are metres. Nose at X=0, nozzle exit at X=60, +X aft, +Z up, spine on
Y=Z=0. Everything is parented to DOVE_ROOT at (30, 0, 0).

Deviations from the written specification (see SPEC NOTES in the code):
  * Tank centres sit at (+/-2.1, +/-2.1) instead of (+/-1.9, +/-1.9). At 1.9 a
    1.65 m sphere passes through the truss rail at (0.8, 0.8).
  * The 2 m aft module is wider than the 1.6 m truss, so the bays over
    X=49..55 keep their rails but drop bracing and frames. The module is held
    by bulkheads at X=49 and X=55.
  * Service pods run X=10.6..13 instead of 10..13 so they clear the 5 m hull;
    the habitat's aft shoulder narrows to make room.
  * Engine chamber and the aft bulkhead take X=55..55.9 before the bell throat.
  * A slim graphite conduit runs inside the truss (from the cinematic image).
"""

import math
import os
import sys

import bpy  # first: the standalone bpy module only exposes bmesh after this
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

VERSION = bpy.app.version
print(f"build_dove: Blender {bpy.app.version_string}")
if VERSION < (4, 0, 0):
    raise RuntimeError("build_dove.py needs Blender 4.0 or newer (Principled BSDF v2 sockets).")

# ---------------------------------------------------------------- spec

LENGTH = 60.0
ROOT_LOC = (30.0, 0.0, 0.0)

NOSE_X = (0.0, 2.0)
HAB_X = (2.0, 11.0)
HAB_R = 2.5
TRUSS_X = (11.0, 55.0)
TRUSS_HALF = 0.8
RAIL_R = 0.08
BRACE_R = 0.045
BAY = 2.0
# SPEC NOTE: spec says 1.9. At 1.9 the spheres intersect the truss rails.
TANK_OFFSET = 2.1
TANK_R = 1.65
TANK_X = 29.0
RAD_STATIONS = (19.0, 45.0)
RAD_LEN_X = 4.0
RAD_Y = (1.0, 10.0)
RAD_THICK = 0.08
SHIELD_X = 35.0
SHIELD_R = 3.5
SHIELD_THICK = 0.25
AFT_X = (49.0, 55.0)
AFT_R = 1.0
ENGINE_X = (55.0, 60.0)
THROAT_R = 0.35
EXIT_R = 1.5
DISH_X = 9.0
DISH_R = 1.2
# SPEC NOTE: spec says X=10..13; starts at 10.6 to clear the habitat hull.
POD_X = (10.6, 13.0)
POD_R = 0.42
POD_Y = 1.95

COLLECTIONS = ["HABITAT", "TRUSS", "TANKS", "RADIATORS", "SHIELD",
               "PROPULSION", "COMMUNICATIONS", "DETAILS", "PRESENTATION"]


# ---------------------------------------------------------------- materials

def _nodes_for(idblock):
    if VERSION < (5, 0, 0) or idblock.node_tree is None:
        idblock.use_nodes = True
    return idblock.node_tree


def _inp(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    raise KeyError(names)


def make_material(name, base, metallic, rough, var=0.06, pattern=None,
                  emission=None, emission_strength=0.0, alpha=None):
    """Principled material with subtle procedural colour and roughness drift."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = _nodes_for(mat)
    nodes, links = nt.nodes, nt.links
    nodes.clear()

    def node(kind, **props):
        n = nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def math_node(op, a, b=None, c=None):
        n = node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                links.new(v, n.inputs[i])
        return n.outputs[0]

    def map_range(value, lo, hi):
        n = node("ShaderNodeMapRange", clamp=True)
        links.new(value, n.inputs["Value"])
        n.inputs["From Min"].default_value = 0.3
        n.inputs["From Max"].default_value = 0.7
        n.inputs["To Min"].default_value = lo
        n.inputs["To Max"].default_value = hi
        return n.outputs["Result"]

    def scale_color(color, factor):
        n = node("ShaderNodeVectorMath", operation="SCALE")
        if isinstance(color, tuple):
            n.inputs[0].default_value = color[:3]
        else:
            links.new(color, n.inputs[0])
        links.new(factor, n.inputs["Scale"])
        return n.outputs["Vector"]

    out = node("ShaderNodeOutputMaterial")
    bsdf = node("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    coord = node("ShaderNodeTexCoord")
    noise = node("ShaderNodeTexNoise")
    links.new(coord.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 5.0

    color = scale_color(tuple(base), map_range(noise.outputs["Fac"], 1.0 - var, 1.0 + var))
    rough_out = map_range(noise.outputs["Fac"], rough - 0.07, rough + 0.07)

    if pattern:
        sep = node("ShaderNodeSeparateXYZ")
        links.new(coord.outputs["Object"], sep.inputs[0])
        x, y, z = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]

        def lines(value, spacing, width):
            return math_node("LESS_THAN", math_node("FRACT", math_node("DIVIDE", value, spacing)),
                             width / spacing)

        if pattern == "hull_seams":
            ring = lines(x, 1.5, 0.012)
            angle = math_node("ADD", math_node("ARCTAN2", z, y), math.pi)
            long_ = lines(angle, 2 * math.pi / 12, 0.005)
            mask = math_node("MAXIMUM", ring, long_)
        elif pattern == "grid":
            mask = math_node("MAXIMUM", lines(x, 0.25, 0.012), lines(y, 0.5, 0.012))
        elif pattern == "rings":
            comb = node("ShaderNodeCombineXYZ")
            links.new(y, comb.inputs["Y"])
            links.new(z, comb.inputs["Z"])
            vm = node("ShaderNodeVectorMath", operation="LENGTH")
            links.new(comb.outputs[0], vm.inputs[0])
            mask = lines(vm.outputs["Value"], 0.42, 0.02)
        else:
            raise ValueError(pattern)
        color = scale_color(color, math_node("MULTIPLY_ADD", mask, -0.5, 1.0))
        rough_out = math_node("MULTIPLY_ADD", mask, 0.15, rough_out)

    links.new(color, bsdf.inputs["Base Color"])
    links.new(rough_out, bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        _inp(bsdf, "Emission Color", "Emission").default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
    return mat


def build_materials():
    m = {}
    m["ivory"] = make_material("DOVE_Ivory", (0.70, 0.64, 0.52), 0.0, 0.48)
    m["hull"] = make_material("DOVE_IvoryHull", (0.70, 0.64, 0.52), 0.0, 0.48, pattern="hull_seams")
    m["plate_new"] = make_material("DOVE_IvoryReplacement", (0.80, 0.77, 0.68), 0.0, 0.38, var=0.02)
    m["orange"] = make_material("DOVE_OrangeStructure", (0.42, 0.15, 0.045), 0.35, 0.45)
    m["copper"] = make_material("DOVE_RadiatorCopper", (0.36, 0.13, 0.05), 0.4, 0.62, var=0.12, pattern="grid")
    m["graphite"] = make_material("DOVE_Graphite", (0.035, 0.036, 0.04), 0.5, 0.5)
    m["shield"] = make_material("DOVE_ShieldGraphite", (0.03, 0.03, 0.034), 0.45, 0.55, pattern="rings")
    m["metal"] = make_material("DOVE_BrushedMetal", (0.55, 0.55, 0.56), 1.0, 0.3, var=0.03)
    m["dark"] = make_material("DOVE_DarkInterior", (0.008, 0.008, 0.009), 0.0, 0.9, var=0.0)
    m["window"] = make_material("DOVE_WindowAmber", (0.05, 0.03, 0.01), 0.0, 0.2, var=0.0,
                                emission=(1.0, 0.52, 0.16), emission_strength=6.0)
    m["exhaust"] = make_material("DOVE_ExhaustFX", (0.0, 0.0, 0.0), 0.0, 1.0, var=0.0,
                                 emission=(0.35, 0.55, 1.0), emission_strength=3.0, alpha=0.15)
    return m


# ---------------------------------------------------------------- mesh building

def axis_matrix(origin, direction, up_hint=None):
    """Matrix whose local +X runs along direction, placed at origin."""
    d = Vector(direction).normalized()
    up = up_hint or ("Z" if abs(d.z) < 0.99 else "Y")
    rot = d.to_track_quat("X", up).to_matrix().to_4x4()
    return Matrix.Translation(Vector(origin)) @ rot


def radial_matrix(x, angle_deg, r):
    """Frame on the hull: local +Z points out radially, local +X runs along the ship."""
    a = math.radians(angle_deg)
    zaxis = Vector((0.0, math.cos(a), math.sin(a)))
    xaxis = Vector((1.0, 0.0, 0.0))
    yaxis = zaxis.cross(xaxis)
    m = Matrix((xaxis, yaxis, zaxis)).transposed().to_4x4()
    m.translation = Vector((x, 0.0, 0.0)) + zaxis * r
    return m


class Builder:
    """Collects primitives into one bmesh with per-face materials."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _add(self, verts, faces, face_mats, smooth, matrix):
        bv = [self.bm.verts.new(matrix @ Vector(v)) for v in verts]
        for f, mat in zip(faces, face_mats):
            face = self.bm.faces.new([bv[i] for i in f])
            face.material_index = self._mi(mat)
            face.smooth = smooth

    def lathe(self, profile, mat, seg=48, closed=False, matrix=Matrix(), smooth=True):
        """Revolve (x, r) points around local X. mat may be one material or one per segment."""
        verts, rings = [], []
        for x, r in profile:
            if r < 1e-6:
                rings.append([len(verts)])
                verts.append((x, 0.0, 0.0))
            else:
                start = len(verts)
                for k in range(seg):
                    a = 2 * math.pi * k / seg
                    verts.append((x, r * math.cos(a), r * math.sin(a)))
                rings.append(list(range(start, start + seg)))
        n = len(rings)
        mats = mat if isinstance(mat, list) else [mat] * (n if closed else n - 1)
        faces, fmats = [], []
        for i in range(n if closed else n - 1):
            a, b = rings[i], rings[(i + 1) % n]
            if len(a) == 1 and len(b) == 1:
                continue
            for k in range(seg):
                k1 = (k + 1) % seg
                if len(a) == 1:
                    faces.append((a[0], b[k1], b[k]))
                elif len(b) == 1:
                    faces.append((a[k], a[k1], b[0]))
                else:
                    faces.append((a[k], a[k1], b[k1], b[k]))
                fmats.append(mats[i])
        self._add(verts, faces, fmats, smooth, matrix)

    def cylinder(self, p0, p1, r, mat, seg=12, smooth=True):
        length = (Vector(p1) - Vector(p0)).length
        self.lathe([(0, 0), (0, r), (length, r), (length, 0)], mat, seg,
                   matrix=axis_matrix(p0, Vector(p1) - Vector(p0)), smooth=smooth)

    def box(self, center, size, mat, matrix=Matrix()):
        sx, sy, sz = (s / 2 for s in size)
        cx, cy, cz = center
        verts = [(cx + dx * sx, cy + dy * sy, cz + dz * sz)
                 for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        self._add(verts, faces, [mat] * 6, False, matrix)

    def sphere(self, center, r, mat, seg=48, rings=24):
        prof = [(-r * math.cos(math.pi * i / rings), r * math.sin(math.pi * i / rings))
                for i in range(rings + 1)]
        prof[0] = (-r, 0.0)
        prof[-1] = (r, 0.0)
        self.lathe(prof, mat, seg, matrix=Matrix.Translation(Vector(center)))

    def torus(self, R, rmin, mat, matrix, seg=48, minor_seg=8):
        prof = [(rmin * math.cos(2 * math.pi * i / minor_seg), R + rmin * math.sin(2 * math.pi * i / minor_seg))
                for i in range(minor_seg)]
        self.lathe(prof, mat, seg, closed=True, matrix=matrix)

    def cone(self, base, tip_dir, r0, r1, length, mat, seg=10):
        """Small nozzle: open-looking cone from r0 at base to r1 after length."""
        self.lathe([(0, 0), (0, r0), (length, r1), (length - 0.01, r1 * 0.75), (0.02, 0)],
                   mat, seg, matrix=axis_matrix(base, tip_dir))

    def finish(self, name, coll, assembly, origin=None, mount=False, bevel=None, parent=None):
        ctx = self.ctx
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        if origin is None:
            co = [v.co for v in mesh.vertices]
            origin = sum(co, Vector()) / max(len(co), 1)
        origin = Vector(origin)
        mesh.transform(Matrix.Translation(-origin))
        for key in self.mats:
            mesh.materials.append(ctx.mats[key])
        if hasattr(mesh, "set_sharp_from_angle"):
            mesh.set_sharp_from_angle(angle=math.radians(35))
        obj = bpy.data.objects.new(name, mesh)
        obj.location = origin
        if bevel:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
            mod.harden_normals = False
        return ctx.adopt(obj, coll, assembly, mount, parent)


class Context:
    """Collections, root, materials and bookkeeping for one build."""

    def __init__(self, top_name):
        self.mats = build_materials()
        self.top = bpy.data.collections.new(top_name)
        bpy.context.scene.collection.children.link(self.top)
        self.colls = {}
        for c in COLLECTIONS:
            sub = bpy.data.collections.new(c)
            self.top.children.link(sub)
            self.colls[c] = sub
        self.root = bpy.data.objects.new("DOVE_ROOT", None)
        self.root.empty_display_type = "ARROWS"
        self.root.empty_display_size = 3.0
        self.root.location = ROOT_LOC
        self.top.objects.link(self.root)

    def adopt(self, obj, coll, assembly, mount=False, parent=None):
        self.colls[coll].objects.link(obj)
        obj["dove_assembly"] = assembly
        # Mounts are brackets, struts and surface hardware seated into another
        # part on purpose; the intersection check skips them.
        obj["dove_mount"] = bool(mount)
        parent = parent or self.root
        obj.parent = parent
        # Keep world transforms: children are authored in world space.
        obj.matrix_parent_inverse = world_basis(parent).inverted()
        return obj

    def empty(self, name, coll, location, rotation=(0, 0, 0), parent=None, size=0.6):
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = "PLAIN_AXES"
        obj.empty_display_size = size
        obj.location = location
        obj.rotation_euler = rotation
        return self.adopt(obj, coll, "pivot", parent=parent)

    def b(self):
        return Builder(self)


def world_basis(obj):
    """World matrix of an object built by this script (parents cancel by design)."""
    return obj.matrix_basis.copy()


# ---------------------------------------------------------------- components

def build_nose(ctx):
    b = ctx.b()
    b.lathe([(0.0, 0), (0.0, 0.42), (0.1, 0.42), (0.1, 0)], "graphite", 32)   # front hub
    b.lathe([(0.05, 0), (0.05, 1.1), (2.0, 1.1), (2.0, 0)], "graphite", 48)    # core
    b.finish("Nose_Core", "HABITAT", "habitat")
    disks = [(0.06, 0.44, 1.30), (0.52, 0.96, 1.85), (1.04, 1.50, 2.15), (1.58, 1.98, 2.30)]
    for i, (a, c, R) in enumerate(disks):
        d = ctx.b()
        e = min(0.12, (c - a) * 0.3)
        d.lathe([(a, 0.43 if i == 0 else 0.0), (a, R - e), (a + e * 0.35, R - e * 0.25), (a + e, R),
                 (c - e, R), (c - e * 0.35, R - e * 0.25), (c, R - e), (c, 0)], "ivory", 64)
        d.finish(f"Nose_Bumper_{i + 1}", "HABITAT", "habitat")
    col = ctx.b()
    col.lathe([(1.95, 0), (1.95, 2.0), (2.15, 2.0), (2.15, 0)], "graphite", 64)
    col.finish("Nose_Collar", "HABITAT", "habitat")


def build_habitat(ctx):
    b = ctx.b()
    prof = [(2.0, 0), (2.0, 1.7), (2.1, 2.05), (2.3, 2.3), (2.6, 2.45), (3.0, 2.5),
            (9.4, 2.5), (9.8, 2.45), (10.1, 2.3), (10.3, 2.05), (10.4, 1.6), (10.4, 0)]
    b.lathe(prof, "hull", 64)
    b.finish("Habitat_Hull", "HABITAT", "habitat")

    a = ctx.b()
    a.lathe([(10.3, 0), (10.3, 1.55), (11.0, 1.3), (11.0, 0)], "graphite", 48)
    a.finish("Habitat_AftAdapter", "HABITAT", "habitat", mount=True)

    for i, x in enumerate((3.0, 6.2, 9.4)):
        c = ctx.b()
        c.lathe([(x - 0.075, 2.48), (x - 0.075, 2.535), (x + 0.075, 2.535), (x + 0.075, 2.48)],
                "graphite", 64, closed=True)
        c.finish(f"Habitat_Collar_{i + 1}", "HABITAT", "habitat")

    # Window: -Y side, slightly above the waterline. Frame stands 0.06 proud
    # of the hull and the pane sits at the hull, so the glass reads recessed.
    w = ctx.b()
    m = radial_matrix(7.6, 172.0, HAB_R)
    fw, fh, bar = 0.75, 0.55, 0.1
    for cx, cy, sx, sy in ((0, (fh - bar) / 2, fw, bar), (0, -(fh - bar) / 2, fw, bar),
                           ((fw - bar) / 2, 0, bar, fh - 2 * bar), (-(fw - bar) / 2, 0, bar, fh - 2 * bar)):
        w.box((cx, cy, 0.0), (sx, sy, 0.12), "graphite", m)
    w.finish("Habitat_WindowFrame", "HABITAT", "habitat", bevel=0.01)
    p = ctx.b()
    p.box((0, 0, 0.0), (fw - 2 * bar, fh - 2 * bar, 0.02), "window", m)
    p.finish("Habitat_WindowPane", "HABITAT", "habitat")


def build_truss(ctx):
    x0, x1 = TRUSS_X
    h = TRUSS_HALF
    corners = [(h, h), (-h, h), (-h, -h), (h, -h)]

    rail_mesh = None
    for i, (y, z) in enumerate(corners):
        if rail_mesh is None:
            b = ctx.b()
            b.cylinder((0, 0, 0), (x1 - x0, 0, 0), RAIL_R, "orange", 16)
            rail = b.finish(f"Truss_Rail_{i + 1}", "TRUSS", "truss", origin=(0, 0, 0))
            rail_mesh = rail.data
            rail.location = (x0, y, z)
        else:
            rail = bpy.data.objects.new(f"Truss_Rail_{i + 1}", rail_mesh)
            rail.location = (x0, y, z)
            ctx.adopt(rail, "TRUSS", "truss")

    # Repeating members are linked duplicates of two meshes.
    diag_len = math.hypot(BAY, 2 * h)
    b = ctx.b()
    b.cylinder((-diag_len / 2, 0, 0), (diag_len / 2, 0, 0), BRACE_R, "graphite", 8)
    diag = b.finish("Truss_Brace_000", "TRUSS", "truss", origin=(0, 0, 0))
    diag_mesh = diag.data
    bpy.data.objects.remove(diag)
    b = ctx.b()
    b.cylinder((-h, 0, 0), (h, 0, 0), BRACE_R, "orange", 8)
    frame = b.finish("Truss_Frame_000", "TRUSS", "truss", origin=(0, 0, 0))
    frame_mesh = frame.data
    bpy.data.objects.remove(frame)

    def place(mesh, name, p0, p1):
        p0, p1 = Vector(p0), Vector(p1)
        obj = bpy.data.objects.new(name, mesh)
        obj.matrix_basis = axis_matrix((p0 + p1) / 2, p1 - p0)
        ctx.adopt(obj, "TRUSS", "truss")

    nbays = int(round((x1 - x0) / BAY))
    count = 0
    for i in range(nbays):
        xa, xb = x0 + i * BAY, x0 + (i + 1) * BAY
        if xb > AFT_X[0] + 1e-6:      # SPEC NOTE: bays over the aft module keep rails only
            continue
        s = 1 if i % 2 == 0 else -1
        faces = [((xa, h, -s * h), (xb, h, s * h)), ((xa, -h, s * h), (xb, -h, -s * h)),
                 ((xa, s * h, h), (xb, -s * h, h)), ((xa, -s * h, -h), (xb, s * h, -h))]
        for p0, p1 in faces:
            count += 1
            place(diag_mesh, f"Truss_Brace_{count:03d}", p0, p1)
    count = 0
    for i in range(1, nbays):
        x = x0 + i * BAY
        if x > AFT_X[0] - 0.2:
            continue
        for p0, p1 in (((x, -h, h), (x, h, h)), ((x, -h, -h), (x, h, -h)),
                       ((x, h, -h), (x, h, h)), ((x, -h, -h), (x, -h, h))):
            count += 1
            place(frame_mesh, f"Truss_Frame_{count:03d}", p0, p1)

    c = ctx.b()
    c.cylinder((x0, 0, 0), (AFT_X[0] - 0.15, 0, 0), 0.18, "graphite", 16)
    c.finish("Truss_Conduit", "TRUSS", "truss")


def build_tanks(ctx):
    for i, (sy, sz) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        center = Vector((TANK_X, sy * TANK_OFFSET, sz * TANK_OFFSET))
        b = ctx.b()
        b.sphere(center, TANK_R, "ivory", 48, 24)
        b.finish(f"Tank_{i + 1}", "TANKS", "tank", origin=center)

        bands = ctx.b()
        radial = Vector((0, sy, sz)).normalized()
        bands.torus(TANK_R + 0.005, 0.03, "orange", Matrix.Translation(center), 48, 6)
        merid = Matrix.Translation(center) @ axis_matrix((0, 0, 0), radial.cross(Vector((1, 0, 0))))
        bands.torus(TANK_R + 0.005, 0.03, "orange", merid, 48, 6)
        bands.finish(f"Tank_{i + 1}_Bands", "TANKS", "tank", origin=center)

        st = ctx.b()
        rail = Vector((0, sy * TRUSS_HALF, sz * TRUSS_HALF))
        for dx in (-0.9, 0.0, 0.9):
            p0 = rail + Vector((TANK_X + dx, 0, 0))
            to_c = (center - p0).normalized()
            p1 = center - to_c * (TANK_R - 0.05)
            st.cylinder(p0, p1, 0.05, "orange", 10)
        st.finish(f"Tank_{i + 1}_Struts", "TANKS", "tank", mount=True)


def build_radiators(ctx):
    h = TRUSS_HALF
    for si, xc in enumerate(RAD_STATIONS):
        for side, sgn in (("Stbd", 1), ("Port", -1)):
            tag = f"{'AB'[si]}_{side}"
            pivot = ctx.empty(f"Radiator_Pivot_{tag}", "RADIATORS", (xc, sgn * RAD_Y[0], 0.0))
            b = ctx.b()
            xa, xb = xc - RAD_LEN_X / 2, xc + RAD_LEN_X / 2
            ya, yb = RAD_Y
            ym, yl = sgn * (ya + yb) / 2, yb - ya
            fb, t = 0.08, RAD_THICK
            b.box((xc, ym, 0), (RAD_LEN_X - 2 * fb, yl - 2 * fb, 0.05), "copper")
            for (cx, cy, sx, sy) in ((xa + fb / 2, ym, fb, yl), (xb - fb / 2, ym, fb, yl),
                                     (xc, sgn * (ya + fb / 2), RAD_LEN_X - 2 * fb, fb),
                                     (xc, sgn * (yb - fb / 2), RAD_LEN_X - 2 * fb, fb)):
                b.box((cx, cy, 0), (sx, sy, t), "orange")
            for k in range(1, 8):
                b.box((xa + k * RAD_LEN_X / 8, ym, 0), (0.035, yl - 2 * fb, 0.066), "copper")
            b.box((xc, ym, 0), (RAD_LEN_X - 2 * fb, 0.05, 0.07), "orange")
            b.finish(f"Radiator_{tag}", "RADIATORS", "radiator", origin=pivot.location,
                     bevel=0.006, parent=pivot)

            s = ctx.b()
            for x in (xc - 1.6, xc + 1.6):
                for sz in (1, -1):
                    s.cylinder((x, sgn * h, sz * h), (x, sgn * (ya + 0.04), 0.0), 0.04, "orange", 8)
            s.cylinder((xc - 0.5, sgn * (ya - 0.06), 0), (xc + 0.5, sgn * (ya - 0.06), 0), 0.07, "metal", 12)
            s.box((xc, sgn * (ya - 0.1 + 0.02), 0), (0.3, 0.2, 0.12), "graphite")
            s.cylinder((xc, sgn * h, 0.0), (xc, sgn * (ya - 0.1), 0.0), 0.05, "graphite", 8)
            s.finish(f"Radiator_Root_{tag}", "RADIATORS", "radiator", mount=True)


def build_shield(ctx):
    x = SHIELD_X
    t = SHIELD_THICK
    inner = 1.3
    b = ctx.b()
    b.lathe([(x - t / 2, inner), (x - t / 2, SHIELD_R - 0.04), (x - t / 2 + 0.03, SHIELD_R),
             (x, SHIELD_R), (x, inner)], "shield", 96, closed=True)
    b.finish("Shield_Disk", "SHIELD", "shield")
    layer = ctx.b()
    layer.lathe([(x, inner + 0.05), (x, SHIELD_R - 0.25), (x + t / 2 - 0.02, SHIELD_R - 0.27),
                 (x + t / 2, SHIELD_R - 0.32), (x + t / 2, inner + 0.05)], "shield", 96, closed=True)
    layer.finish("Shield_Layer", "SHIELD", "shield")
    ribs = ctx.b()
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        m = Matrix.Translation((x - t / 2 - 0.025, 0, 0)) @ Matrix.Rotation(a, 4, "X")
        ribs.box((0, (inner + SHIELD_R - 0.1) / 2, 0), (0.05, SHIELD_R - 0.1 - inner, 0.07), "graphite", m)
    ribs.lathe([(x - t / 2 - 0.05, inner - 0.02), (x - t / 2 - 0.05, inner + 0.12),
                (x + t / 2 + 0.03, inner + 0.12), (x + t / 2 + 0.03, inner - 0.02)], "orange", 64, closed=True)
    ribs.finish("Shield_Supports", "SHIELD", "shield")
    br = ctx.b()
    for sy, sz in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        p0 = Vector((x, sy * TRUSS_HALF, sz * TRUSS_HALF))
        d = Vector((0, sy, sz)).normalized() * (inner + 0.02)
        p1 = Vector((x, d.y, d.z))
        br.cylinder(p0, p1, 0.06, "orange", 10)
    br.finish("Shield_Brackets", "SHIELD", "shield", mount=True)


def build_propulsion(ctx):
    xa, xb = AFT_X
    b = ctx.b()
    b.lathe([(xa, 0), (xa, AFT_R - 0.08), (xa + 0.08, AFT_R), (xb - 0.08, AFT_R), (xb, AFT_R - 0.08), (xb, 0)],
            "graphite", 48)
    b.finish("Aft_PowerModule", "PROPULSION", "aft")

    bh = ctx.b()
    for x0, x1 in ((xa - 0.15, xa), (xb, xb + 0.15)):
        bh.lathe([(x0, 0), (x0, 1.3), (x1, 1.3), (x1, 0)], "orange", 48)
    bh.finish("Aft_Bulkheads", "PROPULSION", "aft", mount=True)

    pl = ctx.b()
    for ang in (0, 90, 180, 270):
        pl.box((0, 0, 0), (1.4, 0.45, 0.06), "ivory", radial_matrix(50.6, ang, AFT_R))
    for ang in (0, 180):
        pl.box((0, 0, 0), (0.9, 0.4, 0.05), "ivory", radial_matrix(52.4, ang, AFT_R))
    pl.finish("Aft_AccessPlates", "PROPULSION", "aft", bevel=0.01)

    pipes = ctx.b()
    for ang in (25, 155, 295):
        a = math.radians(ang)
        y, z = (AFT_R + 0.03) * math.cos(a), (AFT_R + 0.03) * math.sin(a)
        pipes.cylinder((xa + 0.2, y, z), (xb - 0.2, y, z), 0.03, "copper", 10)
    pipes.finish("Aft_CopperPipes", "PROPULSION", "aft")

    # Engine: closed lathe profile so the bell has a real wall and dark inside.
    wall = 0.045
    x_throat = 55.95
    outer, inner = [], []
    for i in range(17):
        t = i / 16
        xx = x_throat + (ENGINE_X[1] - x_throat) * t
        r = THROAT_R + (EXIT_R - THROAT_R) * t ** 0.78
        inner.append((xx, r - wall if i == 16 else r))
        outer.append((xx, r + wall))
    inner[-1] = (ENGINE_X[1], EXIT_R - wall)
    outer[-1] = (ENGINE_X[1], EXIT_R)
    prof = [(55.15, 0), (55.15, 0.72), (55.6, 0.72), (x_throat - 0.05, THROAT_R + wall + 0.02)]
    prof += outer[1:]
    prof += list(reversed(inner[1:]))
    prof += [(x_throat, THROAT_R), (55.6, 0.62), (55.42, 0.62), (55.42, 0)]
    mats = []
    n_out = 3 + len(outer) - 1
    for i in range(len(prof) - 1):
        mats.append("graphite" if i < n_out else "dark")
    e = ctx.b()
    e.lathe(prof, mats, 64)
    e.finish("Engine_Bell", "PROPULSION", "engine")

    fx = ctx.b()
    fx.lathe([(ENGINE_X[1] + 0.05, 0), (ENGINE_X[1] + 0.05, EXIT_R - 0.1), (ENGINE_X[1] + 14, 3.6),
              (ENGINE_X[1] + 14, 0)], "exhaust", 48)
    exhaust = fx.finish("Engine_ExhaustFX", "PROPULSION", "fx")
    exhaust.hide_viewport = True
    exhaust.hide_render = True
    exhaust["dove_fx"] = True


def rcs_cluster(b, x, angle, r):
    m = radial_matrix(x, angle, r)
    b.box((0, 0, 0.05), (0.32, 0.32, 0.22), "metal", m)
    tz = m.to_3x3() @ Vector((0, 0, 1))
    ty = m.to_3x3() @ Vector((0, 1, 0))
    tx = m.to_3x3() @ Vector((1, 0, 0))
    top = m @ Vector((0, 0, 0.14))
    b.cone(top, tz, 0.035, 0.06, 0.12, "graphite")
    b.cone(m @ Vector((0, 0.15, 0.05)), ty, 0.03, 0.055, 0.1, "graphite")
    b.cone(m @ Vector((0, -0.15, 0.05)), -ty, 0.03, 0.055, 0.1, "graphite")
    b.cone(m @ Vector((-0.15, 0, 0.05)), -tx, 0.03, 0.055, 0.1, "graphite")


def build_details(ctx):
    # Service pods behind the habitat, one each side, strutted to the rails.
    for side, sgn in (("Stbd", 1), ("Port", -1)):
        p = ctx.b()
        xa, xb = POD_X
        p.lathe([(xa, 0), (xa, POD_R - 0.12), (xa + 0.06, POD_R - 0.03), (xa + 0.15, POD_R),
                 (xb - 0.15, POD_R), (xb - 0.06, POD_R - 0.03), (xb, POD_R - 0.12), (xb, 0)],
                "ivory", 32, matrix=Matrix.Translation((0, sgn * POD_Y, 0)))
        p.lathe([(xb - 0.6, POD_R - 0.01), (xb - 0.6, POD_R + 0.02), (xb - 0.5, POD_R + 0.02),
                 (xb - 0.5, POD_R - 0.01)], "graphite", 32, closed=True,
                matrix=Matrix.Translation((0, sgn * POD_Y, 0)))
        p.finish(f"ServicePod_{side}", "DETAILS", "pod")
        s = ctx.b()
        for x in (11.6, 12.4):
            for sz in (1, -1):
                p0 = Vector((x, sgn * TRUSS_HALF, sz * TRUSS_HALF))
                c = Vector((x, sgn * POD_Y, 0))
                p1 = c + (p0 - c).normalized() * (POD_R - 0.04)
                s.cylinder(p0, p1, 0.04, "orange", 8)
        s.finish(f"ServicePod_{side}_Struts", "DETAILS", "pod", mount=True)

    # Forward telescope on the upper starboard shoulder, pointing forward.
    t = ctx.b()
    a = math.radians(60)
    rc = HAB_R + 0.32
    cy, cz = rc * math.cos(a), rc * math.sin(a)
    t.lathe([(1.2, 0), (1.2, 0.17), (1.25, 0.22), (3.6, 0.22), (3.6, 0)], "ivory", 24,
            matrix=Matrix.Translation((0, cy, cz)))
    t.lathe([(1.18, 0), (1.18, 0.15), (1.21, 0.15), (1.21, 0)], "dark", 24,
            matrix=Matrix.Translation((0, cy, cz)))
    t.lathe([(1.4, 0.21), (1.4, 0.235), (1.5, 0.235), (1.5, 0.21)], "graphite", 24, closed=True,
            matrix=Matrix.Translation((0, cy, cz)))
    t.finish("Sensor_Telescope", "DETAILS", "sensor")
    tb = ctx.b()
    for x in (3.1, 3.45):
        tb.box((0, 0, 0.06), (0.14, 0.12, 0.26), "metal", radial_matrix(x, 60, HAB_R - 0.05))
    tb.finish("Sensor_Telescope_Mount", "DETAILS", "sensor", mount=True)

    n = ctx.b()
    for ang in (200, 340):
        m = radial_matrix(2.75, ang, 2.3)
        n.lathe([(0, 0), (0, 0.13), (0.24, 0.13), (0.24, 0)], "metal", 20,
                matrix=m @ Matrix.Rotation(-math.pi / 2, 4, "Y"))
        n.lathe([(0.24, 0), (0.24, 0.09), (0.25, 0.09), (0.25, 0)], "dark", 20,
                matrix=m @ Matrix.Rotation(-math.pi / 2, 4, "Y"))
    n.finish("Sensor_NavApertures", "DETAILS", "sensor", mount=True)

    for i, (x, ang, length) in enumerate(((4.2, 100, 3.4), (4.8, 255, 3.0))):
        an = ctx.b()
        m = radial_matrix(x, ang, HAB_R - 0.05)
        base = m @ Vector((0, 0, 0))
        out = m.to_3x3() @ Vector((0, 0, 1))
        an.cylinder(base, base + out * 0.22, 0.07, "metal", 12)
        an.cylinder(base + out * 0.2, base + out * length, 0.02, "orange", 8)
        an.sphere(base + out * length, 0.045, "metal", 12, 6)
        an.finish(f"Antenna_{i + 1}", "COMMUNICATIONS", "antenna", mount=True)

    r = ctx.b()
    for ang in (45, 135, 225, 315):
        rcs_cluster(r, 3.6, ang, HAB_R - 0.06)
    r.finish("RCS_Habitat", "DETAILS", "rcs", mount=True, bevel=0.008)
    r = ctx.b()
    for ang in (0, 90, 180, 270):
        rcs_cluster(r, 53.6, ang, AFT_R - 0.06)
    r.finish("RCS_Aft", "DETAILS", "rcs", mount=True, bevel=0.008)

    # Surface detail: one fresh replacement plate, a few service plates, fasteners.
    rp = ctx.b()
    rp.box((0, 0, 0), (0.9, 0.6, 0.05), "plate_new", radial_matrix(5.4, 148, HAB_R))
    rp.finish("Hull_ReplacementPlate", "DETAILS", "detail", mount=True, bevel=0.008)
    sp = ctx.b()
    for x, ang in ((8.3, 200), (4.6, 30), (7.8, 320)):
        sp.box((0, 0, 0), (0.8, 0.5, 0.04), "ivory", radial_matrix(x, ang, HAB_R))
    sp.finish("Hull_ServicePlates", "DETAILS", "detail", mount=True, bevel=0.006)
    f = ctx.b()
    for x, ang, w, h in ((5.4, 148, 0.9, 0.6), (7.6, 172, 0.75, 0.55)):
        m = radial_matrix(x, ang, HAB_R)
        for dx in (-1, 1):
            for dy in (-1, 1):
                p = m @ Vector((dx * (w / 2 + 0.06), dy * (h / 2 + 0.06), 0.0))
                o = m.to_3x3() @ Vector((0, 0, 1))
                f.cylinder(p - o * 0.02, p + o * 0.035, 0.018, "metal", 8)
    f.finish("Hull_Fasteners", "DETAILS", "detail")

    curve = bpy.data.curves.new("Decal_DOVE01", "FONT")
    curve.body = "DOVE / 01"
    curve.size = 0.32
    curve.extrude = 0.002
    curve.align_x = "LEFT"
    curve.materials.append(ctx.mats["graphite"])
    text = bpy.data.objects.new("Decal_DOVE01", curve)
    text.matrix_basis = radial_matrix(3.5, 183, HAB_R + 0.004) @ Matrix.Translation((0, -0.12, 0))
    ctx.adopt(text, "DETAILS", "detail", mount=True)


def build_dish(ctx):
    mast_top = Vector((DISH_X, 0.0, 3.55))
    m = ctx.b()
    m.lathe([(2.42, 0), (2.42, 0.25), (2.58, 0.25), (2.58, 0)], "graphite", 24,
            matrix=Matrix.Translation((DISH_X, 0, 0)) @ Matrix.Rotation(-math.pi / 2, 4, "Y"))
    m.cylinder((DISH_X, 0, 2.5), mast_top, 0.08, "metal", 16)
    m.finish("Dish_Mast", "COMMUNICATIONS", "dish", mount=True)

    aim = Vector((-0.35, -0.45, 0.82)).normalized()
    rot = aim.to_track_quat("Z", "X").to_euler()
    pivot = ctx.empty("Dish_Pivot", "COMMUNICATIONS", mast_top, rot)
    pm = world_basis(pivot)
    # Dish frame: local +Z is the boresight. Lathe works along X, so turn X onto Z.
    xz = Matrix.Rotation(-math.pi / 2, 4, "Y")
    f = 1.0
    u0 = 0.35
    th = 0.035
    front = [(u0 + (DISH_R * i / 12) ** 2 / (4 * f), DISH_R * i / 12) for i in range(13)]
    back = [(u - th, r) for u, r in reversed(front)]
    prof = [(u0, 0.0)] + front[1:] + back[:-1] + [(u0 - th, 0.0)]
    d = ctx.b()
    d.lathe(prof, "ivory", 48, matrix=pm @ xz)
    d.finish("Dish_Reflector", "COMMUNICATIONS", "dish", origin=mast_top, parent=pivot)

    rim_u = u0 + DISH_R ** 2 / (4 * f)
    hw = ctx.b()
    hw.torus(DISH_R, 0.025, "orange", pm @ xz @ Matrix.Translation((rim_u, 0, 0)), 48, 6)
    hw.lathe([(-0.1, 0), (-0.1, 0.11), (u0 - th + 0.01, 0.11), (u0 - th + 0.01, 0)], "metal", 16,
             matrix=pm @ xz)
    feed_u = u0 + f
    feed = pm @ xz @ Vector((feed_u, 0, 0))
    for k in range(3):
        a = 2 * math.pi * k / 3 + math.pi / 2
        rim = pm @ xz @ Vector((rim_u, DISH_R * 0.97 * math.cos(a), DISH_R * 0.97 * math.sin(a)))
        hw.cylinder(rim, feed, 0.012, "graphite", 6)
    hw.lathe([(feed_u - 0.12, 0), (feed_u - 0.12, 0.07), (feed_u + 0.06, 0.07), (feed_u + 0.06, 0)],
             "metal", 16, matrix=pm @ xz)
    hw.finish("Dish_FeedAndRim", "COMMUNICATIONS", "dish", origin=mast_top, parent=pivot)


# ---------------------------------------------------------------- presentation

def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def build_presentation(ctx):
    coll = ctx.colls["PRESENTATION"]

    def cam(name, loc, target=None, ortho=None, lens=50, rot=None):
        data = bpy.data.cameras.new(name)
        data.clip_start = 0.1
        data.clip_end = 400
        if ortho:
            data.type = "ORTHO"
            data.ortho_scale = ortho
        else:
            data.lens = lens
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        if rot is not None:
            obj.rotation_euler = rot
        else:
            look_at(obj, target)
        coll.objects.link(obj)
        return obj

    cam("CAM_Side", (30, -120, 0.0), (30, 0, 0.0), ortho=64)
    cam("CAM_Top", (30, 0, 120), ortho=64, rot=(0, 0, 0))
    cam("CAM_Front", (-80, 0, 0), (0, 0, 0), ortho=24)
    cam("CAM_Rear", (140, 0, 0), (60, 0, 0), ortho=24)
    beauty = cam("CAM_Beauty", (2.0, -62.0, 21.0), (25.0, 0.0, -1.0), lens=36)
    beauty.data.dof.use_dof = False

    def light(name, kind, loc, target, energy, color, size=None):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = color
        if kind == "SUN":
            data.angle = math.radians(1.5)
        if size:
            data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        look_at(obj, target)
        coll.objects.link(obj)
        return obj

    light("LIGHT_OrthoKey", "SUN", (10, -40, 40), (30, 0, 0), 3.0, (1.0, 0.98, 0.95))
    light("LIGHT_Key", "SUN", (-40, -30, 25), (30, 0, 0), 4.0, (1.0, 0.88, 0.75))
    light("LIGHT_Rim", "AREA", (60, 40, 30), (30, 0, 0), 60000, (0.6, 0.75, 1.0), size=30)
    light("LIGHT_Fill", "AREA", (10, -60, -25), (30, 0, 0), 25000, (0.75, 0.8, 1.0), size=40)

    for name, col, strength in (("DOVE_World_Neutral", (0.32, 0.32, 0.32), 1.0),
                                ("DOVE_World_Studio", (0.006, 0.006, 0.008), 1.0)):
        w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
        nt = _nodes_for(w)
        bg = nt.nodes.get("Background") or nt.nodes.new("ShaderNodeBackground")
        bg.inputs["Color"].default_value = (*col, 1.0)
        bg.inputs["Strength"].default_value = strength
        out = nt.nodes.get("World Output") or nt.nodes.new("ShaderNodeOutputWorld")
        if not out.inputs["Surface"].is_linked:
            nt.links.new(bg.outputs[0], out.inputs["Surface"])


# ---------------------------------------------------------------- build / check / render

def find_existing():
    return bpy.data.collections.get("DOVE")


def remove_collection_tree(coll):
    for child in list(coll.children):
        remove_collection_tree(child)
    for obj in list(coll.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(coll)


def build(replace=False):
    name = "DOVE"
    existing = find_existing()
    if existing is not None:
        if replace:
            remove_collection_tree(existing)
            print("build_dove: replaced the existing DOVE collection")
        else:
            v = 2
            while bpy.data.collections.get(f"DOVE_v{v}"):
                v += 1
            name = f"DOVE_v{v}"
            print(f"build_dove: DOVE already exists, building {name} beside it")
    ctx = Context(name)
    build_nose(ctx)
    build_habitat(ctx)
    build_truss(ctx)
    build_tanks(ctx)
    build_radiators(ctx)
    build_shield(ctx)
    build_propulsion(ctx)
    build_dish(ctx)
    build_details(ctx)
    build_presentation(ctx)
    bpy.context.view_layer.update()
    return ctx


def ship_objects(ctx):
    out = []
    for c in COLLECTIONS:
        if c == "PRESENTATION":
            continue
        for obj in ctx.colls[c].all_objects:
            if obj.type in {"MESH", "FONT"} and not obj.get("dove_fx"):
                out.append(obj)
    return out


def world_bvh(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    mw = obj.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys), verts


def check(ctx, tol=0.03):
    dg = bpy.context.evaluated_depsgraph_get()
    objs = ship_objects(ctx)
    data = {}
    for o in objs:
        bvh, verts = world_bvh(o, dg)
        lo = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
        hi = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
        data[o.name] = (o, bvh, verts, lo, hi)

    lo = Vector((min(d[3].x for d in data.values()), min(d[3].y for d in data.values()),
                 min(d[3].z for d in data.values())))
    hi = Vector((max(d[4].x for d in data.values()), max(d[4].y for d in data.values()),
                 max(d[4].z for d in data.values())))
    print(f"check: extent X {lo.x:.3f}..{hi.x:.3f}  Y {lo.y:.3f}..{hi.y:.3f}  Z {lo.z:.3f}..{hi.z:.3f}")
    tanks = [o for o in objs if o.name.startswith("Tank_") and o.name.count("_") == 1]
    panels = [o for o in objs if o.name.startswith("Radiator_") and "Root" not in o.name]
    print(f"check: tanks {len(tanks)}, radiator panels {len(panels)}")
    for p in panels:
        d = data[p.name]
        print(f"check:   {p.name}: X {d[3].x:.2f}..{d[4].x:.2f}  |Y| {min(abs(d[3].y), abs(d[4].y)):.2f}.."
              f"{max(abs(d[3].y), abs(d[4].y)):.2f}  Z {d[3].z:.3f}..{d[4].z:.3f}")

    names = list(data)
    parent = {n: n for n in names}

    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    clashes = []
    for i, a in enumerate(names):
        oa, ba, va, la, ha = data[a]
        for b in names[i + 1:]:
            ob, bb, vb, lb, hb = data[b]
            if any(la[k] > hb[k] + tol or lb[k] > ha[k] + tol for k in range(3)):
                continue
            overlap = bool(ba.overlap(bb))
            touching = overlap
            # Test both ways: a long face may have no vertices near the other part.
            for verts, tree in ((va, bb), (vb, ba)):
                if touching:
                    break
                touching = any(tree.find_nearest(v, tol)[0] is not None for v in verts)
            if touching:
                parent[find(a)] = find(b)
            if (overlap and oa["dove_assembly"] != ob["dove_assembly"]
                    and not oa["dove_mount"] and not ob["dove_mount"]):
                clashes.append((a, b))

    groups = {}
    for n in names:
        groups.setdefault(find(n), []).append(n)
    groups = sorted(groups.values(), key=len, reverse=True)
    print(f"check: {len(objs)} ship objects in {len(groups)} connected group(s)")
    for g in groups[1:]:
        print(f"check:   not connected to the ship: {', '.join(sorted(g))}")
    if clashes:
        for a, b in clashes:
            print(f"check:   intersection between major parts: {a} / {b}")
    else:
        print("check: no intersections between major parts of different assemblies")
    return len(groups) == 1 and not clashes


def setup_render(scene, samples, percent):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.resolution_percentage = percent
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass


def render_previews(ctx, outdir, samples=64, percent=100):
    scene = bpy.context.scene
    setup_render(scene, samples, percent)
    os.makedirs(outdir, exist_ok=True)
    objs = {o.name.split(".")[0]: o for o in ctx.colls["PRESENTATION"].objects}
    ortho_lights = {"LIGHT_OrthoKey"}
    beauty_lights = {"LIGHT_Key", "LIGHT_Rim", "LIGHT_Fill"}
    shots = [("dove_side", "CAM_Side", 2400, 1000, False), ("dove_top", "CAM_Top", 2400, 1000, False),
             ("dove_front", "CAM_Front", 1400, 1400, False), ("dove_rear", "CAM_Rear", 1400, 1400, False),
             ("dove_beauty", "CAM_Beauty", 2400, 1200, True)]
    for fname, cam, w, h, beauty in shots:
        scene.camera = objs[cam]
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.world = bpy.data.worlds["DOVE_World_Studio" if beauty else "DOVE_World_Neutral"]
        live = beauty_lights if beauty else ortho_lights
        for name in ortho_lights | beauty_lights:
            objs[name].hide_render = name not in live
        scene.render.filepath = os.path.join(outdir, fname + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"build_dove: rendered {scene.render.filepath}")
    scene.camera = objs["CAM_Beauty"]
    scene.world = bpy.data.worlds["DOVE_World_Studio"]
    for name in ortho_lights | beauty_lights:
        objs[name].hide_render = name not in beauty_lights


def free_path(path):
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    v = 2
    while os.path.exists(f"{stem}_v{v}{ext}"):
        v += 1
    return f"{stem}_v{v}{ext}"


def parse_args(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else (argv[1:] if bpy.app.background and
                                                               argv and argv[0].endswith(".py") else [])
    opts = {"new_file": False, "replace": False, "save": None, "overwrite": False,
            "render": None, "samples": 64, "percent": 100, "check": False}
    it = iter(args)
    for a in it:
        if a in ("--new-file", "--replace", "--overwrite", "--check"):
            opts[a[2:].replace("-", "_")] = True
        elif a in ("--save", "--render"):
            opts[a[2:]] = os.path.abspath(next(it))
        elif a in ("--samples", "--percent"):
            opts[a[2:]] = int(next(it))
        else:
            raise SystemExit(f"build_dove: unknown option {a}")
    return opts


def main():
    opts = parse_args(sys.argv)
    if opts["new_file"]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    ctx = build(opts["replace"])
    print(f"build_dove: built collection {ctx.top.name}")
    ok = check(ctx) if opts["check"] else True
    if opts["render"]:
        render_previews(ctx, opts["render"], opts["samples"], opts["percent"])
    else:
        bpy.context.scene.camera = next(o for o in ctx.colls["PRESENTATION"].objects
                                        if o.name.startswith("CAM_Beauty"))
        setup_render(bpy.context.scene, opts["samples"], opts["percent"])
        bpy.context.scene.world = bpy.data.worlds["DOVE_World_Studio"]
    if opts["save"]:
        path = opts["save"] if opts["overwrite"] else free_path(opts["save"])
        if path != opts["save"]:
            print(f"build_dove: {opts['save']} exists, saving as {path}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
        print(f"build_dove: saved {path}")
    if not ok:
        print("build_dove: check found problems, see above")


if __name__ == "__main__":
    main()
