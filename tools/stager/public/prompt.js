import { quadFor, isWarped } from "./warp.js";
import { itemCorners } from "./scene3d.js";

// Turns the layout into the text prompt sent with the photo and the guide.
// Image order is fixed: image 1 is the photo, image 2 is the guide, and any
// product photos follow in item order.

function horizontal(cx) {
  if (cx < 0.2) return "at the far left of the frame";
  if (cx < 0.4) return "on the left side of the frame";
  if (cx < 0.6) return "in the centre of the frame";
  if (cx < 0.8) return "on the right side of the frame";
  return "at the far right of the frame";
}

function depth(bottom) {
  if (bottom > 0.85) return "in the foreground, close to the camera";
  if (bottom > 0.65) return "in the middle of the room";
  return "toward the back of the room";
}

const pct = (v) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

// Final corners in fractions of the image (top-left, top-right,
// bottom-right, bottom-left), with skew and perspective applied.
export function itemQuad(item, W, H) {
  const box = { x: item.cx * W, y: item.cy * H, w: item.w * W, h: item.h * H, r: ((item.rotation || 0) * Math.PI) / 180 };
  return quadFor(item, box).map((p) => ({ x: p.x / W, y: p.y / H }));
}

export function itemBounds(item, W = 1, H = 1) {
  const q = itemQuad(item, W, H);
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), quad: q };
}

const at = (p) => `${pct(p.x)} across, ${pct(p.y)} down`;

function facingText(yaw) {
  const a = ((((yaw + 180) % 360) + 360) % 360) - 180;
  const side = a > 0 ? "right" : "left";
  const m = Math.abs(a);
  if (m < 20) return "Its front faces the camera.";
  if (m < 70) return `Its front faces the camera, turned about ${Math.round(m)} degrees toward the ${side} of the frame.`;
  if (m < 110) return `It is side-on to the camera, with its front facing the ${side} of the frame.`;
  if (m < 160) return `Its front faces away from the camera, angled toward the ${side} of the frame.`;
  return "Its back is to the camera and its front faces into the room.";
}

