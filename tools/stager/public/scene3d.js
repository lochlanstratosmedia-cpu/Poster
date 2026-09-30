// 3D placeholders. Floor furniture is modelled as simple block shapes at real
// size (metres) and drawn through a virtual camera matched to the photo, so
// every piece picks up the room's perspective on its own.
//
// Camera model: a level camera (vertical lines stay vertical, which is how
// most real estate photos are shot or corrected) standing at the origin,
// `camHeight` metres above the floor, looking down -Z. The user sets where the
// horizon (eye level) sits in the frame and how wide the lens is. The floor is
// the plane y = 0. An item's front faces +Z (toward the camera) at yaw 0.

const T = () => window.THREE;
export const has3D = () => Boolean(window.THREE);

export const DEFAULT_ROOM = { enabled: true, horizon: 0.5, fov: 75, camHeight: 1.4, grid: false };

let renderer = null;
const groupCache = new Map();

function getRenderer(w, h) {
  const THREE = T();
  if (!renderer) {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
  }
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (renderer.domElement.width !== cw || renderer.domElement.height !== ch) renderer.setSize(cw, ch, false);
  return renderer;
}

export function makeCamera(room, aspect) {
  const THREE = T();
  const hfov = (room.fov * Math.PI) / 180;
  const vfov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
  const cam = new THREE.PerspectiveCamera(vfov, aspect, 0.05, 500);
  cam.position.set(0, room.camHeight, 0);
  cam.lookAt(0, room.camHeight, -1);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  // Shift the image so the horizon lands where the user put it.
  cam.projectionMatrix.elements[9] = -(1 - 2 * room.horizon);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return cam;
}

// Image position (fractions 0..1) to a point on the floor, or null above the horizon.
export function floorPoint(room, aspect, u, v) {
  const THREE = T();
  const cam = makeCamera(room, aspect);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), cam);
  const d = ray.ray.direction;
  if (d.y >= -1e-4) return null;
  const t = -room.camHeight / d.y;
  return { x: ray.ray.origin.x + d.x * t, z: ray.ray.origin.z + d.z * t };
}

// Where to drop an item clicked at (u, v): on the floor, or 4 m out if the
// click was above the horizon.
export function dropPoint(room, aspect, u, v) {
  const p = floorPoint(room, aspect, u, Math.max(v, room.horizon + 0.02));
  if (p && Math.hypot(p.x, p.z) < 40) return p;
  return { x: 0, z: -4 };
}

// World point to image fractions.
export function project(room, aspect, x, y, z) {
  const THREE = T();
  const cam = makeCamera(room, aspect);
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { u: (v.x + 1) / 2, v: (1 - v.y) / 2, behind: z >= -0.01 || v.z > 1 };
}

// The eight corners of an item's box, as image fractions.
export function itemCorners(room, aspect, item) {
  const { w, d, h } = item.dims;
  const yaw = (item.yaw * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pts = [];
  for (const [lx, lz] of [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
    const x = item.x + lx * c + lz * s;
    const z = item.z - lx * s + lz * c;
    pts.push({ x, z });
  }
  const lift = item.lift || 0;
  return {
    bottom: pts.map((p) => project(room, aspect, p.x, lift, p.z)),
    top: pts.map((p) => project(room, aspect, p.x, lift + h, p.z)),
    world: pts,
  };
}

// A point on the floor in front of the item, used as the turn handle.
export function turnHandle(room, aspect, item) {
  const yaw = (item.yaw * Math.PI) / 180;
  const r = item.dims.d / 2 + 0.35;
  return project(room, aspect, item.x + Math.sin(yaw) * r, item.lift || 0, item.z + Math.cos(yaw) * r);
}

// ---------- models ----------

function builderKit(color) {
  const THREE = T();
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82 });
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const add = (geom, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    group.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 25), edgeMat);
    e.position.copy(m.position);
    e.rotation.copy(m.rotation);
    group.add(e);
    return m;
  };
  // Box by size, placed by its bottom centre.
  const box = (w, h, d, x = 0, y = 0, z = 0) => add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z);
  const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 24) =>
    add(new THREE.CylinderGeometry(rt, rb, h, seg), x, y + h / 2, z);
  const legs = (w, d, h, t = 0.04, inset = 0.03) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(t, h, t, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2));
  };
  return { THREE, group, box, cyl, legs, add, color };
}

