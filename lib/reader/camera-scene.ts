// Pixel-art drawing for the six fixed security cameras.
// Everything is drawn in one-point perspective around a single vanishing point, so walls,
// floor, furniture and characters agree on depth. Characters are paperclips.

export const CAMERA_WIDTH = 320;
export const CAMERA_HEIGHT = 176;

export const palette = [
  "#101b19", "#1b2c24", "#293c30", "#364b39", "#465c43",
  "#5b7251", "#728764", "#8e9e77", "#abb48b", "#ced1a3",
];

type Ctx = CanvasRenderingContext2D;
type Point = [number, number];

// ---- Room geometry -------------------------------------------------------------------------

const VP: Point = [160, 58]; // the single vanishing point
const BACK = { left: 72, right: 248, top: 26, bottom: 99 }; // back wall, 55% of the image around VP
const FLOOR_EDGE = 132.5; // where the wall-floor seams leave the image at x = 0 and x = 320

// Moves a point a fraction `f` of the way toward the vanishing point (i.e. further away).
const recede = ([x, y]: Point, f: number): Point => [x + (VP[0] - x) * f, y + (VP[1] - y) * f];

// Left and right edges of the visible floor on a given row.
const floorLeft = (y: number) => BACK.left - ((y - BACK.bottom) * BACK.left) / (FLOOR_EDGE - BACK.bottom);
const floorRight = (y: number) => BACK.right + ((y - BACK.bottom) * (CAMERA_WIDTH - BACK.right)) / (FLOOR_EDGE - BACK.bottom);

// How big a character standing at row `fy` appears; proportional to its distance below the horizon.
export function figureScale(fy: number) {
  return Math.min(2.4, Math.max(0.6, (1.05 * (fy - VP[1])) / (BACK.bottom - VP[1])));
}

// ---- Pixel primitives ----------------------------------------------------------------------

