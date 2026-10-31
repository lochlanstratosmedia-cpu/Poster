"""Planet shot: a procedural desert planet rising out of the bottom of frame.

Builds the whole scene from nothing (no image textures), so it runs anywhere:

  blender --background --python scripts/planet_shot.py -- [options]
  python scripts/planet_shot.py [options]        (with the bpy module installed)

Options:
  --out PATH        render path (default: renders/planet_shot.png)
  --blend PATH      also save the .blend here (default: renders/planet_shot.blend)
  --percent N       resolution percentage of 2000x643 (default: 100)
  --samples N       Cycles samples (default: 128)
  --seed N          shifts every noise pattern, for a different planet (default: 0)
  --no-render       build and save the .blend only

Scene layout:
  Planet    radius 1 at the origin. Folded strata, teal lakes, salt flats.
  Clouds    a shell at 1.006 with clumpy alpha.
  Haze      a shell at 1.03. Its glow is worked out from how close each camera
            ray passes to the planet, so the limb is bright and fades out cleanly.
  Sun       above and slightly in front, so the lower half falls into shadow.
  Stars     world shader, seen by the camera only so they never light the planet.

Every look control sits in the PARAMS dict below.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PARAMS = {
    "width": 2000,
    "height": 643,
    "lens": 100.0,            # mm on a 36 mm sensor
    "cam_distance": 10.2,     # planet fills a little over half the frame width
    "cam_shift_y": 0.135,     # pushes the planet down so its lower part is cropped
    "sun_dir": (0.0, -0.08, 1.0),   # direction toward the sun
    "sun_strength": 5.0,
    "strata_scale": 2.3,
    "strata_warp": 2.4,
    "lake_amount": 0.69,      # lower means more lakes
    "cloud_amount": 0.51,     # lower means more cloud
    "haze_color": (0.55, 0.70, 1.0),
    "haze_strength": 1.6,
}


# ---------------------------------------------------------------- helpers

def sock(sockets, name, kind=None):
    """Find a socket by name, and by type when a node has duplicates."""
    for s in sockets:
        if s.name == name and (kind is None or s.type == kind):
            return s
    raise KeyError(name)


class Graph:
    """Small wrapper to keep node building short."""

    def __init__(self, tree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.nodes.clear()

    def add(self, kind, **props):
        node = self.nodes.new(kind)
        for key, value in props.items():
            setattr(node, key, value)
        return node

    def link(self, out, inp):
        self.links.new(out, inp)

    def set(self, node, name, value, kind=None):
        sock(node.inputs, name, kind).default_value = value

    def math(self, op, a, b=None, clamp=False):
        node = self.add("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                node.inputs[i].default_value = v
            else:
                self.link(v, node.inputs[i])
        return node.outputs[0]

    def vmath(self, op, a, b=None):
        node = self.add("ShaderNodeVectorMath", operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (tuple, list, Vector)):
                node.inputs[i].default_value = v
            else:
                self.link(v, node.inputs[i])
        out = "Value" if op in {"DOT_PRODUCT", "LENGTH", "DISTANCE"} else "Vector"
        return sock(node.outputs, out)

    def ramp(self, fac, stops, interp="LINEAR"):
        node = self.add("ShaderNodeValToRGB")
        cr = node.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > len(stops):
            cr.elements.remove(cr.elements[-1])
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = col if len(col) == 4 else (*col, 1.0)
        self.link(fac, node.inputs["Fac"])
        return node

    def mix_color(self, fac, a, b, blend="MIX"):
        node = self.add("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        for name, v in (("Factor", fac), ("A", a), ("B", b)):
            target = sock(node.inputs, name, "VALUE" if name == "Factor" else "RGBA")
            if isinstance(v, (int, float)):
                target.default_value = v
            elif isinstance(v, tuple):
                target.default_value = v if len(v) == 4 else (*v, 1.0)
            else:
                self.link(v, target)
        return sock(node.outputs, "Result", "RGBA")

    def noise(self, vector, scale, detail=6.0, rough=0.55, distortion=0.0, dims="3D"):
        node = self.add("ShaderNodeTexNoise", noise_dimensions=dims)
        self.link(vector, node.inputs["Vector"])
        self.set(node, "Scale", scale)
        self.set(node, "Detail", detail)
        self.set(node, "Roughness", rough)
        self.set(node, "Distortion", distortion)
        return node


def seeded_coords(g, seed):
    """Object coordinates, offset by the seed so each seed gives a new planet."""
    coord = g.add("ShaderNodeTexCoord")
    return g.vmath("ADD", coord.outputs["Object"], (seed * 17.13, seed * 5.71, seed * 11.37))


def light_factor(g, normal, sun, lo=-0.25, hi=0.6):
    """0 on the night side, 1 in full sun, soft through the terminator."""
    d = g.vmath("DOT_PRODUCT", normal, tuple(sun))
    node = g.add("ShaderNodeMapRange", clamp=True)
    g.link(d, node.inputs["Value"])
    node.inputs["From Min"].default_value = lo
    node.inputs["From Max"].default_value = hi
    return node.outputs["Result"]


# ---------------------------------------------------------------- materials

def planet_material(seed, sun):
    mat = bpy.data.materials.new("Planet")
    mat.use_nodes = True
    g = Graph(mat.node_tree)
    p = PARAMS
    pos = seeded_coords(g, seed)

    # Domain warp: push the coordinates around with a low-frequency noise so
    # the strata bands fold and swirl like eroded sedimentary rock.
    warp = g.noise(pos, 1.1, detail=4.0, rough=0.5)
    centred = g.vmath("SUBTRACT", warp.outputs["Color"], (0.5, 0.5, 0.5))
    scaled = g.vmath("SCALE", centred)
    sock(scaled.node.inputs, "Scale").default_value = p["strata_warp"]
    warped = g.vmath("ADD", pos, scaled)

    # Two sets of contour bands at different frequencies.
    wave = g.add("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z", wave_profile="SIN")
    g.link(warped, wave.inputs["Vector"])
    g.set(wave, "Scale", p["strata_scale"])
    g.set(wave, "Distortion", 9.0)
    g.set(wave, "Detail", 6.0)
    g.set(wave, "Detail Scale", 1.6)
    g.set(wave, "Detail Roughness", 0.6)

    wave2 = g.add("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X", wave_profile="SAW")
    g.link(warped, wave2.inputs["Vector"])
    g.set(wave2, "Scale", p["strata_scale"] * 2.7)
    g.set(wave2, "Distortion", 14.0)
    g.set(wave2, "Detail", 8.0)
    g.set(wave2, "Detail Scale", 2.2)
    g.set(wave2, "Detail Roughness", 0.65)

    region = g.noise(pos, 2.2, detail=5.0, rough=0.6)
    fine = g.noise(pos, 38.0, detail=8.0, rough=0.65)

    # Rock colour: pale sand through ochre to dark brown fold lines.
    rock = g.ramp(wave.outputs["Fac"], [
        (0.00, (0.10, 0.065, 0.045)),
        (0.10, (0.36, 0.25, 0.18)),
        (0.30, (0.62, 0.50, 0.40)),
        (0.55, (0.78, 0.68, 0.58)),
        (0.80, (0.70, 0.56, 0.44)),
        (1.00, (0.50, 0.36, 0.26)),
    ]).outputs["Color"]
    lines = g.ramp(wave2.outputs["Fac"], [
        (0.00, (0.30, 0.20, 0.14)),
        (0.12, (1.0, 1.0, 1.0)),
        (1.00, (1.0, 1.0, 1.0)),
    ]).outputs["Color"]
    rock = g.mix_color(0.5, rock, lines, "MULTIPLY")
    tint = g.ramp(region.outputs["Fac"], [
        (0.30, (0.80, 0.68, 0.60)),
        (0.50, (1.00, 0.97, 0.94)),
        (0.70, (1.00, 0.92, 0.82)),
    ]).outputs["Color"]
    rock = g.mix_color(1.0, rock, tint, "MULTIPLY")
    grit = g.ramp(fine.outputs["Fac"], [(0.3, (0.82, 0.80, 0.78)), (0.7, (1.0, 1.0, 1.0))]).outputs["Color"]
    rock = g.mix_color(1.0, rock, grit, "MULTIPLY")

    # Lakes: a warped noise biased by the strata so the water pools along the
    # folds in long thin shapes instead of round blobs.
    lake_n = g.noise(warped, 2.6, detail=7.0, rough=0.62, distortion=0.3)
    lake_field = g.math("ADD", lake_n.outputs["Fac"], g.math("MULTIPLY", wave.outputs["Fac"], 0.22))
    la = p["lake_amount"]
    lake_mask = g.ramp(lake_field, [(la + 0.06, (0, 0, 0)), (la + 0.075, (1, 1, 1))]).outputs["Color"]
    lake_edge = g.ramp(lake_field, [(la + 0.035, (0, 0, 0)), (la + 0.06, (1, 1, 1))]).outputs["Color"]
    lake_col = g.ramp(lake_n.outputs["Fac"], [
        (la + 0.06, (0.05, 0.16, 0.12)),
        (la + 0.10, (0.30, 0.62, 0.50)),
        (la + 0.18, (0.70, 0.92, 0.82)),
    ]).outputs["Color"]
    # Dark wet margins around every lake.
    color = g.mix_color(lake_edge, rock, (0.05, 0.075, 0.05))
    color = g.mix_color(lake_mask, color, lake_col)

    # Salt flats: bright white pans in the highest part of a separate noise.
    salt_n = g.noise(warped, 4.0, detail=6.0, rough=0.6)
    salt_mask = g.ramp(salt_n.outputs["Fac"], [(0.70, (0, 0, 0)), (0.73, (1, 1, 1))]).outputs["Color"]
    color = g.mix_color(salt_mask, color, (0.85, 0.88, 0.84))

    # Fake extinction near the terminator: sunlight crossing a long path of
    # air dims well before the geometric night line, so the disc fades slowly.
    geo = g.add("ShaderNodeNewGeometry")
    dusk = g.math("POWER", light_factor(g, geo.outputs["Normal"], sun, lo=-0.02, hi=0.8), 1.6)
    color = g.mix_color(dusk, (0.0, 0.0, 0.0), color)

    bsdf = g.add("ShaderNodeBsdfPrincipled")
    g.link(color, bsdf.inputs["Base Color"])
    rough = g.math("SUBTRACT", 0.92, g.math("MULTIPLY", lake_mask, 0.55))
    g.link(rough, bsdf.inputs["Roughness"])

    # Relief from the bands, flattened where there is water.
    height = g.math("ADD", g.math("MULTIPLY", wave.outputs["Fac"], 0.6),
                    g.math("MULTIPLY", wave2.outputs["Fac"], 0.25))
    height = g.math("ADD", height, g.math("MULTIPLY", fine.outputs["Fac"], 0.15))
    height = g.math("MULTIPLY", height, g.math("SUBTRACT", 1.0, lake_mask))
    bump = g.add("ShaderNodeBump")
    g.set(bump, "Strength", 0.35)
    g.set(bump, "Distance", 0.004)
    g.link(height, bump.inputs["Height"])
    g.link(bump.outputs["Normal"], bsdf.inputs["Normal"])

    out = g.add("ShaderNodeOutputMaterial")
    g.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def cloud_material(seed, sun):
    mat = bpy.data.materials.new("Clouds")
    mat.use_nodes = True
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    g = Graph(mat.node_tree)
    pos = seeded_coords(g, seed + 3)

    # Clumps: fine puffy noise, gated by a coarse noise so the cloud gathers
    # into scattered fields with clear sky between them.
    puff = g.noise(pos, 30.0, detail=9.0, rough=0.66, distortion=0.4)
    field = g.noise(pos, 3.0, detail=4.0, rough=0.5)
    gate = g.ramp(field.outputs["Fac"], [(0.42, (0, 0, 0)), (0.62, (1, 1, 1))]).outputs["Color"]
    density = g.math("MULTIPLY", puff.outputs["Fac"], g.math("ADD", 0.72, g.math("MULTIPLY", gate, 0.35)))
    ca = PARAMS["cloud_amount"]
    alpha = g.ramp(density, [(ca, (0, 0, 0)), (ca + 0.12, (1, 1, 1))]).outputs["Color"]

    geo = g.add("ShaderNodeNewGeometry")
    dusk = g.math("POWER", light_factor(g, geo.outputs["Normal"], sun, lo=-0.02, hi=0.8), 1.6)
    bsdf = g.add("ShaderNodeBsdfPrincipled")
    g.link(g.mix_color(dusk, (0.0, 0.0, 0.0), (0.92, 0.92, 0.92)), bsdf.inputs["Base Color"])
    g.set(bsdf, "Roughness", 1.0)
    g.link(alpha, bsdf.inputs["Alpha"])
    bump = g.add("ShaderNodeBump")
    g.set(bump, "Strength", 0.6)
    g.set(bump, "Distance", 0.01)
    g.link(puff.outputs["Fac"], bump.inputs["Height"])
    g.link(bump.outputs["Normal"], bsdf.inputs["Normal"])

    out = g.add("ShaderNodeOutputMaterial")
    g.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def haze_material(sun):
    """Atmosphere glow without a volume.

    For a camera ray through the shell, |P x I| is how close the ray passes to
    the planet centre. Glow peaks where that distance is 1 (the limb) and dies
    off on both sides: quickly into space, more slowly across the disc.
    """
    mat = bpy.data.materials.new("Haze")
    mat.use_nodes = True
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    g = Graph(mat.node_tree)
    geo = g.add("ShaderNodeNewGeometry")

    impact = g.vmath("LENGTH", g.vmath("CROSS_PRODUCT", geo.outputs["Position"], geo.outputs["Incoming"]))
    offset = g.math("SUBTRACT", impact, 1.0)
    outside = g.math("EXPONENT", g.math("MULTIPLY", g.math("MAXIMUM", offset, 0.0), -220.0))
    inside = g.math("EXPONENT", g.math("MULTIPLY", g.math("MINIMUM", offset, 0.0), 40.0))
    glow = g.math("MULTIPLY", outside, inside)

    normal = g.vmath("NORMALIZE", geo.outputs["Position"])
    lit = light_factor(g, normal, sun, lo=-0.35, hi=0.7)
    glow = g.math("MULTIPLY", glow, g.math("POWER", lit, 1.4))
    glow = g.math("MULTIPLY", glow, g.math("SUBTRACT", 1.0, geo.outputs["Backfacing"]))

    emit = g.add("ShaderNodeEmission")
    g.set(emit, "Color", (*PARAMS["haze_color"], 1.0))
    g.link(g.math("MULTIPLY", glow, PARAMS["haze_strength"]), emit.inputs["Strength"])
    clear = g.add("ShaderNodeBsdfTransparent")
    add = g.add("ShaderNodeAddShader")
    g.link(clear.outputs[0], add.inputs[0])
    g.link(emit.outputs[0], add.inputs[1])

    out = g.add("ShaderNodeOutputMaterial")
    g.link(add.outputs[0], out.inputs["Surface"])
    return mat


def star_world():
    world = bpy.data.worlds.new("Stars")
    world.use_nodes = True
    g = Graph(world.node_tree)
    coord = g.add("ShaderNodeTexCoord")
    direction = g.vmath("NORMALIZE", coord.outputs["Generated"])

    def layer(scale, size, power, gain):
        vor = g.add("ShaderNodeTexVoronoi", feature="F1")
        g.link(direction, vor.inputs["Vector"])
        g.set(vor, "Scale", scale)
        dot = g.math("LESS_THAN", vor.outputs["Distance"], size)
        bright = g.math("POWER", sock(vor.outputs, "Color"), power)
        return g.math("MULTIPLY", g.math("MULTIPLY", dot, bright), gain)

    stars = g.math("ADD", layer(1400.0, 0.10, 3.0, 1.2), layer(500.0, 0.06, 6.0, 6.0))
    stars = g.math("ADD", stars, layer(3200.0, 0.14, 2.0, 0.35))

    bg = g.add("ShaderNodeBackground")
    g.set(bg, "Color", (0.8, 0.85, 1.0, 1.0))
    g.link(stars, bg.inputs["Strength"])
    black = g.add("ShaderNodeBackground")
    g.set(black, "Strength", 0.0)

    path = g.add("ShaderNodeLightPath")
    mix = g.add("ShaderNodeMixShader")
    g.link(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    g.link(black.outputs[0], mix.inputs[1])
    g.link(bg.outputs[0], mix.inputs[2])
    out = g.add("ShaderNodeOutputWorld")
    g.link(mix.outputs[0], out.inputs["Surface"])
    return world


# ---------------------------------------------------------------- scene

def sphere(name, radius, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=256, ring_count=128, radius=radius)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def build(seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    p = PARAMS
    sun = Vector(p["sun_dir"]).normalized()

    sphere("Planet", 1.0, planet_material(seed, sun))
    clouds = sphere("Clouds", 1.006, cloud_material(seed, sun))
    haze = sphere("Haze", 1.03, haze_material(sun))
    for obj in (clouds, haze):
        obj.visible_shadow = obj is clouds

    # Sun lamp: lamps shine down their local -Z, so aim -Z away from the sun.
    bpy.ops.object.light_add(type="SUN")
    lamp = bpy.context.active_object
    lamp.name = "Sun"
    lamp.data.energy = p["sun_strength"]
    lamp.data.angle = math.radians(0.6)
    lamp.rotation_euler = (-sun).to_track_quat("-Z", "Y").to_euler()

    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.name = "Camera"
    cam.location = (0.0, -p["cam_distance"], 0.0)
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)
    cam.data.lens = p["lens"]
    cam.data.sensor_width = 36.0
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.shift_y = p["cam_shift_y"]
    cam.data.clip_end = 100.0
    scene.camera = cam

    scene.world = star_world()

    scene.render.engine = "CYCLES"
    scene.render.resolution_x = p["width"]
    scene.render.resolution_y = p["height"]
    scene.render.image_settings.file_format = "PNG"
    scene.cycles.device = "CPU"
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 12
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    return scene


def parse_args(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    opts = {
        "out": os.path.join(ROOT, "renders", "planet_shot.png"),
        "blend": os.path.join(ROOT, "renders", "planet_shot.blend"),
        "percent": 100, "samples": 128, "seed": 0, "render": True,
    }
    it = iter(argv)
    for arg in it:
        if arg == "--no-render":
            opts["render"] = False
        elif arg in ("--out", "--blend"):
            opts[arg[2:]] = os.path.abspath(next(it))
        elif arg in ("--percent", "--samples", "--seed"):
            opts[arg[2:]] = int(next(it))
        else:
            sys.exit(f"unknown option: {arg}")
    return opts


def main():
    opts = parse_args(sys.argv)
    scene = build(opts["seed"])
    scene.render.resolution_percentage = opts["percent"]
    scene.cycles.samples = opts["samples"]
    scene.cycles.use_denoising = True
    scene.render.filepath = opts["out"]

    os.makedirs(os.path.dirname(opts["blend"]), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=opts["blend"])
    print(f"saved {opts['blend']}")
    if opts["render"]:
        os.makedirs(os.path.dirname(opts["out"]), exist_ok=True)
        bpy.ops.render.render(write_still=True)
        print(f"rendered {opts['out']}")


if __name__ == "__main__":
    main()
