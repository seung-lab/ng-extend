const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Amy Sterling";
pres.title = "EyeWire II - New Slides";

// Color constants matching existing presentation
const BG = "0A1223";
const CYAN = "4A9EFF";
const TEAL = "00D2FF";
const PURPLE = "CE93D8";
const LIME = "76FF03";
const GOLD = "FFD700";
const GREEN = "4CAF50";
const BLUE = "42A5F5";
const ORANGE = "FF9500";
const WHITE = "FFFFFF";
const DIMMED = "8A9BBF";
const CARD_BG = "111C2E";
const CARD_BORDER = "1A2A45";

// Helper: factory functions to avoid PptxGenJS mutation bug
const cardShadow = () => ({ type: "outer", blur: 8, offset: 2, angle: 135, color: "000000", opacity: 0.3 });
const pipShadow = (color) => ({ type: "outer", blur: 4, offset: 0, angle: 0, color: color, opacity: 0.5 });

// ============================================================
// SLIDE 1: Lightbulb Menu / Seg Dot — Collaborative Proofreading
// ============================================================
const slide1 = pres.addSlide();
slide1.background = { color: BG };

// Slide number
slide1.addText("10", { x: 9.2, y: 5.1, w: 0.6, h: 0.4, fontSize: 11, color: DIMMED, align: "right" });

// Title
slide1.addText("Lightbulb Menu", {
  x: 0.5, y: 0.25, w: 6, h: 0.55, fontSize: 32, fontFace: "Calibri", bold: true, color: CYAN, margin: 0
});
// Accent line under title
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.82, w: 4.5, h: 0.03, fill: { color: CYAN, transparency: 70 }
});
// Subtitle
slide1.addText("Per-segment context menu — the core of collaborative proofreading", {
  x: 0.5, y: 0.9, w: 8, h: 0.35, fontSize: 13, fontFace: "Calibri", color: DIMMED, margin: 0
});

// LEFT COLUMN — How It Works + Integration
// Card: How It Works
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.45, w: 4.3, h: 2.5, fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 },
  shadow: cardShadow()
});
// Left accent bar
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.45, w: 0.06, h: 2.5, fill: { color: CYAN }
});

slide1.addText("How It Works", {
  x: 0.75, y: 1.55, w: 3.8, h: 0.35, fontSize: 16, fontFace: "Calibri", bold: true, color: TEAL, margin: 0
});

slide1.addText([
  { text: "MutationObserver watches neuroglancer's segment list", options: { bullet: true, breakLine: true, fontSize: 12, color: WHITE } },
  { text: "Injects a three-dot button (", options: { breakLine: false, fontSize: 12, color: WHITE } },
  { text: "\u22EF", options: { breakLine: false, fontSize: 12, color: CYAN, bold: true } },
  { text: ") on every segment row", options: { breakLine: true, fontSize: 12, color: WHITE } },
  { text: "Click opens a context menu with 6 action sections", options: { bullet: true, breakLine: true, fontSize: 12, color: WHITE } },
  { text: "Color-coded status pip always visible on each segment", options: { bullet: true, breakLine: true, fontSize: 12, color: WHITE } },
  { text: "Label badge shows cell type inline next to segment ID", options: { bullet: true, breakLine: true, fontSize: 12, color: WHITE } },
  { text: "Custom event system (nge:seg-status-changed) syncs all UI without refetching", options: { bullet: true, fontSize: 12, color: WHITE } },
], { x: 0.75, y: 1.95, w: 3.85, h: 2.0, valign: "top", margin: 0, paraSpaceAfter: 4 });