// Scanline polygon fill keeps every edge on whole pixels, so the limited palette stays crisp.
export function fillPoly(ctx: Ctx, points: Point[], color: string) {
  const ys = points.map(([, y]) => y);
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(CAMERA_HEIGHT - 1, Math.ceil(Math.max(...ys)));
  ctx.fillStyle = color;
  for (let y = top; y <= bottom; y++) {
    const row = y + 0.5;
    const hits: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= row && y2 > row) || (y2 <= row && y1 > row)) {
        hits.push(x1 + ((row - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const from = Math.round(hits[i]);
      const to = Math.round(hits[i + 1]);
      if (to > from) ctx.fillRect(from, y, to - from, 1);
    }
  }
}

// Pixel line; `size` stamps a square brush, `keep` can reject pixels (used to clip to the floor).
function drawLine(ctx: Ctx, points: Point[], color: string, size = 1, keep?: (x: number, y: number) => boolean) {
  ctx.fillStyle = color;
  const half = Math.floor(size / 2);
  for (let i = 0; i + 1 < points.length; i++) {
    let [x0, y0] = points[i].map(Math.round);
    const [x1, y1] = points[i + 1].map(Math.round);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!keep || keep(x0, y0)) ctx.fillRect(x0 - half, y0 - half, size, size);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

const box = (ctx: Ctx, x: number, y: number, w: number, h: number, c: number) => {
  ctx.fillStyle = palette[c];
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

// ---- Room shell: walls, floor, ceiling and things mounted on the back wall -----------------

// Outdoor camera above the main entrance: night sky, facade, steps and paving.
function drawEntrance(ctx: Ctx) {
  const poly = (pts: Point[], c: number) => fillPoly(ctx, pts, palette[c]);
  box(ctx, 0, 0, CAMERA_WIDTH, 100, 0); // night sky
  box(ctx, 0, 60, CAMERA_WIDTH, 40, 1);
  for (const [x, y] of [[14, 8], [52, 20], [96, 5], [230, 12], [276, 26], [305, 6], [180, 3]]) box(ctx, x, y, 1, 1, 7);
  // Facade with a grid of mostly dark windows; a couple are still lit.
  box(ctx, 30, 14, 260, 86, 2);
  box(ctx, 30, 14, 260, 3, 3);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      const x = 40 + col * 28, y = 22 + row * 22;
      if (x > 124 && x < 186 && row > 0) continue; // leave room for the entrance
      const lit = (row === 0 && col === 6) || (row === 2 && col === 1);
      box(ctx, x, y, 16, 12, lit ? 6 : 1);
      if (lit) box(ctx, x + 2, y + 2, 12, 2, 8);
    }
  }
  // Entrance sign, glass doors and steps.
  box(ctx, 126, 42, 68, 8, 1); box(ctx, 128, 44, 64, 4, 4);
  for (let i = 0; i < 8; i++) box(ctx, 132 + i * 7, 45, 4, 2, 8);
  box(ctx, 140, 54, 40, 46, 1); box(ctx, 143, 57, 16, 43, 5); box(ctx, 161, 57, 16, 43, 5);
  box(ctx, 156, 76, 2, 6, 8); box(ctx, 162, 76, 2, 6, 8);
  box(ctx, 124, 100, 72, 3, 5); box(ctx, 118, 103, 84, 3, 4); box(ctx, 112, 106, 96, 4, 5);
  // Paving: seams run to the vanishing point, rows tighten toward the building.
  box(ctx, 0, 100, CAMERA_WIDTH, 76, 3);
  const k = (100 - VP[1]) / (CAMERA_HEIGHT - VP[1]);
  for (let x = -360; x <= 680; x += 50) drawLine(ctx, [[VP[0] + (x - VP[0]) * k, 100], [x, CAMERA_HEIGHT]], palette[2]);
  for (const m of [1.2, 1.5, 1.9, 2.5]) {
    const y = Math.round(VP[1] + (100 - VP[1]) * m);
    drawLine(ctx, [[0, y], [CAMERA_WIDTH, y]], palette[2]);
  }
  // Shrubs along the facade.
  for (const x0 of [36, 206]) {
    for (let i = 0; i < 6; i++) poly([[x0 + i * 14, 102], [x0 + i * 14 + 7, 90 + (i % 2) * 3], [x0 + i * 14 + 16, 102]], 1);
  }
}

export function drawShell(ctx: Ctx, scene: number) {
  if (scene === 0) { drawEntrance(ctx); return; }
  const poly = (pts: Point[], c: number) => fillPoly(ctx, pts, palette[c]);
  const line = (pts: Point[], c: number, keep?: (x: number, y: number) => boolean) => drawLine(ctx, pts, palette[c], 1, keep);
  const { left, right, top, bottom } = BACK;

  box(ctx, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT, 2); // ceiling
  poly([[left, top], [right, top], [right, bottom], [left, bottom]], 4); // back wall
  poly([[0, 0], [left, top], [left, bottom], [0, FLOOR_EDGE]], 3); // left wall
  poly([[CAMERA_WIDTH, 0], [right, top], [right, bottom], [CAMERA_WIDTH, FLOOR_EDGE]], 2); // right wall
  poly([[0, FLOOR_EDGE], [left, bottom], [right, bottom], [CAMERA_WIDTH, FLOOR_EDGE], [CAMERA_WIDTH, CAMERA_HEIGHT], [0, CAMERA_HEIGHT]], 4);

  // Floor tiles: seams run to the vanishing point, rows get closer together with distance.
  const onFloor = (x: number, y: number) => y >= bottom && x >= floorLeft(y) && x <= floorRight(y);
  const k = (bottom - VP[1]) / (CAMERA_HEIGHT - VP[1]);
  for (let x = -360; x <= 680; x += 60) line([[VP[0] + (x - VP[0]) * k, bottom], [x, CAMERA_HEIGHT]], 3, onFloor);
  for (const m of [1.15, 1.4, 1.75, 2.3]) {
    const y = Math.round(VP[1] + (bottom - VP[1]) * m);
    line([[Math.max(0, floorLeft(y)), y], [Math.min(CAMERA_WIDTH, floorRight(y)), y]], 3);
  }

  // Back wall trim and panel seams.
  for (const y of [29, 95, 98]) line([[left, y], [right, y]], 2);
  for (const x of [119, 159, 198, 236]) line([[x, 29], [x, 94]], 3);

  // Ceiling light panels: rectangles on the ceiling, narrower at their far edge.
  const farRatio = (VP[1] - 18) / (VP[1] - 12);
  for (const [a, b] of [[104, 144], [176, 216]]) {
    poly([[a, 12], [b, 12], [VP[0] + (b - VP[0]) * farRatio, 18], [VP[0] + (a - VP[0]) * farRatio, 18]], 7);
  }

  // Metal door frame and inset observation pane.
  if (scene === 2) {
    box(ctx, 95, 42, 23, 55, 1); box(ctx, 97, 44, 19, 52, 3); box(ctx, 100, 48, 13, 14, 5);
  } else {
    const bx = scene === 6 ? 169 : 202;
    box(ctx, bx, 41, 31, 58, 1); box(ctx, bx + 2, 43, 27, 55, 3); box(ctx, bx + 7, 49, 15, 14, 1);
    box(ctx, bx + 8, 50, 13, 10, 5); box(ctx, bx + 22, 72, 3, 2, 7);
  }
  if (scene === 4) {
    for (const x of [95, 135]) { box(ctx, x, 42, 23, 55, 1); box(ctx, x + 2, 44, 19, 52, 3); box(ctx, x + 5, 48, 13, 14, 5); }
  }
  if (scene === 3) { box(ctx, 145, 40, 45, 28, 1); box(ctx, 147, 42, 41, 24, 3); }
}

// ---- Furniture: drawn every frame, depth-sorted together with the characters ---------------

export type Drawable = { baseY: number; draw: (ctx: Ctx) => void };

function cabinet(x: number, y: number, w: number, h: number, depth: number): Drawable {
  return {
    baseY: y + h,
    draw(ctx) {
      // The visible side faces the vanishing point.
      const edge = x + w < VP[0] ? x + w : x;
      fillPoly(ctx, [[edge, y], recede([edge, y], depth), recede([edge, y + h], depth), [edge, y + h]], palette[1]);
      if (y > VP[1]) fillPoly(ctx, [[x, y], [x + w, y], recede([x + w, y], depth), recede([x, y], depth)], palette[6]);
      box(ctx, x, y, w, h, 4);
      drawLine(ctx, [[x, y + h - 1], [x, y], [x + w - 1, y]], palette[6]);
      for (let cy = y + 3; cy < y + h - 9; cy += 12) {
        box(ctx, x + 2, cy, w - 4, 10, 3);
        drawLine(ctx, [[x + 3, cy], [x + w - 4, cy]], palette[5]);
        box(ctx, x + Math.floor(w / 2) - 3, cy + 3, 7, 2, 7);
      }
    },
  };
}

function desk(x: number, y: number, extra?: (ctx: Ctx) => void): Drawable {
  const w = 48, depth = 8;
  // The front edge is the back edge scaled away from the vanishing point.
  const s = (y + depth - VP[1]) / (y - VP[1]);
  const fl = VP[0] + (x - VP[0]) * s;
  const fr = VP[0] + (x + w - VP[0]) * s;
  const fy = y + depth;
  return {
    baseY: fy + 23,
    draw(ctx) {
      box(ctx, x + 2, y + 1, 3, 20, 1); box(ctx, x + w - 5, y + 1, 3, 20, 1); // back legs
      fillPoly(ctx, [[x, y], [x + w, y], [fr, fy], [fl, fy]], palette[6]);
      box(ctx, fl, fy + 1, fr - fl, 4, 2);
      box(ctx, fl + 1, fy + 5, 3, 18, 1); box(ctx, fr - 4, fy + 5, 3, 18, 1);
      extra?.(ctx);
    },
  };
}

function crate(x: number, y: number): Drawable {
  return {
    baseY: y + 13,
    draw(ctx) {
      fillPoly(ctx, [[x, y], [x + 20, y], recede([x + 20, y], 0.08), recede([x, y], 0.08)], palette[6]);
      box(ctx, x, y, 20, 13, 3); box(ctx, x + 8, y + 2, 3, 8, 5);
    },
  };
}

const stairs: Drawable = {
  baseY: 149,
  draw(ctx) {
    fillPoly(ctx, [[0, 150], [72, 113], [74, 151], [47, 163], [0, 161]], "#090b0c");
    fillPoly(ctx, [[5, 153], [58, 128], [46, 156], [0, 160]], "#040506");
    for (let j = 0; j < 6; j++) {
      const x = 6 + j * 4;
      const y = 145 - j * 6;
      fillPoly(ctx, [[x, y], [x + 46, y], [x + 50, y - 2], [x + 4, y - 2]], palette[5]);
      box(ctx, x, y + 1, 46, 3, j > 2 ? 3 : 2);
    }
  },
};

const papers = (ctx: Ctx) => { for (let i = 0; i < 4; i++) box(ctx, 127 + i * 2, 112 + i, 11, 2, 8); };
const terminal = (ctx: Ctx) => { box(ctx, 106, 65, 28, 18, 1); box(ctx, 108, 67, 24, 13, 5); box(ctx, 117, 83, 5, 4, 2); };

// Street lamp with a flickering pool of light on the paving.
const streetLamp: Drawable = {
  baseY: 128,
  draw(ctx) {
    const on = Math.random() > 0.04; // the bulb drops out now and then
    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.09;
      fillPoly(ctx, [[58, 40], [68, 40], [96, 130], [30, 130]], palette[9]);
      ctx.globalAlpha = 0.14;
      fillPoly(ctx, [[34, 126], [92, 126], [100, 134], [26, 134]], palette[9]);
      ctx.restore();
    }
    box(ctx, 61, 40, 3, 88, 1);
    box(ctx, 55, 35, 15, 5, 5);
    box(ctx, 58, 40, 9, 2, on ? 9 : 4);
  },
};

