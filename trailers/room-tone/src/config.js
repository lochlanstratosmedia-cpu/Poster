// Room Tone trailer: every time, position and line of copy lives here.
// Times are seconds from the start of the film. Change a cue in T and the
// typing, pointer, camera and fades that reference it move with it.
window.RT = window.RT || {};

RT.FPS = 60;
RT.DURATION = 45;
RT.W = 1920;
RT.H = 1080;

// Mark components that are stand-ins until real screenshots arrive.
RT.SHOW_STANDIN_TAG = true;

// The four ambient tracks. The real names are still needed from the app.
RT.TRACKS = ["Track 1", "Track 2", "Track 3", "Track 4"];
RT.TRACK_PICK = 1;

// ---------------------------------------------------------------------------
// Geometry. The desk plate is the light-on screenshot (2000 x 945 after the
// bottom strip), scaled to cover a 1920 x 1080 viewport and centred. All app
// positions below are viewport pixels at camera zoom 1.
// ---------------------------------------------------------------------------
(() => {
  const plate = { w: 2000, h: 945 };
  const k = RT.H / plate.h;
  const x0 = (RT.W - plate.w * k) / 2;
  const sx = (x) => x * k + x0;
  const sy = (y) => y * k;
  RT.PLATE = { ...plate, k, x0, sx, sy };

  // Paper edges measured in the screenshot (see tools/build_plates.py).
  const page = { left: sx(689), top: sy(144), right: sx(1252), bottom: sy(889) };
  page.width = page.right - page.left;
  page.ppi = page.width / 8.5; // 12 pt Courier at 10 cpi / 6 lpi fits this grid
  page.scale = page.ppi / 96; // page content is laid out at 96 px per inch
  page.cx = (page.left + page.right) / 2;
  page.cy = (page.top + page.bottom) / 2;
  RT.PAGE = page;

  // Glass controls, measured from the screenshots and converted to viewport px.
  RT.UI = {
    nav: { cx: sx(782) + (376 * k) / 2, w: 376 * k, h: 46.4 * k, topCy: sy(18.4) + (46.4 * k) / 2, homeCy: page.cy, padX: 19 * k, font: 12.7 * k },
    switches: { top: sy(18), right: 18 * k, h: 36 * k, font: 11.3 * k, gap: 7 * k },
    pageNav: { left: sx(760), top: sy(900), w: 187 * k, h: 25.7 * k, font: 6.4 * k },
    zoom: { left: sx(1053), top: sy(900), w: 106 * k, h: 25.7 * k },
    saved: { left: 9 * k, top: sy(911), font: 6.4 * k },
  };
})();

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------
const T = (RT.T = {
  // 0-5  opening
  wordIn: 0.6, wordOut: 2.45, appIn: 2.7, appInDur: 1.7,
  // 5-11 open a script
  ptrIn: 5.15, clickScript: 6.2, glide: 6.32, glideDur: 1.0, pageIn: 6.5, navIdle: 9.0,
  // 11-20 typing
  caretOn: 11.4, typeAction: 12.05, enter1: 14.45, tab: 15.05, typeChar: 15.45, enter2: 16.3, typeDialogue: 16.65,
  // 20-26 select, format, keep writing
  selStart: 20.4, selDur: 0.6, pillIn: 21.05, clickItalic: 21.95, clickAway: 22.65,
  enter3: 23.0, typeAction2: 23.3, focusFade: 23.4,
  // 26-34 sound and light
  wake: 26.0, clickSound: 27.2, clickTrack: 28.4, clickLight: 30.25, lightFade: 1.3,
  // 34-40 title sheet, export, PDF
  clickFirst: 33.8, clickAuthor: 34.75, typeAuthor: 34.95, clickPdf: 36.3, clickExport: 36.9,
  pdfIn: 37.05, pdfZoom: 38.0, pdfHold: 38.95, pdfBack: 39.7,
  // 40-45 return and close
  morph: 40.35, morphDur: 1.15, endDim: 42.35, endWord: 42.85, endLine: 43.45,
});

// Typing and editing, in order. `cps` is characters per second; a seeded
// jitter keeps it natural but identical on every render.
RT.EDITS = [
  { t: T.typeAction, op: "type", text: "The radio hisses, then dies.", cps: 13, seed: 3 },
  { t: T.enter1, op: "enter" },
  { t: T.tab, op: "tab" },
  { t: T.typeChar, op: "type", text: "MARGOT", cps: 11, seed: 5 },
  { t: T.enter2, op: "enter" },
  { t: T.typeDialogue, op: "type", text: "Not tonight. Not with the boat still out.", cps: 15, seed: 7 },
  { t: T.selStart, op: "select", from: 31, to: 40, dur: T.selDur },
  { t: T.clickItalic, op: "italic" },
  { t: T.clickAway, op: "collapse" },
  { t: T.enter3, op: "enter" },
  { t: T.typeAction2, op: "type", text: "She lifts the lid. One fuse left.", cps: 13, seed: 9 },
];
RT.AUTHOR_TYPING = { t: T.typeAuthor, cps: 12, seed: 11 };