// Card: System Integration
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 4.1, w: 4.3, h: 1.35, fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 },
  shadow: cardShadow()
});
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 4.1, w: 0.06, h: 1.35, fill: { color: PURPLE }
});
slide1.addText("Connects To", {
  x: 0.75, y: 4.18, w: 3.8, h: 0.3, fontSize: 14, fontFace: "Calibri", bold: true, color: PURPLE, margin: 0
});
slide1.addText([
  { text: "CAVE API", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " (status + cell type persistence)  \u2022  ", options: { color: DIMMED, fontSize: 11 } },
  { text: "Supabase", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " (claims, help requests, edit log)  \u2022  ", options: { color: DIMMED, fontSize: 11 } },
  { text: "Cell Library", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " (claim system)  \u2022  ", options: { color: DIMMED, fontSize: 11 } },
  { text: "Activity Feed", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " + ", options: { color: DIMMED, fontSize: 11 } },
  { text: "Leaderboard", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " (edit tracking)  \u2022  ", options: { color: DIMMED, fontSize: 11 } },
  { text: "Profile", options: { bold: true, color: CYAN, fontSize: 11 } },
  { text: " (cell history, favorites)", options: { color: DIMMED, fontSize: 11 } },
], { x: 0.75, y: 4.5, w: 3.85, h: 0.85, valign: "top", margin: 0 });


// RIGHT COLUMN — Menu Actions (6 sections)
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 5.1, y: 1.45, w: 4.5, h: 4.0, fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 },
  shadow: cardShadow()
});
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 5.1, y: 1.45, w: 0.06, h: 4.0, fill: { color: GOLD }
});

slide1.addText("Menu Actions", {
  x: 5.35, y: 1.55, w: 4.0, h: 0.35, fontSize: 16, fontFace: "Calibri", bold: true, color: GOLD, margin: 0
});

// Status pips row
const pipY = 1.98;
const pipData = [
  { color: "666666", label: "None", x: 5.4 },
  { color: GREEN, label: "Annotated", x: 6.45 },
  { color: BLUE, label: "Complete", x: 7.65 },
  { color: PURPLE, label: "Both", x: 8.65 },
];
pipData.forEach(p => {
  slide1.addShape(pres.shapes.OVAL, {
    x: p.x, y: pipY, w: 0.12, h: 0.12, fill: { color: p.color },
    shadow: pipShadow(p.color)
  });
  slide1.addText(p.label, {
    x: p.x + 0.16, y: pipY - 0.02, w: 0.9, h: 0.16, fontSize: 9, color: DIMMED, margin: 0
  });
});

// Action items
const actions = [
  { icon: "\u2713", iconColor: GREEN, title: "Mark Complete", desc: "Toggle completion status via CAVE API" },
  { icon: "\uD83C\uDFF7", iconColor: BLUE, title: "Cell Type Annotation", desc: "Dropdown presets + free-text, saved to CAVE" },
  { icon: "\uD83C\uDFA8", iconColor: TEAL, title: "Recolor Segment", desc: "9 presets + custom picker, applied to neuroglancer" },
  { icon: "\uD83D\uDD12", iconColor: GOLD, title: "Claim Cell", desc: "Max 5 concurrent claims, golden highlight, 24h expiry" },
  { icon: "\uD83D\uDD0D", iconColor: ORANGE, title: "Ask for Help", desc: "Issue chips + notes, creates help request in Supabase" },
  { icon: "\uD83D\uDD17", iconColor: PURPLE, title: "Change Log", desc: "Link to CAVE progress API for edit history" },
];

let actionY = 2.25;
actions.forEach((a, i) => {
  // Icon circle
  slide1.addShape(pres.shapes.OVAL, {
    x: 5.4, y: actionY, w: 0.3, h: 0.3, fill: { color: a.iconColor, transparency: 80 },
    line: { color: a.iconColor, width: 1 }
  });
  // Title
  slide1.addText(a.title, {
    x: 5.8, y: actionY - 0.02, w: 2.0, h: 0.2, fontSize: 12, bold: true, color: WHITE, margin: 0
  });
  // Description
  slide1.addText(a.desc, {
    x: 5.8, y: actionY + 0.16, w: 3.6, h: 0.2, fontSize: 10, color: DIMMED, margin: 0
  });
  actionY += 0.53;
});

