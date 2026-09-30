// Perspective for placeholders. An item keeps its plain box (centre, size,
// rotation) and adds skew, a perspective amount on each axis, and free
// offsets for each corner. quadFor() turns all of that into four points, and
// drawWarped() maps a flat rendering of the silhouette onto those points with
// a true perspective (projective) transform, so a sofa can be angled to match
// a photo that is not shot straight on.

const DEG = Math.PI / 180;
const PERSPECTIVE_STRENGTH = 0.3;

export function emptyWarp() {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
}

export function isWarped(item) {
  return Boolean(
    item.skewX || item.skewY || item.perspX || item.perspY || (item.warp || []).some((c) => c.x || c.y)
  );
}

// Corners before rotation, relative to the box centre, in target pixels.
// Order: top-left, top-right, bottom-right, bottom-left.
export function localCorners(item, w, h, { withWarp = true } = {}) {
  const pts = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  const tx = Math.tan((item.skewX || 0) * DEG);
  const ty = Math.tan((item.skewY || 0) * DEG);
  for (const p of pts) {
    const x = p.x + tx * p.y;
    const y = p.y + ty * p.x;
    p.x = x;
    p.y = y;
  }
  // Horizontal perspective: the far side gets shorter.
  const px = item.perspX || 0;
  if (px) {
    const k = PERSPECTIVE_STRENGTH * h * Math.abs(px);
    const [top, bottom] = px > 0 ? [1, 2] : [0, 3];
    pts[top].y += k;
    pts[bottom].y -= k;
  }
  // Vertical perspective: the far edge gets narrower (floor pieces seen from above).
  const py = item.perspY || 0;
  if (py) {
    const k = PERSPECTIVE_STRENGTH * w * Math.abs(py);
    const [left, right] = py > 0 ? [0, 1] : [3, 2];
    pts[left].x += k;
    pts[right].x -= k;
  }
  if (withWarp && item.warp) {
    item.warp.forEach((c, i) => {
      pts[i].x += c.x * w;
      pts[i].y += c.y * h;
    });
  }
  return pts;
}

// Final corners in target pixels for a box { x, y, w, h, r }.
export function quadFor(item, box) {
  const c = Math.cos(box.r);
  const s = Math.sin(box.r);
  return localCorners(item, box.w, box.h).map((p) => ({
    x: box.x + p.x * c - p.y * s,
    y: box.y + p.x * s + p.y * c,
  }));
}

// Homography that maps the unit square onto quad q (Heckbert's method).
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (dx3 || dy3) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

// Maps a point in the quad back to (u, v) in the unit square.
export function quadToSquare(q) {
  const m = squareToQuad(q);
  return m && invert3(m);
}

export function mapPoint(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return { u: (m[0] * x + m[1] * y + m[2]) / w, v: (m[3] * x + m[4] * y + m[5]) / w };
}

export function pointInQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) {
      inside = !inside;
    }
  }
  return inside;
}

export function centroid(q) {
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
}

// Renders the source canvas so its corners land on quad q and returns
// { canvas, x, y } to draw at (x, y), or null when the quad is degenerate.
// Done per pixel with bilinear sampling: exact perspective and no seams.
export function warpToCanvas(src, q) {
  const inv = quadToSquare(q);
  if (!inv) return null;
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const bw = Math.ceil(Math.max(...xs)) - x0;
  const bh = Math.ceil(Math.max(...ys)) - y0;
  if (bw <= 0 || bh <= 0 || bw * bh > 40e6) return null;

  const sw = src.width;
  const sh = src.height;
  const sdata = src.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = new ImageData(bw, bh);
  const d = out.data;
  for (let y = 0; y < bh; y++) {
    const py = y0 + y + 0.5;
    for (let x = 0; x < bw; x++) {
      const px = x0 + x + 0.5;
      const w = inv[6] * px + inv[7] * py + inv[8];
      const u = (inv[0] * px + inv[1] * py + inv[2]) / w;
      const v = (inv[3] * px + inv[4] * py + inv[5]) / w;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const fx = Math.min(sw - 1.001, Math.max(0, u * sw - 0.5));
      const fy = Math.min(sh - 1.001, Math.max(0, v * sh - 0.5));
      const ix = fx | 0;
      const iy = fy | 0;
      const ax = fx - ix;
      const ay = fy - iy;
      const i00 = (iy * sw + ix) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * bw + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = sdata[i00 + k] + (sdata[i10 + k] - sdata[i00 + k]) * ax;
        const bot = sdata[i01 + k] + (sdata[i11 + k] - sdata[i01 + k]) * ax;
        d[o + k] = top + (bot - top) * ay;
      }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  canvas.getContext("2d").putImageData(out, 0, 0);
  return { canvas, x: x0, y: y0 };
}