const MODELS = {
  box({ box }, w, d, h) {
    box(w, h, d);
  },
  sofa(k, w, d, h) {
    const { box, legs } = k;
    const leg = Math.min(0.1, h * 0.12);
    const arm = Math.min(0.22, w * 0.12);
    legs(w, d, leg, 0.05, 0.05);
    box(w, h * 0.3, d, 0, leg, 0); // base
    box(w - arm * 2, h * 0.14, d * 0.72, 0, leg + h * 0.3, d * 0.14); // seat cushion
    box(w, h - leg, d * 0.24, 0, leg, -d / 2 + d * 0.12); // back
    for (const sx of [-1, 1]) box(arm, h * 0.62 - leg, d, sx * (w / 2 - arm / 2), leg, 0); // arms
  },
  sectional(k, w, d, h) {
    const main = Math.min(d, 0.95);
    k.group.add(buildGroupInto(k, "sofa", w, main, h, 0, -(d - main) / 2));
    const cw = Math.min(w * 0.35, 1.0);
    k.box(cw, h * 0.44, d - main, w / 2 - cw / 2, 0.08, main / 2); // chaise
  },
  chair(k, w, d, h) {
    MODELS.sofa(k, w, d, h);
  },
  diningChair({ box, legs }, w, d, h) {
    const seat = Math.min(0.47, h * 0.52);
    legs(w, d, seat - 0.03, 0.035, 0.02);
    box(w, 0.05, d, 0, seat - 0.05, 0);
    box(w, h - seat, 0.05, 0, seat, -d / 2 + 0.025);
  },
  ottoman({ box, legs }, w, d, h) {
    legs(w, d, 0.06, 0.04, 0.04);
    box(w, h - 0.06, d, 0, 0.06, 0);
  },
  table({ box, legs }, w, d, h) {
    const t = Math.min(0.04, h * 0.1);
    legs(w, d, h - t, 0.05, 0.04);
    box(w, t, d, 0, h - t, 0);
  },
  lowTable(k, w, d, h) {
    MODELS.table(k, w, d, h);
    k.box(w * 0.9, 0.02, d * 0.85, 0, h * 0.2, 0);
  },
  roundTable({ cyl }, w, d, h) {
    const r = Math.min(w, d) / 2;
    cyl(r * 0.35, r * 0.35, 0.03, 0, 0, 0);
    cyl(0.05, 0.05, h - 0.04, 0, 0.03, 0);
    cyl(r, r, 0.04, 0, h - 0.04, 0, 40);
  },
  diningSet(k, w, d, h) {
    const tw = Math.max(0.8, w - 0.9);
    const td = Math.max(0.7, d - 1.0);
    MODELS.table(k, tw, td, 0.75);
    const n = Math.max(1, Math.round(tw / 0.65));
    for (let i = 0; i < n; i++) {
      const x = -tw / 2 + (tw / n) * (i + 0.5);
      for (const side of [-1, 1]) {
        const g = buildGroupInto(k, "diningChair", 0.45, 0.5, Math.min(h, 0.9), x, side * (td / 2 + 0.2));
        g.rotation.y = side > 0 ? Math.PI : 0;
        k.group.add(g);
      }
    }
  },
  desk(k, w, d, h) {
    MODELS.table(k, w, d, h);
    k.box(Math.min(0.45, w * 0.3), h * 0.35, d * 0.9, w / 2 - Math.min(0.45, w * 0.3) / 2 - 0.05, h * 0.6, 0);
  },
  cabinet({ box, legs }, w, d, h) {
    const leg = Math.min(0.12, h * 0.15);
    legs(w, d, leg, 0.04, 0.04);
    box(w, h - leg, d, 0, leg, 0);
  },
  shelf({ box }, w, d, h) {
    const t = 0.025;
    for (const sx of [-1, 1]) box(t, h, d, sx * (w / 2 - t / 2), 0, 0);
    box(w, t, d, 0, h - t, 0);
    box(w, 0.05, d, 0, 0, 0);
    box(w, h, 0.01, 0, 0, -d / 2 + 0.005);
    for (let i = 1; i < 5; i++) box(w - t * 2, t, d, 0, (h / 5) * i, 0);
  },
  wardrobe({ box }, w, d, h) {
    box(w, h, d);
  },
  bed({ box, legs }, w, d, h) {
    const base = 0.3;
    legs(w, d, 0.08, 0.06, 0.04);
    box(w, base - 0.08, d, 0, 0.08, 0);
    box(w - 0.04, 0.22, d - 0.08, 0, base, 0.04); // mattress
    box(w + 0.04, h, 0.08, 0, 0, -d / 2 + 0.04); // headboard
    for (const sx of [-1, 1]) box(w * 0.38, 0.12, 0.35, sx * w * 0.23, base + 0.22, -d / 2 + 0.3);
  },
  rug({ box }, w, d, h) {
    box(w, Math.max(0.005, h), d);
  },
  plant({ THREE, cyl, add }, w, d, h) {
    const r = Math.min(w, d) / 2;
    cyl(r * 0.6, r * 0.45, h * 0.3, 0, 0, 0);
    const g = new THREE.SphereGeometry(1, 16, 12);
    const m = add(g, 0, h * 0.3 + (h * 0.7) / 2, 0);
    m.scale.set(r, (h * 0.7) / 2, r);
    const e = m.parent.children[m.parent.children.indexOf(m) + 1];
    e.scale.copy(m.scale);
  },
  floorLamp({ cyl }, w, d, h) {
    const r = Math.min(w, d) / 2;
    cyl(r * 0.6, r * 0.6, 0.03);
    cyl(0.015, 0.015, h * 0.8, 0, 0.03, 0, 8);
    cyl(r * 0.55, r, h * 0.22, 0, h * 0.78, 0);
  },
  tableLamp({ cyl }, w, d, h) {
    const r = Math.min(w, d) / 2;
    cyl(r * 0.5, r * 0.6, h * 0.5);
    cyl(r * 0.7, r, h * 0.45, 0, h * 0.55, 0);
  },
  stool({ cyl, legs }, w, d, h) {
    legs(w * 0.8, d * 0.8, h - 0.04, 0.03, 0.02);
    cyl(Math.min(w, d) / 2, Math.min(w, d) / 2, 0.05, 0, h - 0.05, 0);
  },
  stoolRow(k, w, d, h) {
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 0; i < n; i++) k.group.add(buildGroupInto(k, "stool", 0.4, 0.4, h, -w / 2 + (w / n) * (i + 0.5), 0));
  },
  lounger({ box, legs }, w, d, h) {
    legs(w, d, 0.2, 0.04, 0.05);
    box(w, 0.1, d * 0.7, 0, 0.2, d * 0.15);
    const back = box(w, 0.08, d * 0.35, 0, 0, 0);
    back.position.set(0, 0.2 + Math.sin(0.9) * d * 0.17, -d / 2 + d * 0.17);
    back.rotation.x = 0.9;
    const edge = back.parent.children[back.parent.children.indexOf(back) + 1];
    edge.position.copy(back.position);
    edge.rotation.copy(back.rotation);
  },
  umbrella({ cyl, THREE, add }, w, d, h) {
    const r = Math.min(w, d) / 2;
    cyl(0.25, 0.25, 0.08);
    cyl(0.02, 0.02, h - 0.3, 0, 0.08, 0, 8);
    add(new THREE.ConeGeometry(r, 0.4, 24), 0, h - 0.2, 0);
  },
  decor({ box, cyl }, w, d, h) {
    box(w * 0.35, h * 0.2, d * 0.8, -w * 0.3, 0, 0);
    cyl(w * 0.12, w * 0.08, h, w * 0.05, 0, 0);
    cyl(w * 0.06, w * 0.06, h * 0.5, w * 0.35, 0, 0);
  },
};