// What the page shows: [time, view, optional fade seconds].
RT.PAGE_VIEW = [
  [0, "blank"],
  [T.pageIn, "live"],
  [T.clickFirst + 0.08, "title", 0.16], // page nav swaps pages almost at once
  [T.morph - 0.1, "blank"], // hidden under the PDF while page 1 travels
  [T.morph + T.morphDur - 0.3, "final"],
];
RT.PAGE_FADE = 0.45;

// ---------------------------------------------------------------------------
// Camera over the app: x, y is the viewport point at frame centre, z is zoom.
// `cut` jumps instead of easing (only used while the app is hidden).
// ---------------------------------------------------------------------------
RT.CAM = [
  { t: 0, x: 960, y: 540, z: 1.07 },
  { t: T.appIn, x: 960, y: 540, z: 1.07 },
  { t: 5.7, x: 960, y: 540, z: 1.0 },
  { t: T.glide, x: 960, y: 540, z: 1.0 },
  { t: 10.6, x: 868, y: 446, z: 1.22 },
  { t: 12.0, x: 772, y: 362, z: 1.9 },
  { t: 16.2, x: 776, y: 382, z: 1.95 },
  { t: 19.8, x: 784, y: 400, z: 2.0 },
  { t: 20.55, x: 832, y: 402, z: 2.55 },
  { t: 22.9, x: 832, y: 404, z: 2.55 },
  { t: 24.3, x: 778, y: 428, z: 1.95 },
  { t: 26.0, x: 778, y: 432, z: 1.95 },
  { t: 27.0, x: 1280, y: 360, z: 1.5 },
  { t: 30.35, x: 1280, y: 360, z: 1.5 },
  { t: 32.0, x: 960, y: 540, z: 1.0 },
  { t: 33.4, x: 960, y: 540, z: 1.0 },
  { t: 34.1, x: 960, y: 540, z: 1.0 },
  { t: 35.0, x: 926, y: 498, z: 2.15 },
  { t: 35.75, x: 926, y: 498, z: 2.15 },
  { t: 36.25, x: 1010, y: 360, z: 1.5 },
  { t: 37.4, x: 1010, y: 360, z: 1.5 },
  { t: 37.45, x: 960, y: 540, z: 1.0, cut: true },
  { t: 41.5, x: 960, y: 540, z: 1.0 },
  { t: 45, x: 960, y: 540, z: 1.035 },
];

// Camera inside the PDF preview. Page tops sit at y 294. "pair" frames the
// tops of the third and fourth sheets, where "2." and "3." sit.
RT.PDF = { pageW: 380, gap: 36, top: 294 };
RT.PDF_CAM = [
  { t: T.pdfIn, x: 960, y: 540, z: 0.965 },
  { t: T.pdfZoom, x: 960, y: 540, z: 1.0 },
  { t: T.pdfHold, x: "pair", y: 392, z: 2.05 },
  { t: T.pdfBack, x: "pair", y: 396, z: 2.08 },
  { t: T.morph, x: 960, y: 540, z: 1.0 },
];

