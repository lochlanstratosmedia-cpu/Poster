// Placeholder silhouettes. Each function draws inside a w x h box whose origin
// is the top-left corner. They are deliberately simple: the model only needs
// to read the kind of object, its footprint and its height.

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function part(ctx, pathFn) {
  pathFn();
  ctx.fill();
  ctx.stroke();
}

function legs(ctx, w, h, top, inset, thick) {
  part(ctx, () => rr(ctx, inset, top, thick, h - top, 1));
  part(ctx, () => rr(ctx, w - inset - thick, top, thick, h - top, 1));
}

const DRAW = {
  box(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h, Math.min(w, h) * 0.06));
  },
  sofa(ctx, w, h) {
    const arm = w * 0.09;
    part(ctx, () => rr(ctx, arm * 0.6, 0, w - arm * 1.2, h * 0.55, h * 0.08)); // back
    part(ctx, () => rr(ctx, 0, h * 0.3, arm, h * 0.6, h * 0.08)); // left arm
    part(ctx, () => rr(ctx, w - arm, h * 0.3, arm, h * 0.6, h * 0.08)); // right arm
    part(ctx, () => rr(ctx, arm, h * 0.5, w - arm * 2, h * 0.38, h * 0.06)); // seat
    legs(ctx, w, h, h * 0.88, arm * 0.3, Math.max(2, w * 0.02));
  },
  sectional(ctx, w, h) {
    DRAW.sofa(ctx, w * 0.7, h * 0.8);
    part(ctx, () => rr(ctx, w * 0.55, h * 0.45, w * 0.45, h * 0.5, h * 0.06)); // chaise
  },
  chair(ctx, w, h) {
    const arm = w * 0.16;
    part(ctx, () => rr(ctx, arm * 0.5, 0, w - arm, h * 0.6, w * 0.08));
    part(ctx, () => rr(ctx, 0, h * 0.35, arm, h * 0.5, w * 0.05));
    part(ctx, () => rr(ctx, w - arm, h * 0.35, arm, h * 0.5, w * 0.05));
    part(ctx, () => rr(ctx, arm, h * 0.52, w - arm * 2, h * 0.32, w * 0.05));
    legs(ctx, w, h, h * 0.85, arm * 0.3, Math.max(2, w * 0.05));
  },
  diningChair(ctx, w, h) {
    part(ctx, () => rr(ctx, w * 0.1, 0, w * 0.8, h * 0.5, w * 0.08));
    part(ctx, () => rr(ctx, 0, h * 0.48, w, h * 0.1, 2));
    legs(ctx, w, h, h * 0.58, w * 0.05, Math.max(2, w * 0.08));
  },
  ottoman(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.82, h * 0.2));
    legs(ctx, w, h, h * 0.82, w * 0.06, Math.max(2, w * 0.03));
  },
  lowTable(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.22, 2));
    part(ctx, () => rr(ctx, w * 0.06, h * 0.55, w * 0.88, h * 0.1, 1)); // shelf
    legs(ctx, w, h, h * 0.22, w * 0.04, Math.max(2, w * 0.03));
  },
  roundTable(ctx, w, h) {
    part(ctx, () => { ctx.beginPath(); ctx.ellipse(w / 2, h * 0.16, w / 2, h * 0.16, 0, 0, Math.PI * 2); });
    part(ctx, () => rr(ctx, w * 0.44, h * 0.28, w * 0.12, h * 0.62, 2));
    part(ctx, () => { ctx.beginPath(); ctx.ellipse(w / 2, h * 0.93, w * 0.22, h * 0.07, 0, 0, Math.PI * 2); });
  },
  table(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.12, 2));
    legs(ctx, w, h, h * 0.12, w * 0.05, Math.max(2, w * 0.035));
  },
  diningSet(ctx, w, h) {
    const cw = w * 0.14;
    for (const x of [w * 0.12, w * 0.43, w * 0.74]) {
      ctx.save();
      ctx.translate(x, 0);
      DRAW.diningChair(ctx, cw, h * 0.65);
      ctx.restore();
    }
    part(ctx, () => rr(ctx, 0, h * 0.35, w, h * 0.1, 2));
    legs(ctx, w, h, h * 0.45, w * 0.04, Math.max(2, w * 0.03));
  },
  desk(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.1, 2));
    part(ctx, () => rr(ctx, w * 0.65, h * 0.1, w * 0.32, h * 0.5, 2)); // drawers
    legs(ctx, w, h, h * 0.1, w * 0.03, Math.max(2, w * 0.03));
  },
  cabinet(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.88, 3));
    const doors = Math.max(1, Math.round(w / h));
    ctx.beginPath();
    for (let i = 1; i < doors; i++) {
      ctx.moveTo((w * i) / doors, h * 0.08);
      ctx.lineTo((w * i) / doors, h * 0.8);
    }
    ctx.stroke();
    legs(ctx, w, h, h * 0.88, w * 0.04, Math.max(2, w * 0.03));
  },
  shelf(ctx, w, h) {
    ctx.save();
    ctx.globalAlpha *= 0.55;
    part(ctx, () => rr(ctx, 0, 0, w, h, 2));
    ctx.restore();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    for (let i = 1; i < 5; i++) {
      ctx.moveTo(0, (h * i) / 5);
      ctx.lineTo(w, (h * i) / 5);
    }
    ctx.stroke();
  },
  wardrobe(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.96, 3));
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.03);
    ctx.lineTo(w / 2, h * 0.93);
    ctx.stroke();
  },
  bed(ctx, w, h) {
    part(ctx, () => rr(ctx, w * 0.03, 0, w * 0.94, h * 0.5, w * 0.03)); // headboard
    part(ctx, () => rr(ctx, 0, h * 0.4, w, h * 0.5, w * 0.02)); // mattress
    part(ctx, () => rr(ctx, w * 0.1, h * 0.3, w * 0.35, h * 0.14, h * 0.06)); // pillows
    part(ctx, () => rr(ctx, w * 0.55, h * 0.3, w * 0.35, h * 0.14, h * 0.06));
    legs(ctx, w, h, h * 0.9, w * 0.02, Math.max(2, w * 0.02));
  },
  rug(ctx, w, h) {
    // Drawn as a floor-level trapezoid so it reads as lying flat.
    ctx.save();
    ctx.globalAlpha *= 0.7;
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.1, 0);
      ctx.lineTo(w * 0.9, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
    });
    ctx.restore();
  },
  plant(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.2, h * 0.72);
      ctx.lineTo(w * 0.8, h * 0.72);
      ctx.lineTo(w * 0.7, h);
      ctx.lineTo(w * 0.3, h);
      ctx.closePath();
    });
    part(ctx, () => {
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.38, w / 2, h * 0.36, 0, 0, Math.PI * 2);
    });
  },
  art(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h, 1));
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    ctx.restore();
    ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
  },
  mirror(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h, w / 2));
  },
  decor(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, h * 0.7, w * 0.35, h * 0.3, 1)); // books
    part(ctx, () => { ctx.beginPath(); ctx.ellipse(w * 0.6, h * 0.62, w * 0.12, h * 0.38, 0, 0, Math.PI * 2); }); // vase
    part(ctx, () => rr(ctx, w * 0.8, h * 0.6, w * 0.14, h * 0.4, 2)); // candle
  },
  curtain(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      for (let i = 4; i >= 0; i--) ctx.quadraticCurveTo((w * (i + 0.5)) / 4, h * 1.02, (w * i) / 4, h);
      ctx.closePath();
    });
  },
  floorLamp(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.2, 0);
      ctx.lineTo(w * 0.8, 0);
      ctx.lineTo(w, h * 0.22);
      ctx.lineTo(0, h * 0.22);
      ctx.closePath();
    });
    part(ctx, () => rr(ctx, w * 0.45, h * 0.22, w * 0.1, h * 0.74, 1));
    part(ctx, () => rr(ctx, w * 0.15, h * 0.95, w * 0.7, h * 0.05, 2));
  },
  tableLamp(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.2, 0);
      ctx.lineTo(w * 0.8, 0);
      ctx.lineTo(w, h * 0.45);
      ctx.lineTo(0, h * 0.45);
      ctx.closePath();
    });
    part(ctx, () => { ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, w * 0.25, h * 0.27, 0, 0, Math.PI * 2); });
  },
  pendant(ctx, w, h) {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h * 0.5);
    ctx.stroke();
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.5);
      ctx.lineTo(w * 0.65, h * 0.5);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
    });
  },
  stool(ctx, w, h) {
    part(ctx, () => rr(ctx, 0, 0, w, h * 0.1, 3));
    legs(ctx, w, h, h * 0.1, w * 0.1, Math.max(2, w * 0.1));
    part(ctx, () => rr(ctx, w * 0.1, h * 0.65, w * 0.8, h * 0.04, 1));
  },
  stoolRow(ctx, w, h) {
    const n = 3;
    const sw = w / (n * 1.4);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(sw * 0.2 + i * sw * 1.4, 0);
      DRAW.stool(ctx, sw, h);
      ctx.restore();
    }
  },
  lounger(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.3, h * 0.55);
      ctx.lineTo(w, h * 0.55);
      ctx.lineTo(w, h * 0.75);
      ctx.lineTo(w * 0.22, h * 0.75);
      ctx.lineTo(0, h * 0.1);
      ctx.closePath();
    });
    legs(ctx, w, h, h * 0.75, w * 0.2, Math.max(2, w * 0.02));
  },
  umbrella(ctx, w, h) {
    part(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.3);
      ctx.quadraticCurveTo(w / 2, -h * 0.1, w, h * 0.3);
      ctx.closePath();
    });
    part(ctx, () => rr(ctx, w * 0.48, h * 0.2, w * 0.04, h * 0.76, 1));
    part(ctx, () => rr(ctx, w * 0.35, h * 0.95, w * 0.3, h * 0.05, 2));
  },
};

// Draw a silhouette in the current transform. `alpha` sets the fill opacity.
export function drawShape(ctx, shape, w, h, color, { alpha = 0.55, lineWidth = 2 } = {}) {
  const draw = DRAW[shape] || DRAW.box;
  ctx.save();
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  draw(ctx, w, h);
  ctx.restore();
}

export function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