const bench: Drawable = {
  baseY: 126,
  draw(ctx) {
    box(ctx, 218, 106, 44, 3, 5); // backrest
    fillPoly(ctx, [[216, 114], [264, 114], [268, 119], [212, 119]], palette[6]);
    box(ctx, 216, 119, 3, 7, 1); box(ctx, 261, 119, 3, 7, 1);
  },
};

export function sceneProps(scene: number): Drawable[] {
  if (scene === 0) return [streetLamp, bench];
  if (scene === 1 || scene === 5) {
    const props = [
      ...[80, 106, 132].map(x => cabinet(x, 44, 24, 53, 0.03)),
      ...[9, 38].map(x => cabinet(x, 57, 27, 68, 0.1)),
      desk(108, 111, papers),
    ];
    if (scene === 5) props.push(crate(181, 113), crate(199, 127), crate(177, 101));
    return props;
  }
  if (scene === 2) return [stairs];
  if (scene === 4) return [];
  if (scene === 3) return [desk(94, 84, terminal), desk(12, 116)];
  return [desk(94, 84, terminal), desk(54, 111), cabinet(235, 51, 17, 45, 0.04)];
}

// ---- Paperclip characters ------------------------------------------------------------------

export type Pose = "stand" | "read" | "phone" | "crouch" | "listen" | "knife" | "down";