// ---------------------------------------------------------------------------
// Pointer. `at` names a target the engine resolves at that key's time.
// Shapes: arrow over controls, ibeam over text.
// ---------------------------------------------------------------------------
RT.POINTER = {
  visible: [
    [T.ptrIn, T.glide + 0.55],
    [20.05, 23.05],
    [T.wake, 30.9],
    [33.25, 37.25],
  ],
  keys: [
    { t: T.ptrIn, at: ["xy", 1190, 820], shape: "arrow" },
    { t: T.clickScript - 0.1, at: ["nav", "Script"], shape: "arrow" },
    { t: T.glide + 0.6, at: ["nav-home", "Script"], shape: "arrow" },

    { t: 20.05, at: ["char", 31, -16, 20], shape: "ibeam" },
    { t: T.selStart, at: ["char", 31], shape: "ibeam" },
    { t: T.selStart + T.selDur, at: ["char", 40], shape: "ibeam", ease: "std" },
    { t: 21.3, at: ["char", 40], shape: "ibeam" },
    { t: T.clickItalic - 0.1, at: ["pill", "I"], shape: "arrow" },
    { t: 22.2, at: ["pill", "I"], shape: "arrow" },
    { t: T.clickAway - 0.08, at: ["char", 41, 6, 0], shape: "ibeam" },
    { t: 22.95, at: ["char", 41, 10, 4], shape: "ibeam" },

    { t: T.wake, at: ["xy", 980, 330], shape: "arrow" },
    { t: T.clickSound - 0.1, at: ["nav", "Sound"], shape: "arrow" },
    { t: 27.55, at: ["nav", "Sound"], shape: "arrow" },
    { t: T.clickTrack - 0.1, at: ["soundRow", RT.TRACK_PICK], shape: "arrow" },
    { t: 29.2, at: ["soundRow", RT.TRACK_PICK], shape: "arrow" },
    { t: T.clickLight - 0.1, at: ["switch", "light"], shape: "arrow" },
    { t: 30.9, at: ["switch", "light", -14, 22], shape: "arrow" },

    { t: 33.25, at: ["xy", 860, 940], shape: "arrow" },
    { t: T.clickFirst - 0.1, at: ["pageNav", "first"], shape: "arrow" },
    { t: 34.2, at: ["pageNav", "first"], shape: "arrow" },
    { t: T.clickAuthor - 0.1, at: ["title", "author"], shape: "ibeam" },
    { t: 35.6, at: ["title", "author", 30, 26], shape: "ibeam" },
    { t: T.clickPdf - 0.1, at: ["nav", "PDF"], shape: "arrow" },
    { t: T.clickExport - 0.1, at: ["menu", "export", 38, 8], shape: "arrow" },
    { t: 37.25, at: ["menu", "export", 38, 8], shape: "arrow" },
  ],
  clicks: [
    { t: T.clickScript, target: "nav:Script" },
    { t: T.selStart, target: null },
    { t: T.clickItalic, target: "pill:I" },
    { t: T.clickAway, target: null },
    { t: T.clickSound, target: "nav:Sound" },
    { t: T.clickTrack, target: `row:${RT.TRACK_PICK}` },
    { t: T.clickLight, target: "switch:light" },
    { t: T.clickFirst, target: "pageNav:first" },
    { t: T.clickAuthor, target: null },
    { t: T.clickPdf, target: "nav:PDF" },
    { t: T.clickExport, target: "menu:export" },
  ],
};

// ---------------------------------------------------------------------------
// Control opacity over time: [time, value] pairs, eased between.
// The nav idles at a low opacity while writing, as in the app.
// ---------------------------------------------------------------------------
RT.ALPHA = {
  nav: [[0, 1], [T.navIdle, 1], [T.navIdle + 0.8, 0.2], [T.focusFade, 0.2], [T.focusFade + 1.1, 0.04], [T.wake, 0.04], [T.wake + 0.5, 1], [31.4, 1], [32.3, 0.2], [35.75, 0.2], [36.1, 1], [41.7, 1], [42.5, 0.2]],
  switches: [[0, 0], [5.1, 0], [5.8, 1], [T.focusFade, 1], [T.focusFade + 1.1, 0.22], [T.wake, 0.22], [T.wake + 0.5, 1]],
  bar: [[0, 0], [T.pageIn, 0], [T.pageIn + 0.6, 0.55], [T.focusFade, 0.55], [T.focusFade + 1.1, 0.1], [T.wake, 0.1], [T.wake + 0.5, 0.55], [33.0, 0.55], [33.4, 1], [34.6, 1], [35.2, 0.55]],
  saved: [[0, 0], [T.pageIn, 0], [T.pageIn + 0.6, 0.5], [T.focusFade, 0.5], [T.focusFade + 1.1, 0.12], [T.wake, 0.12], [T.wake + 0.5, 0.5]],
};

// Panels that open and close: [open time, close time].
RT.PANELS = {
  sound: [T.clickSound + 0.05, T.clickLight + 0.02],
  pill: [T.pillIn, T.clickAway + 0.03],
  menu: [T.clickPdf + 0.05, T.clickExport + 0.25],
};

// ---------------------------------------------------------------------------
// Copy. x/y are frame pixels; align is the text anchor.
// ---------------------------------------------------------------------------
RT.COPY = [
  { text: "A space to write.", in: 7.35, out: 10.4, x: 112, y: 520, align: "left", scrim: "left" },
  { text: "Stay in the scene.", in: 11.35, out: 14.55, x: 112, y: 520, align: "left", scrim: "left" },
  { text: "Set your tone.", in: 28.75, out: 33.3, x: 1808, y: 930, align: "right", scrim: "right" },
  { text: "Ready for the next draft.", in: 37.65, out: 40.25, x: 112, y: 150, align: "left", scrim: null },
];

// Key hints during the formatting demo, shown on the left like the copy.
RT.KEYS = [
  { key: "tab", label: "Character", in: T.tab - 0.05, out: T.enter2 - 0.08 },
  { key: "return", label: "Dialogue", in: T.enter2 - 0.05, out: 18.1 },
];