// Files reference at bottom of right card
slide1.addText([
  { text: "button_service.ts", options: { fontSize: 9, color: CYAN, bold: true } },
  { text: "  \u2022  ", options: { fontSize: 9, color: DIMMED } },
  { text: "lightbulb_service.ts", options: { fontSize: 9, color: CYAN, bold: true } },
  { text: "  \u2022  ", options: { fontSize: 9, color: DIMMED } },
  { text: "lightbulb_menu.css", options: { fontSize: 9, color: CYAN, bold: true } },
], { x: 5.35, y: 5.05, w: 4.1, h: 0.25, margin: 0 });


// ============================================================
// SLIDE 2: Design System — Elements & Where They're Used
// ============================================================
const slide2 = pres.addSlide();
slide2.background = { color: BG };

slide2.addText("24", { x: 9.2, y: 5.1, w: 0.6, h: 0.4, fontSize: 11, color: DIMMED, align: "right" });

// Title
slide2.addText("Design System", {
  x: 0.5, y: 0.25, w: 6, h: 0.55, fontSize: 32, fontFace: "Calibri", bold: true, color: CYAN, margin: 0
});
slide2.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.82, w: 4.5, h: 0.03, fill: { color: CYAN, transparency: 70 }
});
slide2.addText("Holographic sci-fi theme — where each element is used across the platform", {
  x: 0.5, y: 0.9, w: 8, h: 0.35, fontSize: 13, fontFace: "Calibri", color: DIMMED, margin: 0
});

// --- Color Palette Row (compact) ---
const paletteY = 1.4;
const swatches = [
  { color: BG, label: "Navy BG", hex: "#0A1223", border: "2A3A55" },
  { color: CYAN, label: "Cyan", hex: "#4A9EFF" },
  { color: TEAL, label: "Teal", hex: "#00D2FF" },
  { color: PURPLE, label: "Purple", hex: "#CE93D8" },
  { color: GREEN, label: "Green", hex: "#4CAF50" },
  { color: GOLD, label: "Gold", hex: "#FFD700" },
  { color: ORANGE, label: "Orange", hex: "#FF9500" },
  { color: BLUE, label: "Blue", hex: "#42A5F5" },
];
const swatchW = 0.95;
const swatchGap = 0.18;
swatches.forEach((s, i) => {
  const sx = 0.5 + i * (swatchW + swatchGap);
  slide2.addShape(pres.shapes.RECTANGLE, {
    x: sx, y: paletteY, w: swatchW, h: 0.45, fill: { color: s.color },
    line: s.border ? { color: s.border, width: 1 } : undefined,
  });
  slide2.addText(s.label, {
    x: sx, y: paletteY + 0.48, w: swatchW, h: 0.18, fontSize: 9, color: WHITE, align: "center", margin: 0
  });
  slide2.addText(s.hex, {
    x: sx, y: paletteY + 0.64, w: swatchW, h: 0.16, fontSize: 8, color: DIMMED, align: "center", margin: 0
  });
});

// --- Design Elements Grid (2x3) ---
const gridStartY = 2.35;
const colW = 4.3;
const rowH = 1.0;
const gapX = 0.4;
const gapY = 0.15;