export type FigureLook = { wire: number; glint: number; eye: number; flashlight?: boolean };

export const protagonistLook: FigureLook = { wire: 8, glint: 9, eye: 0 };
export const pursuerLook: FigureLook = { wire: 0, glint: 3, eye: 9, flashlight: true };
export const guardLook: FigureLook = { wire: 6, glint: 8, eye: 0 };

// A gem clip bent into one stroke, feet at (0, 0), facing +x. Units are scaled by figureScale.
const CLIP: Point[] = [
  [-2, -15], [-2, -29], [-1, -31], [1, -31], [2, -29], [2, -9], [1, -7], [-4, -7],
  [-5, -9], [-5, -32], [-4, -34], [4, -34], [5, -32], [5, -16],
];

function figureTransform(fx: number, fy: number, face: 1 | -1, pose: Pose) {
  const s = figureScale(fy);
  const squash = pose === "crouch" ? 0.7 : 1;
  const lean = pose === "listen" ? 0.14 : 0;
  return ([dx, dy]: Point): Point => {
    if (pose === "down") return [fx + (-dy - 18) * s * face, fy + (dx * 0.6 - 3) * s];
    return [fx + (dx - dy * lean) * s * face, fy + dy * squash * s];
  };
}

export function drawFigure(ctx: Ctx, opts: {
  fx: number; fy: number; face: 1 | -1; pose: Pose; step: number; walking: boolean; look: FigureLook; tick: number;
}) {
  const { fx, fy, face, pose, step, walking, look, tick } = opts;
  const s = figureScale(fy);
  const T = figureTransform(fx, fy, face, pose);
  const wire = Math.max(1, Math.round(1.3 * s));
  const thin = Math.max(1, wire - 1);
  const stroke = (pts: Point[], c: number, size = wire) => drawLine(ctx, pts.map(T), palette[c], size);
  const rect = (dx: number, dy: number, w: number, h: number, c: number) =>
    fillPoly(ctx, [T([dx, dy]), T([dx + w, dy]), T([dx + w, dy + h]), T([dx, dy + h])], palette[c]);

  // Floor shadow, always flat on the floor.
  fillPoly(ctx, [[fx - 6 * s, fy], [fx + 6 * s, fy], [fx + 9 * s * face, fy + 2 * s], [fx - 3 * s * face, fy + 2 * s]], palette[3]);

  if (pose !== "down") {
    const swing = walking ? Math.sin(step) * 2 : 0;
    stroke([[-1.5, -7], [-1.5 + swing, 0]], look.wire, thin);
    stroke([[2, -7], [2 - swing, 0]], look.wire, thin);
  }

  stroke(CLIP, look.wire);
  stroke([[-4, -33], [-3, -34]], look.glint, Math.max(1, wire - 1));
  // Two eyes inside the inner loop; they slide toward the facing side.
  const eye = Math.max(1, Math.round(s * 0.9));
  for (const ex of [-0.6, 1.2]) {
    const [x, y] = T([ex, -26]);
    box(ctx, x - eye / 2, y - eye / 2, eye, eye, look.eye);
  }
  if (pose === "down") return;

  const hand: Point = [5, -20];
  if (pose === "read" || pose === "phone") {
    stroke([hand, [8, -23]], look.wire, thin);
    if (pose === "read") rect(7, -28, 5, 6, 9);
    else rect(7.5, -26, 2.5, 3.5, 9);
  } else if (pose === "knife") {
    stroke([hand, [10, -20]], look.wire, thin);
    stroke([[10, -20], [15, -21]], 9, 1);
  } else if (pose === "listen") {
    stroke([hand, [7, -24], [7, -28]], look.wire, thin);
  } else {
    stroke([hand, [7, -16 + (walking ? 0 : tick % 2)]], look.wire, thin);
  }

  if (look.flashlight && pose !== "crouch") {
    rect(7, -22, 5, 3, 6);
    rect(12, -23, 1.5, 5, 8);
  }
}