function buildGroupInto(parentKit, shape, w, d, h, x, z) {
  const k = builderKit(parentKit.color);
  (MODELS[shape] || MODELS.box)(k, w, d, h);
  k.group.position.set(x, 0, z);
  return k.group;
}

export function supports3D(shape) {
  return shape in MODELS;
}

function buildModel(item) {
  const k = builderKit(item.color);
  (MODELS[item.shape] || MODELS.box)(k, item.dims.w, item.dims.d, item.dims.h);
  return k.group;
}

function modelFor(item) {
  const key = JSON.stringify([item.shape, item.color, item.dims]);
  const hit = groupCache.get(item.uid);
  if (hit && hit.key === key) return hit.group;
  const group = buildModel(item);
  group.userData.uid = item.uid;
  groupCache.set(item.uid, { key, group });
  return group;
}

function sceneFor(room, items, { grid = false } = {}) {
  const THREE = T();
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  if (grid) {
    // 50 cm floor grid from just in front of the camera out to 30 m.
    const pts = [];
    for (let x = -15; x <= 15.001; x += 0.5) pts.push(x, 0.001, -0.3, x, 0.001, -30);
    for (let z = -0.5; z >= -30; z -= 0.5) pts.push(-15, 0.001, z, 15, 0.001, z);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.55 });
    scene.add(new THREE.LineSegments(geom, mat));
  }
  for (const item of items) {
    const group = modelFor(item);
    group.position.set(item.x, item.lift || 0, item.z);
    group.rotation.set(0, (item.yaw * Math.PI) / 180, 0);
    scene.add(group);
  }
  return scene;
}

// Renders all 3D items to a transparent canvas of the given pixel size.
export function renderItems(room, items, width, height, opts = {}) {
  const r = getRenderer(width, height);
  const cam = makeCamera(room, width / height);
  const scene = sceneFor(room, items, opts);
  r.render(scene, cam);
  // Groups are cached across frames; detach them so the next scene can own them.
  for (const item of items) scene.remove(modelFor(item));
  return r.domElement;
}

// Front-most 3D item under image position (u, v), or null.
export function pick(room, aspect, items, u, v) {
  if (!items.length) return null;
  const THREE = T();
  const cam = makeCamera(room, aspect);
  const scene = sceneFor(room, items);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), cam);
  const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.isMesh);
  for (const item of items) scene.remove(modelFor(item));
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.uid) o = o.parent;
    if (o) return o.userData.uid;
  }
  return null;
}

export function forget(uid) {
  groupCache.delete(uid);
}
