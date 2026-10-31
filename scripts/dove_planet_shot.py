"""Dove planet shot: the Dove survey vessel passing in front of the planet.

Builds the planet scene from planet_shot.py, then adds the ship from
dove/build_dove.py between the camera and the planet. The ship keeps its own
geometry and materials; only DOVE_ROOT is moved, turned and scaled down so it
reads at the planet shot's scale (planet radius 1 unit). The ship's studio
cameras and lights are switched off so the planet's sun lights both.

  blender --background --python scripts/dove_planet_shot.py -- [options]
  python scripts/dove_planet_shot.py [options]   (with the bpy module installed)

Options:
  --out PATH        render path (default: renders/dove_planet_shot.png)
  --blend PATH      also save the .blend here (default: renders/dove_planet_shot.blend)
  --percent N       resolution percentage of 2000x643 (default: 100)
  --samples N       Cycles samples (default: 128)
  --seed N          planet seed, as in planet_shot.py (default: 0)
  --no-render       build and save the .blend only

Move the ship with SHIP below, or in Blender by moving DOVE_ROOT.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(ROOT, "dove")]

import bpy  # noqa: E402  (bpy before the modules that use bmesh)
import build_dove  # noqa: E402
import planet_shot  # noqa: E402

SHIP = {
    "location": (-0.13, -7.0, 0.205),   # about 3.2 units in front of the camera
    "rotation_deg": (25.0, 8.0, 25.0),  # roll, pitch, yaw around DOVE_ROOT
    "scale": 0.0078,                    # 60 m ship is about 0.47 units long
}


def build(seed):
    scene = planet_shot.build(seed)
    planet_cam, planet_world = scene.camera, scene.world
    ctx = build_dove.build()
    for obj in ctx.colls["PRESENTATION"].objects:
        obj.hide_render = True
        obj.hide_viewport = True
    scene.camera, scene.world = planet_cam, planet_world

    root = ctx.root
    root.location = SHIP["location"]
    root.rotation_euler = [math.radians(a) for a in SHIP["rotation_deg"]]
    root.scale = (SHIP["scale"],) * 3
    # The camera sits 3 units from a ship 0.5 units long; keep near clipping clear.
    planet_cam.data.clip_start = 0.01
    return scene


def parse_args(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    opts = {
        "out": os.path.join(ROOT, "renders", "dove_planet_shot.png"),
        "blend": os.path.join(ROOT, "renders", "dove_planet_shot.blend"),
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