function describe3D(item, index, refImageNumber, W, H, room) {
  const c = itemCorners(room, W / H, item);
  const pts = [...c.bottom, ...c.top].map((q) => ({ x: q.u, y: q.v }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const b = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const what = (item.prompt || item.name || "piece of furniture").trim();
  const cm = (m) => Math.round(m * 100);
  const lines = [`${index + 1}. ${cap(item.colorName)} block, number ${index + 1}: ${what}.`];
  if (item.notes?.trim()) lines.push(`   Details: ${item.notes.trim().replace(/\.?$/, ".")}`);
  if (refImageNumber) lines.push(`   Match the product shown in image ${refImageNumber} as closely as possible (shape, colour, material, proportions).`);
  lines.push(`   Real size: about ${cm(item.dims.w)} cm wide, ${cm(item.dims.d)} cm deep and ${cm(item.dims.h)} cm tall.`);
  const cx = (b.left + b.right) / 2;
  const base = item.lift > 0.02 ? `Raised ${cm(item.lift)} cm off the floor, resting on the furniture below it` : "Standing on the floor";
  lines.push(`   ${base} ${horizontal(cx)}, ${depth(Math.max(c.bottom[0].v, c.bottom[1].v))}. It fills the box from ${pct(b.left)} to ${pct(b.right)} across and ${pct(b.top)} to ${pct(b.bottom)} down the image.`);
  lines.push(`   ${facingText(item.yaw)}`);
  const at2 = (q) => `${pct(q.u)} across, ${pct(q.v)} down`;
  lines.push(`   Its front bottom edge runs from ${at2(c.bottom[0])} to ${at2(c.bottom[1])}, and its back bottom edge from ${at2(c.bottom[3])} to ${at2(c.bottom[2])}.`);
  return lines.join("\n");
}

export function describeItem(item, index, refImageNumber, W = 1, H = 1, room = null) {
  if (item.kind === "3d" && room) return describe3D(item, index, refImageNumber, W, H, room);
  const b = itemBounds(item, W, H);
  const what = (item.prompt || item.name || "piece of furniture").trim();
  const lines = [`${index + 1}. ${cap(item.colorName)} placeholder, number ${index + 1}: ${what}.`];
  if (item.notes?.trim()) lines.push(`   Details: ${item.notes.trim().replace(/\.?$/, ".")}`);
  if (refImageNumber) lines.push(`   Match the product shown in image ${refImageNumber} as closely as possible (shape, colour, material, proportions).`);

  let where;
  if (item.mount === "wall") where = `Mounted on the wall ${horizontal(item.cx)}`;
  else if (item.mount === "ceiling") where = `Hanging from the ceiling ${horizontal(item.cx)}`;
  else if (item.mount === "surface") where = `Sitting on the surface or furniture beneath it, ${horizontal(item.cx)}`;
  else where = `Standing on the floor ${horizontal(item.cx)}, ${depth(b.bottom)}`;
  lines.push(`   ${where}. It fills the box from ${pct(b.left)} to ${pct(b.right)} across and ${pct(b.top)} to ${pct(b.bottom)} down the image.`);

  if (item.facing) lines.push(`   Facing ${item.facing}.`);
  const angled = isWarped(item) || Math.abs(item.rotation || 0) > 2;
  if (angled) {
    const [tl, tr, br, bl] = b.quad;
    lines.push("   The placeholder is drawn in perspective to show the angle the item sits at in this photo. Match that angle and orientation, not a straight-on view.");
    if (item.mount === "floor" || !item.mount) {
      lines.push(`   Its bottom edge runs from ${at(bl)} to ${at(br)}, and its top edge from ${at(tl)} to ${at(tr)}.`);
    } else {
      lines.push(`   Its corners are at ${at(tl)} (top left), ${at(tr)} (top right), ${at(br)} (bottom right) and ${at(bl)} (bottom left).`);
    }
  }
  return lines.join("\n");
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export function buildPrompt(scene, items, W = 1, H = 1, room = null) {
  let nextImage = 3;
  const refNumbers = items.map((it) => (it.ref ? nextImage++ : null));
  const refCount = nextImage - 3;

  const out = [];
  out.push(`Virtual staging for a real estate listing photo of a ${scene.room.toLowerCase()}.`);
  out.push("");
  out.push("Image 1 is the original photo.");
  out.push("Image 2 is the same photo with coloured, numbered placeholder shapes that show exactly where each piece of furniture goes and how big it is.");
  if (refCount) out.push(`Images 3${refCount > 1 ? ` to ${2 + refCount}` : ""} are product photos for specific items, as noted below.`);
  out.push("");
  out.push("Create a photorealistic version of image 1 with the furniture added. Replace every placeholder in image 2 with the real item described for it.");
  out.push("");
  out.push("Rules:");
  out.push("- Keep the room exactly as it is in image 1: walls, windows, doors, floor, ceiling, fixtures, the view outside, the lighting and the camera angle. Keep the same framing and aspect ratio.");
  out.push("- Put each item where its placeholder is, at the same size relative to the room. The bottom edge of a floor placeholder is where the item touches the floor.");
  if (items.some((it) => it.kind !== "3d")) {
    out.push("- The flat placeholders are rough outlines. Turn them into real 3D objects that follow the floor, walls and perspective of the room.");
  }
  out.push("- Give every item correct scale, contact shadows and reflections that match the existing light.");
  if (items.some((it) => it.kind === "3d")) {
    out.push("- The coloured 3D blocks are drawn in the room's perspective at real-world size. Each block shows the item's footprint, height and which way it faces. Replace each block with the real item occupying the same space, facing the same way.");
  }
  out.push("- Nothing from image 2 may appear in the result: no coloured shapes, blocks, outlines, numbers or labels.");
  out.push(
    scene.accessories
      ? "- You may add small accessories on the listed items (cushions, throws, books, a vase). Do not add any other furniture, rugs, plants, art or lights."
      : "- Do not add anything that is not listed below."
  );
  out.push(
    scene.clear
      ? "- Remove any existing furniture, boxes and clutter from image 1 before staging, and repair the floor and walls behind them."
      : "- Keep any existing built-ins and fixtures unchanged."
  );
  out.push("");
  out.push(`Style: ${scene.style}.${scene.palette?.trim() ? ` Palette and finishes: ${scene.palette.trim().replace(/\.?$/, ".")}` : ""} Every item should look like it belongs to one designed scheme.`);
  out.push("");
  if (items.length) {
    out.push(`Items (${items.length}):`);
    items.forEach((it, i) => out.push(describeItem(it, i, refNumbers[i], W, H, room)));
  } else {
    out.push("No placeholders have been placed. Stage the room tastefully in the chosen style.");
  }
  if (scene.extra?.trim()) {
    out.push("");
    out.push(`Additional instructions: ${scene.extra.trim()}`);
  }
  return out.join("\n");
}