// The flashlight cone fades with distance, sweeps slowly and flickers.
export function drawFlashlight(ctx: Ctx, fx: number, fy: number, face: 1 | -1, time: number) {
  const s = figureScale(fy);
  const hx = fx + 13 * s * face;
  const hy = fy - 20.5 * s;
  const sweep = Math.sin(time / 1300) * 14;
  const flicker = Math.sin(time / 90) > 0.93 ? 0.02 : 0;
  ctx.save();
  for (const length of [60, 110, 160]) {
    const k = length / 160;
    ctx.globalAlpha = 0.05 + flicker;
    fillPoly(ctx, [
      [hx, hy - 2],
      [hx + length * face, hy + (fy - 40 + sweep - hy) * k],
      [hx + length * face, hy + (fy + 22 + sweep - hy) * k],
      [hx, hy + 2],
    ], palette[9]);
  }
  ctx.restore();
}

// Duty officer standing behind the lobby desk in the last scene.
export const guard = { fx: 80, fy: 128 };

// Live sensor noise, an occasional horizontal tear and a slow rolling band.
export function drawInterference(ctx: Ctx, time: number, random: () => number) {
  ctx.fillStyle = palette[3];
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(random() * CAMERA_WIDTH);
    const y = 100 + Math.floor(random() * 76);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = palette[8];
  for (let i = 0; i < 28; i++) {
    ctx.fillRect(Math.floor(random() * CAMERA_WIDTH), Math.floor(random() * CAMERA_HEIGHT), 1, 1);
  }
  const band = Math.floor((time / 40) % (CAMERA_HEIGHT + 40)) - 20;
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = palette[9];
  ctx.fillRect(0, band, CAMERA_WIDTH, 6);
  ctx.restore();
  if (random() < 0.018) {
    const y = Math.floor(random() * CAMERA_HEIGHT);
    const h = 2 + Math.floor(random() * 6);
    const shift = (random() < 0.5 ? -1 : 1) * (3 + Math.floor(random() * 8));
    ctx.drawImage(ctx.canvas, 0, y, CAMERA_WIDTH, h, shift, y, CAMERA_WIDTH, h);
  }
}