const elements = [
  {
    title: "Holographic Panels",
    accent: CYAN,
    desc: "Radial-gradient backdrop + blur(12px) + cyan border glow + inset shadow",
    where: "All 26 panels: Cell Library, Profile, Leaderboard, Chat, Admin Hub, etc."
  },
  {
    title: "Achievement Toast & Hero Overlay",
    accent: PURPLE,
    desc: "Full-screen celebration: hex grid, shockwave ring, orbital electrons, scan line, confetti",
    where: "AchievementToast — badge unlocks, milestones, admin-awarded badges"
  },
  {
    title: "Segment Status Pips",
    accent: GREEN,
    desc: "Color-coded glowing dots: gray/green/blue/purple + gold ring for claimed",
    where: "Lightbulb menu — every segment row in the Seg layers panel"
  },
  {
    title: "Particle Grid & Drifting Effects",
    accent: TEAL,
    desc: "6-layer radial-gradient dots drifting via CSS keyframes (25s loop)",
    where: "ModalOverlay — backdrop for all modal panels and dialogs"
  },
  {
    title: "Materialize Entrance",
    accent: GOLD,
    desc: "Scale 0.1\u21921.0 + blur\u2192sharp + brightness flash, cubic-bezier spring",
    where: "SettingsPanel, CommandPalette, Toast notifications, panel opens"
  },
  {
    title: "Confetti & Sparkle Canvas",
    accent: ORANGE,
    desc: "60fps physics: confetti burst (7 palettes, 80+ particles) + sparkle shimmer mode",
    where: "ConfettiCelebration — quest completion, cell completion, badge unlock"
  },
];

elements.forEach((el, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const ex = 0.5 + col * (colW + gapX);
  const ey = gridStartY + row * (rowH + gapY);

  // Card
  slide2.addShape(pres.shapes.RECTANGLE, {
    x: ex, y: ey, w: colW, h: rowH, fill: { color: CARD_BG }, line: { color: CARD_BORDER, width: 1 },
    shadow: cardShadow()
  });
  // Accent bar
  slide2.addShape(pres.shapes.RECTANGLE, {
    x: ex, y: ey, w: 0.06, h: rowH, fill: { color: el.accent }
  });
  // Title
  slide2.addText(el.title, {
    x: ex + 0.2, y: ey + 0.08, w: colW - 0.35, h: 0.22, fontSize: 13, bold: true, color: el.accent, margin: 0
  });
  // Description
  slide2.addText(el.desc, {
    x: ex + 0.2, y: ey + 0.3, w: colW - 0.35, h: 0.28, fontSize: 10, color: WHITE, margin: 0
  });
  // Where used
  slide2.addText(el.where, {
    x: ex + 0.2, y: ey + 0.6, w: colW - 0.35, h: 0.32, fontSize: 9.5, italic: true, color: DIMMED, margin: 0
  });
});

// Bottom row: CSS Restyle files
const cssY = gridStartY + 3 * (rowH + gapY) + 0.05;
slide2.addText("CSS Restyle Layer", {
  x: 0.5, y: cssY, w: 3, h: 0.25, fontSize: 12, bold: true, color: TEAL, margin: 0
});
const cssFiles = [
  { name: "ng-override.css", desc: "Global theme" },
  { name: "render_tab_restyle.css", desc: "Render/Seg controls" },
  { name: "annotations_restyle.css", desc: "Annotation panel" },
  { name: "layer_bar_restyle.css", desc: "Layer bar" },
  { name: "lightbulb_menu.css", desc: "Seg dot menu" },
];
const chipW = 1.68;
cssFiles.forEach((f, i) => {
  const cx = 0.5 + i * (chipW + 0.12);
  slide2.addShape(pres.shapes.RECTANGLE, {
    x: cx, y: cssY + 0.3, w: chipW, h: 0.55, fill: { color: CARD_BG },
    line: { color: CARD_BORDER, width: 1 }
  });
  slide2.addText(f.name, {
    x: cx + 0.08, y: cssY + 0.33, w: chipW - 0.16, h: 0.2, fontSize: 9, bold: true, color: CYAN, margin: 0
  });
  slide2.addText(f.desc, {
    x: cx + 0.08, y: cssY + 0.53, w: chipW - 0.16, h: 0.2, fontSize: 9, color: DIMMED, margin: 0
  });
});

// Write file
pres.writeFile({ fileName: "C:\\Users\\amyle\\ng-extend\\EyeWire-II-New-Slides.pptx" })
  .then(() => console.log("Created EyeWire-II-New-Slides.pptx"))
  .catch(err => console.error("Error:", err));
