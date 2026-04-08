const pptxgen = require("pptxgenjs");
const pres = new pptxgen();

pres.layout = "LAYOUT_16x9";
pres.author = "Amy Esterling";
pres.title = "EyeWire II: Community Neuroscience Platform — Technical Overview";

// ══════════════════════════════════════════════════════════════════
// COLOR PALETTE — Midnight sci-fi matching ng-extend holographic UI
// ══════════════════════════════════════════════════════════════════
const C = {
  bg:       "0A1223",  // dark navy
  bgLight:  "0F1A2E",  // slightly lighter panel
  bgCard:   "111D33",  // card background
  cyan:     "4A9EFF",  // primary accent
  cyanDim:  "2A6BB5",  // dimmer cyan
  teal:     "00D2FF",  // secondary accent
  purple:   "CE93D8",  // purple highlight
  lime:     "76FF03",  // success/green accent
  gold:     "FFD700",  // gold accent
  white:    "FFFFFF",
  textMain: "E0E8F4",  // main body text
  textDim:  "8899B0",  // dimmed/secondary text
  textMid:  "B0C4DE",  // mid-brightness
  coral:    "FF6B6B",  // warning/hot
  magenta:  "FF4081",  // magenta accent
};

// ── Helper factories (fresh objects to avoid pptxgenjs mutation bug) ──
const mkShadow = () => ({ type: "outer", blur: 10, offset: 3, angle: 135, color: "000000", opacity: 0.35 });
const mkGlow   = () => ({ type: "outer", blur: 16, offset: 0, angle: 0, color: C.cyan, opacity: 0.10 });

// ── Reusable slide decoration ──
function addSlideBase(slide, opts = {}) {
  slide.background = { color: C.bg };
  // Top accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.04, fill: { color: C.cyan, transparency: 60 }
  });
  // Bottom accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.585, w: 10, h: 0.04, fill: { color: C.cyan, transparency: 70 }
  });
  if (opts.slideNum) {
    slide.addText(String(opts.slideNum), {
      x: 9.2, y: 5.2, w: 0.6, h: 0.3, fontSize: 9, color: C.textDim, align: "right"
    });
  }
}

function addSectionHeader(slide, sectionTitle, subtitle) {
  addSlideBase(slide);
  // Large glowing left bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.8, w: 0.06, h: 1.8, fill: { color: C.cyan }
  });
  slide.addText(sectionTitle, {
    x: 0.9, y: 1.8, w: 8.5, h: 1.0, fontSize: 36, fontFace: "Calibri",
    color: C.white, bold: true, margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.9, y: 2.8, w: 8.5, h: 0.7, fontSize: 16, fontFace: "Calibri",
      color: C.textDim, margin: 0
    });
  }
}

function addContentSlide(slide, title, slideNum) {
  addSlideBase(slide, { slideNum });
  slide.addText(title, {
    x: 0.5, y: 0.2, w: 9, h: 0.55, fontSize: 22, fontFace: "Calibri",
    color: C.cyan, bold: true, margin: 0
  });
  // Thin separator
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 0.75, w: 4.5, h: 0.02, fill: { color: C.cyan, transparency: 60 }
  });
}

function bulletList(items, opts = {}) {
  return items.map((text, i) => ({
    text,
    options: {
      bullet: true,
      breakLine: i < items.length - 1,
      fontSize: opts.fontSize || 13,
      color: opts.color || C.textMain,
      fontFace: "Calibri",
      paraSpaceAfter: 6,
      ...(opts.indent ? { indentLevel: opts.indent } : {})
    }
  }));
}

function addCard(slide, x, y, w, h, title, bullets, accentColor) {
  const accent = accentColor || C.cyan;
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: C.bgCard },
    line: { color: accent, width: 0.5, transparency: 60 },
    shadow: mkShadow()
  });
  // Left accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.05, h, fill: { color: accent }
  });
  slide.addText(title, {
    x: x + 0.15, y: y + 0.06, w: w - 0.25, h: 0.35,
    fontSize: 12, fontFace: "Calibri", color: accent, bold: true, margin: 0
  });
  slide.addText(bulletList(bullets, { fontSize: 10.5 }), {
    x: x + 0.15, y: y + 0.38, w: w - 0.3, h: h - 0.45, valign: "top", margin: 0
  });
}

let sn = 1; // slide number counter

// ══════════════════════════════════════════════════════════════════
// SLIDE 1: TITLE
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  // Decorative top/bottom bars
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.cyan, transparency: 40 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.565, w: 10, h: 0.06, fill: { color: C.cyan, transparency: 40 } });
  // Subtle side accents
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.06, w: 0.04, h: 5.505, fill: { color: C.cyan, transparency: 75 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 9.96, y: 0.06, w: 0.04, h: 5.505, fill: { color: C.cyan, transparency: 75 } });

  s.addText("EyeWire II", {
    x: 0.5, y: 1.0, w: 9, h: 1.2, fontSize: 52, fontFace: "Calibri",
    color: C.white, bold: true, align: "center", margin: 0
  });
  s.addText("Community Neuroscience Platform", {
    x: 0.5, y: 2.1, w: 9, h: 0.7, fontSize: 24, fontFace: "Calibri",
    color: C.cyan, align: "center", margin: 0
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.95, w: 3, h: 0.02, fill: { color: C.cyan, transparency: 40 }
  });
  s.addText("Technical Overview & Architecture", {
    x: 0.5, y: 3.1, w: 9, h: 0.5, fontSize: 16, fontFace: "Calibri",
    color: C.textMid, align: "center", margin: 0
  });
  s.addText([
    { text: "Vue 3 + Pinia", options: { color: C.purple, fontSize: 12, fontFace: "Calibri" } },
    { text: "  |  ", options: { color: C.textDim, fontSize: 12 } },
    { text: "Supabase", options: { color: C.teal, fontSize: 12, fontFace: "Calibri" } },
    { text: "  |  ", options: { color: C.textDim, fontSize: 12 } },
    { text: "neuroglancer", options: { color: C.lime, fontSize: 12, fontFace: "Calibri" } },
    { text: "  |  ", options: { color: C.textDim, fontSize: 12 } },
    { text: "Chrome Extension", options: { color: C.gold, fontSize: 12, fontFace: "Calibri" } },
  ], { x: 0.5, y: 4.0, w: 9, h: 0.5, align: "center" });
  s.addText("Amy Esterling  •  Seung Lab  •  March 2026", {
    x: 0.5, y: 4.8, w: 9, h: 0.4, fontSize: 11, fontFace: "Calibri",
    color: C.textDim, align: "center"
  });
}

// ══════════════════════════════════════════════════════════════════
// SECTION 1: What is EyeWire II?
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "What is EyeWire II?", "Citizen science meets connectomics");
}

// Slide: Mission & Vision
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Mission & Vision", sn);
  s.addText(bulletList([
    "Citizen science platform for connectomics — mapping neural circuits in the brain",
    "Built as a Chrome Extension wrapping neuroglancer (Google's 3D brain viewer)",
    "Gamified experience: badges, streaks, leaderboards, daily quests, tutorials",
    "Real-time collaboration: chat, help requests, notifications, admin hub",
    "Community of neuroscience enthusiasts contributing to real research"
  ], { fontSize: 14 }), { x: 0.6, y: 1.0, w: 8.8, h: 3.5, valign: "top" });

  // Stats callout row
  addCard(s, 0.5, 4.0, 2.0, 1.2, "200 Badges", ["Building + Exploration tracks"], C.gold);
  addCard(s, 2.7, 4.0, 2.0, 1.2, "3 Tutorials", ["94 steps total"], C.purple);
  addCard(s, 4.9, 4.0, 2.0, 1.2, "26 Components", ["17,855 lines of Vue"], C.teal);
  addCard(s, 7.1, 4.0, 2.4, 1.2, "Real-time", ["Chat, leaderboard, feed"], C.lime);
}

// Slide: Tech Stack
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Technology Stack", sn);
  addCard(s, 0.5, 1.0, 4.3, 1.8, "Frontend", [
    "Vue 3 (Composition API + <script setup>)",
    "Pinia state management (20+ store modules)",
    "TypeScript throughout",
    "esbuild (sub-second builds)"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 1.8, "Backend", [
    "Supabase (Postgres + Realtime + Auth + RLS)",
    "CAVE API (connectomics data service)",
    "Google Sheets (sync for cell library)",
    "GitHub Actions CI/CD"
  ], C.teal);
  addCard(s, 0.5, 3.1, 4.3, 1.8, "Integration", [
    "Chrome Extension manifest v3",
    "neuroglancer viewer API & signals",
    "MutationObserver DOM injection",
    "Teleport for modal overlays"
  ], C.purple);
  addCard(s, 5.2, 3.1, 4.3, 1.8, "Datasets", [
    "pinky100 (current default)",
    "minnie65 (legacy / large scale)",
    "FlyWire Sandbox (Drosophila brain)",
    "stroeh_mouse_retina (tags branch)"
  ], C.lime);
}

// Slide: How It Works
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "How It Works — User Journey", sn);
  const steps = [
    { label: "Install", desc: "Chrome Extension from Web Store", color: C.cyan },
    { label: "Login", desc: "middleauth popup-based auth per server", color: C.teal },
    { label: "Tutorial", desc: "3 guided tutorials (Nurro mascot)", color: C.purple },
    { label: "Explore", desc: "Navigate 3D brain, claim cells", color: C.lime },
    { label: "Proofread", desc: "Merge/cut segments, fix errors", color: C.gold },
    { label: "Earn", desc: "Badges, streaks, leaderboard", color: C.magenta },
  ];
  steps.forEach((st, i) => {
    const x = 0.5 + i * 1.55;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.2, w: 1.4, h: 3.8,
      fill: { color: C.bgCard },
      line: { color: st.color, width: 0.5, transparency: 50 },
      shadow: mkShadow()
    });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.2, w: 1.4, h: 0.04, fill: { color: st.color } });
    s.addText(String(i + 1), {
      x, y: 1.4, w: 1.4, h: 0.6, fontSize: 28, fontFace: "Calibri",
      color: st.color, bold: true, align: "center", margin: 0
    });
    s.addText(st.label, {
      x, y: 2.1, w: 1.4, h: 0.4, fontSize: 14, fontFace: "Calibri",
      color: C.white, bold: true, align: "center", margin: 0
    });
    s.addText(st.desc, {
      x: x + 0.08, y: 2.6, w: 1.24, h: 1.5, fontSize: 10, fontFace: "Calibri",
      color: C.textDim, align: "center", valign: "top", margin: 0
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// SECTION 2: System Architecture
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "System Architecture", "Chrome Extension → neuroglancer → Vue 3 → Supabase → CAVE");
}

// Slide: Architecture Diagram
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Architecture Overview", sn);
  const layers = [
    { label: "Chrome Extension (manifest v3)", y: 0.95, color: C.gold, desc: "Content script injects into neuroglancer page" },
    { label: "neuroglancer Core", y: 1.7, color: C.lime, desc: "3D viewer, segmentation, layers, signals, tools" },
    { label: "Vue 3 Overlay Layer", y: 2.45, color: C.cyan, desc: "26 components, Teleport modals, MutationObserver injection" },
    { label: "Pinia State (20+ modules)", y: 3.2, color: C.purple, desc: "auth, cells, badges, chat, leaderboard, quests, notifications..." },
    { label: "Supabase + CAVE API", y: 3.95, color: C.teal, desc: "Postgres, Realtime, RLS, CAVE proofreading + segmentation" },
  ];
  layers.forEach(l => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: l.y, w: 5.5, h: 0.6,
      fill: { color: C.bgCard },
      line: { color: l.color, width: 1 },
      shadow: mkShadow()
    });
    s.addText(l.label, {
      x: 0.7, y: l.y + 0.05, w: 5.1, h: 0.3,
      fontSize: 12, fontFace: "Calibri", color: l.color, bold: true, margin: 0
    });
    s.addText(l.desc, {
      x: 0.7, y: l.y + 0.32, w: 5.1, h: 0.25,
      fontSize: 9, fontFace: "Calibri", color: C.textDim, margin: 0
    });
  });
  // Right side: data flow
  s.addText("Data Flow", {
    x: 6.5, y: 0.9, w: 3, h: 0.4, fontSize: 14, fontFace: "Calibri",
    color: C.cyan, bold: true, margin: 0
  });
  s.addText(bulletList([
    "ExtensionBar merges with neuroglancer top bar",
    "MutationObserver injects Vue buttons",
    "AnnotationPanel floats as overlay",
    "Pinia stores sync with Supabase Realtime",
    "CAVE API for segment operations",
    "Google Sheets sync for cell library",
    "esbuild compile-time CONFIG defines"
  ], { fontSize: 10 }), { x: 6.5, y: 1.3, w: 3.2, h: 3.5, valign: "top" });
}

// Slide: Auth & Build
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Auth, Build & Deploy", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.0, "Authentication", [
    "Multi-server middleauth (popup-based)",
    "LoginModal with aggressive retry (0.5s–12s intervals)",
    "Token stored per-server, auto-refresh",
    "Admin detection via email allowlist in Supabase"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.0, "Build System", [
    "esbuild with compile-time defines",
    "CONFIG, STATE_SERVERS, DATASETS injected",
    "CUSTOM_BINDINGS for keybindings",
    "Sub-second builds, ~3s type check"
  ], C.purple);
  addCard(s, 0.5, 3.3, 4.3, 1.8, "Deployment — CI/CD", [
    "GitHub Actions: push to non-master → App Engine",
    "GitHub Pages: manual deploy for stable builds",
    "Weekly Recap: cron job via GitHub Actions",
    "Two remotes: amy (fork) + origin (seung-lab)"
  ], C.teal);
  addCard(s, 5.2, 3.3, 4.3, 1.8, "Extension Architecture", [
    "manifest v3 Chrome Extension",
    "Content script injected on neuroglancer URLs",
    "5 CSS restyle files override neuroglancer UI",
    "18 TypeScript widget/service files"
  ], C.lime);
}

// ══════════════════════════════════════════════════════════════════
// SECTION 3: Database Schema
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "Database Schema", "Supabase Postgres + Row Level Security + Realtime");
}

// Slide: Core Tables
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Core Database Tables", sn);
  const tables = [
    { name: "users", desc: "Profile, display name, avatar, streak data", color: C.cyan },
    { name: "proofreading_tasks", desc: "Cells to proofread: segment IDs, status, coordinates", color: C.teal },
    { name: "task_assignments", desc: "User↔task claims, max 3 concurrent, auto-expiry", color: C.purple },
    { name: "edit_log", desc: "Every merge/cut operation, timestamps, segment pairs", color: C.lime },
    { name: "activity_feed", desc: "Public feed of completions, streaks, badges earned", color: C.gold },
    { name: "help_requests", desc: "Issue reports with type, note, annotation links", color: C.coral },
    { name: "segment_tags", desc: "8 tag types per segment, spreadsheet import", color: C.magenta },
  ];
  tables.forEach((t, i) => {
    const y = 1.0 + i * 0.6;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.5,
      fill: { color: C.bgCard },
      line: { color: t.color, width: 0.5, transparency: 60 }
    });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y, w: 0.05, h: 0.5, fill: { color: t.color } });
    s.addText(t.name, {
      x: 0.7, y, w: 2.5, h: 0.5, fontSize: 12, fontFace: "Consolas",
      color: t.color, bold: true, valign: "middle", margin: 0
    });
    s.addText(t.desc, {
      x: 3.3, y, w: 6, h: 0.5, fontSize: 11, fontFace: "Calibri",
      color: C.textMain, valign: "middle", margin: 0
    });
  });
}

// Slide: Admin & Integration Tables
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Admin & Integration Tables", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.3, "Admin Tables", [
    "admins — email allowlist for admin access",
    "user_groups + user_group_members — targeting",
    "notifications + notification_reads — feed system",
    "special_badges + special_badge_awards — custom badges"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.3, "CAVE Integration", [
    "cell_status — external CAVE proofreading state",
    "cell_type — neuron classification from CAVE API",
    "Real-time sync via periodic polling",
    "Dual write-back: Google Sheets + Supabase"
  ], C.teal);
  addCard(s, 0.5, 3.6, 9, 1.5, "Security & Features", [
    "Row Level Security (RLS) on all tables — users see only their own data unless admin",
    "Realtime subscriptions for chat, activity feed, notifications, leaderboard",
    "pg_cron for auto-expiry of stale task assignments (24h timeout)",
    "Supabase Edge Functions for complex operations (weekly recap, badge awards)"
  ], C.purple);
}

// ══════════════════════════════════════════════════════════════════
// SECTION 4: Feature Deep Dives
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "Feature Deep Dives", "15 major features powering the platform");
}

// Feature 1: Gamification
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Gamification System", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.0, "200 Badges", [
    "100 Building track (merges, edits, cells)",
    "100 Exploration track (navigation, layers, tools)",
    "Progressive tiers: 5→10→25→50→100 thresholds",
    "Stored in localStorage per badge slug"
  ], C.gold);
  addCard(s, 5.2, 1.0, 4.3, 2.0, "AchievementToast", [
    "Hero overlay: full-screen celebration",
    "Hex grid background + shockwave ring",
    "Confetti particle system (canvas)",
    "3-second auto-dismiss with animations"
  ], C.magenta);
  addCard(s, 0.5, 3.3, 4.3, 1.8, "Trophy Case", [
    "Overview: 2 rows of 8 badges + 'View All' tile",
    "Full grid with 350px featured badge banner",
    "Favorite badge (star icon, localStorage)",
    "Wide layout: 85vw, max 1200px"
  ], C.purple);
  addCard(s, 5.2, 3.3, 4.3, 1.8, "Streak System", [
    "Daily streak tracking (consecutive days)",
    "Streak counter in profile panel",
    "Activity feed announcements",
    "Badge milestones for streak length"
  ], C.teal);
}

// Feature 2: Tutorial System
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Tutorial System", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.2, "3 Multi-Step Tutorials", [
    "Tutorial 1: Getting Started (26 steps)",
    "Tutorial 2: Advanced Interface (33 steps)",
    "Tutorial 3: Proofreading (35 steps)",
    "94 total guided steps with state URL restoration"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.2, "Nurro Mascot", [
    "Animated character guides each step",
    "Speech bubbles with rich HTML content",
    "4 position types: MIDDLE, OVER_2D, OVER_3D, relative",
    "onEnter hooks for state setup"
  ], C.purple);
  addCard(s, 0.5, 3.5, 9, 1.6, "Tutorial Engine Features", [
    "State URL restoration: each step can set neuroglancer viewer state",
    "onEnter hooks: programmatic setup (e.g., change annotation color, select layers)",
    "Element targeting: highlight specific UI elements with pulsing glow",
    "Progress persistence in localStorage, badge award on completion"
  ], C.teal);
}

// Feature 3: Cell Library
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Cell Library", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.5, "6 Tabs", [
    "My Cells — assigned to current user",
    "All — full cell database",
    "Available — unclaimed cells",
    "Claimed — in-progress by anyone",
    "Completed — finished proofreading",
    "Help — open help requests"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.5, "Claim System", [
    "Max 3 concurrent claims per user",
    "24-hour auto-expiry via pg_cron",
    "Navigate to cell, claim, proofread, complete",
    "Google Sheets sync (dual write-back)",
    "Cell status tracked in Supabase + CAVE"
  ], C.teal);
  s.addText(bulletList([
    "Sorting, filtering, search across all tabs",
    "Cell favorites and nicknames in user profile",
    "Help request creation with '+' button and inline form"
  ], { fontSize: 11 }), { x: 0.6, y: 3.8, w: 8.8, h: 1.2, valign: "top" });
}

// Feature 4: Brain Quest
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Brain Quest — Daily Quests", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.5, "How It Works", [
    "3 neurons per day, date-seeded selection",
    "Google Sheets CSV as quest database",
    "Navigate → Claim → Complete workflow",
    "New quests every day at midnight",
    "Streak bonuses for consecutive completion"
  ], C.gold);
  addCard(s, 5.2, 1.0, 4.3, 2.5, "Technical Details", [
    "Date seed: hash(YYYY-MM-DD) → deterministic pick",
    "CSV parsed client-side from Google Sheets URL",
    "Quest state persisted in localStorage",
    "Integration with cell claim system",
    "Badge awards for quest streaks"
  ], C.cyan);
}

// Feature 5: Merge & Cut Tools
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Merge & Cut Tools", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.2, "SplitMergeOverlay", [
    "Bottom banner UI for active operations",
    "Red/blue point system for cuts",
    "Segment pair selection for merges",
    "Undo/redo support for all operations"
  ], C.coral);
  addCard(s, 5.2, 1.0, 4.3, 2.2, "Merge Operations", [
    "Select two segments to join",
    "CAVE API submission for persistence",
    "Visual: holographic beam animation",
    "Edit log tracking in Supabase"
  ], C.cyan);
  addCard(s, 0.5, 3.5, 9, 1.6, "Cut Operations (Split)", [
    "Place red points (segment A side) and blue points (segment B side)",
    "Supervoxel-level precision using CAVE's split endpoint",
    "Real-time visual feedback with colored markers in 3D viewer",
    "Undo reverses the operation in CAVE, redo reapplies"
  ], C.teal);
}

// Feature 6: Command Palette
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Command Palette (Ctrl+K)", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.8, "Features", [
    "Fuzzy search across all commands",
    "Merge tool, Cut tool, Undo shortcuts",
    "Help & Learning section",
    "Video guides, forum links",
    "Alias matching for natural queries",
    "Keyboard-first navigation"
  ], C.purple);
  addCard(s, 5.2, 1.0, 4.3, 2.8, "Command Categories", [
    "Tools: Merge, Cut, Undo/Redo",
    "Navigation: Jump to cell, coordinates",
    "Help: Guide, tutorials, forum",
    "Videos: Tutorial walkthroughs",
    "Settings: Keybindings, preferences",
    "Triggered via Ctrl+K or toolbar icon"
  ], C.cyan);
}

// Feature 7: Real-time Chat
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Real-time Chat", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.2, "Chat System", [
    "Supabase Realtime broadcast channel",
    "Draggable & resizable floating panel",
    "Markdown rendering for messages",
    "Collapsed state with unread indicator"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.2, "Features", [
    "Real-time message delivery (< 100ms)",
    "User display names + avatar icons",
    "Admin can post notifications → chat",
    "Message history persistence"
  ], C.teal);
}

// Feature 8: Leaderboard
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Leaderboard", sn);
  addCard(s, 0.5, 1.0, 5.5, 2.0, "Rankings", [
    "Daily / Weekly / All-time timeframes",
    "Medal display: gold, silver, bronze",
    "Score based on edit count + cell completions",
    "Real-time updates via Supabase subscriptions"
  ], C.gold);
  addCard(s, 6.3, 1.0, 3.2, 2.0, "Interaction", [
    "Click username → profile preview",
    "Planned: full profile panel on click",
    "Avatar + badge showcase"
  ], C.cyan);
}

// Feature 9: User Profiles
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "User Profiles", sn);
  addCard(s, 0.5, 1.0, 2.8, 3.0, "Left Column", [
    "Username + avatar",
    "Total edits count",
    "Cells completed",
    "Current streak",
    "14-day activity chart"
  ], C.cyan);
  addCard(s, 3.5, 1.0, 3.0, 3.0, "Center Column", [
    "Badge overview (2 rows)",
    "Building + Exploration tracks",
    "'View All' tile → Trophy Case",
    "Countdown to next badge"
  ], C.purple);
  addCard(s, 6.7, 1.0, 2.8, 3.0, "Right Column", [
    "Featured badge (350px)",
    "Favorite badge with star",
    "Current streak visualization",
    "Cell history w/ favorites"
  ], C.gold);
  s.addText(bulletList([
    "Trophy Case: wide layout (85vw), featured badge banner, favorite mechanic with localStorage persistence",
    "Cell history with favorite/nickname support, holographic sci-fi theme throughout"
  ], { fontSize: 11 }), { x: 0.6, y: 4.2, w: 8.8, h: 1.0, valign: "top" });
}

// Feature 10: Notifications
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Notification System", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.5, "Admin-Created Notifications", [
    "Targeting: all users, specific groups, or individual",
    "Scheduling: immediate or future delivery",
    "Post-to-chat option for broadcast",
    "Rich content: title, body, optional image",
    "Dismissible feed with individual × buttons"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.5, "Feed Panel", [
    "Bell icon in toolbar with unread count",
    "Chronological notification list",
    "Help response alerts highlighted",
    "Admin: delete button (trash icon)",
    "User: dismiss button (× icon)"
  ], C.teal);
  s.addText(bulletList([
    "Weekly Recap: 'Your Week In Science' auto-generated via GitHub Actions cron job with personalized stats"
  ], { fontSize: 11, color: C.gold }), { x: 0.6, y: 3.8, w: 8.8, h: 0.6 });
}

// Feature 11: Help Requests
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Help Request System", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.5, "Creating Help Requests", [
    "From Cell Library or AnnotationPanel",
    "Pink '+' button in Help tab",
    "Issue types: Extension Bug, Merge Issue, Black Spill, Doublecheck",
    "Auto-detects selected segment"
  ], C.coral);
  addCard(s, 5.2, 1.0, 4.3, 2.5, "Response Workflow", [
    "Admin receives in help queue",
    "Response with annotation links",
    "User notified of resolution",
    "Status tracking: open → resolved",
    "Linked to specific cells/segments"
  ], C.cyan);
}

// Feature 12: Admin Hub
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Admin Hub", sn);
  addCard(s, 0.5, 1.0, 2.8, 3.5, "Notifications", [
    "Create/edit/delete",
    "Target users or groups",
    "Schedule delivery",
    "Post to chat option",
    "Image attachments"
  ], C.cyan);
  addCard(s, 3.5, 1.0, 3.0, 3.5, "Groups", [
    "Create user groups",
    "Add/remove members",
    "Targeted notifications",
    "Group-based content",
    "Role management"
  ], C.purple);
  addCard(s, 6.7, 1.0, 2.8, 3.5, "Special Badges", [
    "Custom badge creation",
    "Award to any user",
    "Custom images/icons",
    "Event-specific badges",
    "Admin-only visibility"
  ], C.gold);
  s.addText("Admin detection via email allowlist in Supabase admins table", {
    x: 0.6, y: 4.7, w: 8.8, h: 0.4, fontSize: 11, fontFace: "Calibri",
    color: C.textDim, italic: true
  });
}

// Feature 13: Weekly Recap
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Weekly Recap", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.5, "'Your Week in Science'", [
    "Auto-notification via GitHub Actions cron",
    "Personalized stats per user",
    "Edits count, cells completed, streak",
    "Badges earned that week",
    "scripts/weekly-recap.mjs"
  ], C.teal);
  addCard(s, 5.2, 1.0, 4.3, 2.5, "Technical Implementation", [
    "Supabase Service Role Key in GitHub Secrets",
    "Queries edit_log + task_assignments per user",
    "Generates notification per active user",
    "Scheduled: Sunday evening delivery",
    "Fallback: manual trigger via Actions UI"
  ], C.cyan);
}

// Feature 14: Segment Tagging
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Segment Tagging", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.0, "Tag System", [
    "8 known tag categories",
    "Supabase persistence per segment",
    "Spreadsheet import for bulk tagging",
    "Tags branch: eyewire-ii-tags"
  ], C.lime);
  addCard(s, 5.2, 1.0, 4.3, 2.0, "Tags Dataset", [
    "stroeh_mouse_retina dataset",
    "22,686 segments imported from Google Sheet",
    "Dedicated worktree + deploy",
    "Separate GitHub Pages deployment"
  ], C.purple);
}

// ══════════════════════════════════════════════════════════════════
// SECTION 5: Visual Design
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "Visual Design", "Holographic sci-fi theme — dark navy, cyan glow, particle effects");
}

// Slide: Design System
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Holographic Design System", sn);
  // Color swatches
  const swatches = [
    { label: "Dark Navy", hex: "0A1223", textC: C.textMain },
    { label: "Cyan Accent", hex: "4A9EFF", textC: C.white },
    { label: "Teal", hex: "00D2FF", textC: C.bg },
    { label: "Purple", hex: "CE93D8", textC: C.bg },
    { label: "Lime", hex: "76FF03", textC: C.bg },
    { label: "Gold", hex: "FFD700", textC: C.bg },
  ];
  swatches.forEach((sw, i) => {
    const x = 0.5 + i * 1.5;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.0, w: 1.3, h: 0.8, fill: { color: sw.hex },
      line: { color: C.cyan, width: 0.3, transparency: 70 },
      shadow: mkShadow()
    });
    s.addText(sw.label, {
      x, y: 1.82, w: 1.3, h: 0.3, fontSize: 9, fontFace: "Calibri",
      color: C.textMain, align: "center", margin: 0
    });
    s.addText("#" + sw.hex, {
      x, y: 2.08, w: 1.3, h: 0.25, fontSize: 8, fontFace: "Consolas",
      color: C.textDim, align: "center", margin: 0
    });
  });
  addCard(s, 0.5, 2.5, 4.3, 2.5, "Effects & Animations", [
    "Radial-gradient backdrop with blur/saturate",
    "Drifting particle grid (CSS keyframes)",
    "Multi-layer glow (box-shadow + inset)",
    "Materialize entrance animations",
    "Spinning rings on loading states",
    "Breathing glow on interactive elements"
  ], C.cyan);
  addCard(s, 5.2, 2.5, 4.3, 2.5, "CSS Restyle Files", [
    "ng-override.css — global neuroglancer overrides",
    "render_tab_restyle.css — Render/Seg tab controls",
    "annotation_restyle.css — annotation panel styling",
    "layer_bar_restyle.css — layer bar appearance",
    "side_panel_restyle.css — side panel dimensions"
  ], C.purple);
}

// ══════════════════════════════════════════════════════════════════
// SECTION 6: Vue Components & Stores
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "Vue Components & Stores", "26 components, 20+ Pinia stores, 17,855 lines");
}

// Slide: Components
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Vue 3 Components (26 total)", sn);

  const cols = [
    {
      title: "Core UI",
      items: ["ExtensionBar — top toolbar", "LoginModal — auth flow", "AnnotationPanel — floating overlay",
              "ModalOverlay — holographic backdrop", "Overlay — base container"],
      color: C.cyan
    },
    {
      title: "Features",
      items: ["CellLibraryPanel — 6-tab cell mgmt", "BrainQuestPanel — daily quests",
              "SplitMergeOverlay — merge/cut tools", "ChatPanel — real-time chat",
              "CommandPalette — Ctrl+K search"],
      color: C.teal
    },
    {
      title: "Social & Admin",
      items: ["UserProfilePanel — profile + trophies", "LeaderboardPanel — rankings",
              "NotificationFeedPanel — feed", "AdminHubPanel — admin tools",
              "AchievementToast — badge celebration"],
      color: C.purple
    },
  ];
  cols.forEach((col, i) => {
    const x = 0.5 + i * 3.1;
    addCard(s, x, 1.0, 2.9, 3.5, col.title, col.items, col.color);
  });
  s.addText("+ TutorialOverlay, HelpRequestPanel, SegmentTagPanel, SettingsPanel, and more...", {
    x: 0.6, y: 4.7, w: 8.8, h: 0.4, fontSize: 10, fontFace: "Calibri", color: C.textDim, italic: true
  });
}

// Slide: Stores
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Pinia State Management (20+ Modules)", sn);
  const stores = [
    { name: "useAuthStore", desc: "Login state, tokens, user identity", color: C.cyan },
    { name: "useCellStore", desc: "Cell library, claims, completions", color: C.teal },
    { name: "useBadgeStore", desc: "200 badge definitions, earned state", color: C.gold },
    { name: "useChatStore", desc: "Real-time messages, unread count", color: C.purple },
    { name: "useLeaderboardStore", desc: "Rankings, timeframe selection", color: C.lime },
    { name: "useNotificationStore", desc: "Feed, reads, admin CRUD", color: C.coral },
    { name: "useQuestStore", desc: "Daily brain quests, progress", color: C.magenta },
    { name: "useEditStore", desc: "Merge/cut operations, undo stack", color: C.cyan },
  ];
  stores.forEach((st, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 4.7;
    const y = 1.0 + row * 0.85;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 4.5, h: 0.7,
      fill: { color: C.bgCard },
      line: { color: st.color, width: 0.5, transparency: 60 }
    });
    s.addText(st.name, {
      x: x + 0.15, y, w: 2.0, h: 0.7, fontSize: 10, fontFace: "Consolas",
      color: st.color, bold: true, valign: "middle", margin: 0
    });
    s.addText(st.desc, {
      x: x + 2.2, y, w: 2.1, h: 0.7, fontSize: 10, fontFace: "Calibri",
      color: C.textMain, valign: "middle", margin: 0
    });
  });
  s.addText("Key Patterns: Teleport for modals, MutationObserver for injection, Signal-based neuroglancer reactivity", {
    x: 0.6, y: 4.7, w: 8.8, h: 0.4, fontSize: 10, fontFace: "Calibri", color: C.textDim, italic: true
  });
}

// ══════════════════════════════════════════════════════════════════
// SECTION 7: Neuroglancer Integration
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "Neuroglancer Integration", "Viewer API, signals, layers, segments, custom tools");
}

// Slide: Viewer API
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Neuroglancer Viewer API", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.2, "Core APIs", [
    "Navigation: position, zoom, orientation",
    "Layers: add/remove/modify data layers",
    "Segmentation: select, color, hide segments",
    "Tools: register custom tools in toolbar"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.2, "Signal-based Reactivity", [
    "NOT DOM events — neuroglancer uses Signals",
    "viewer.layerManager.layersChanged.add(cb)",
    "Segment selection: selectedAlpha.changed",
    "Navigation: position.changed, crossSection"
  ], C.lime);
  addCard(s, 0.5, 3.5, 9, 1.6, "Extension Points", [
    "Custom keybindings: esbuild CUSTOM_BINDINGS define, merged at build time",
    "Uint64 segment IDs: SharedDisjointUint64Sets for merge/equivalence tracking",
    "Side panels: register custom Vue panels in neuroglancer's panel system",
    "Overlay injection: MutationObserver watches for neuroglancer DOM, injects Vue components"
  ], C.purple);
}

// Slide: CSS Integration
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "Neuroglancer CSS Overrides", sn);
  const files = [
    { name: "ng-override.css", desc: "Global overrides: font sizes, panel dimensions, scrollbars, dark theme enforcement", lines: "~200 lines" },
    { name: "render_tab_restyle.css", desc: "Render/Seg tab: control labels, inputs, dropdowns, section headers, scale legend", lines: "~150 lines" },
    { name: "annotation_restyle.css", desc: "Annotation panel: header, color picker, point list, toolbar buttons", lines: "~180 lines" },
    { name: "layer_bar_restyle.css", desc: "Layer bar: layer names, visibility toggles, drag handles, selection state", lines: "~120 lines" },
    { name: "side_panel_restyle.css", desc: "Side panel: width, tab headers, content area, scroll behavior", lines: "~100 lines" },
  ];
  files.forEach((f, i) => {
    const y = 1.0 + i * 0.8;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.65,
      fill: { color: C.bgCard },
      line: { color: C.purple, width: 0.3, transparency: 70 }
    });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y, w: 0.04, h: 0.65, fill: { color: C.purple } });
    s.addText(f.name, {
      x: 0.7, y, w: 2.5, h: 0.35, fontSize: 11, fontFace: "Consolas",
      color: C.purple, bold: true, valign: "middle", margin: 0
    });
    s.addText(f.lines, {
      x: 0.7, y: y + 0.32, w: 2.5, h: 0.3, fontSize: 9, fontFace: "Calibri",
      color: C.textDim, valign: "middle", margin: 0
    });
    s.addText(f.desc, {
      x: 3.3, y, w: 6, h: 0.65, fontSize: 10.5, fontFace: "Calibri",
      color: C.textMain, valign: "middle", margin: 0
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// SECTION 8: Stats & Closing
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addSectionHeader(s, "By the Numbers", "Platform statistics and what's next");
}

// Stats slide
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "EyeWire II — By the Numbers", sn);
  const stats = [
    { num: "26", label: "Vue Components", sub: "17,855 lines", color: C.cyan },
    { num: "200", label: "Badges", sub: "Building + Exploration", color: C.gold },
    { num: "94", label: "Tutorial Steps", sub: "3 guided tutorials", color: C.purple },
    { num: "20+", label: "Pinia Stores", sub: "State management", color: C.teal },
    { num: "7+", label: "DB Tables", sub: "Supabase + CAVE", color: C.lime },
    { num: "18", label: "Widget Services", sub: "TypeScript utilities", color: C.magenta },
    { num: "5", label: "CSS Restyles", sub: "neuroglancer overrides", color: C.coral },
    { num: "2", label: "CI/CD Workflows", sub: "App Engine + Pages", color: C.cyan },
  ];
  stats.forEach((st, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.5 + col * 2.35;
    const y = 1.0 + row * 2.0;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 2.15, h: 1.7,
      fill: { color: C.bgCard },
      line: { color: st.color, width: 0.5, transparency: 50 },
      shadow: mkShadow()
    });
    s.addText(st.num, {
      x, y: y + 0.15, w: 2.15, h: 0.6, fontSize: 36, fontFace: "Calibri",
      color: st.color, bold: true, align: "center", margin: 0
    });
    s.addText(st.label, {
      x, y: y + 0.75, w: 2.15, h: 0.35, fontSize: 12, fontFace: "Calibri",
      color: C.white, bold: true, align: "center", margin: 0
    });
    s.addText(st.sub, {
      x, y: y + 1.1, w: 2.15, h: 0.3, fontSize: 10, fontFace: "Calibri",
      color: C.textDim, align: "center", margin: 0
    });
  });
}

// What's Next slide
{
  const s = pres.addSlide(); sn++;
  addContentSlide(s, "What's Next", sn);
  addCard(s, 0.5, 1.0, 4.3, 2.0, "Planned Features", [
    "Leaderboard → Full profile on click",
    "Batch Processor for segment groups",
    "Profile: Recent Cells thumbnail gallery",
    "Admin image storage migration"
  ], C.cyan);
  addCard(s, 5.2, 1.0, 4.3, 2.0, "Infrastructure", [
    "Rotate Google Cloud credentials",
    "Base64-in-DB for small badge images",
    "Performance optimization pass",
    "Mobile-responsive considerations"
  ], C.teal);
  s.addText(bulletList([
    "Feature freeze in effect — stabilization and presentation mode",
    "All 15 major features deployed and operational on App Engine + GitHub Pages"
  ], { fontSize: 12, color: C.gold }), { x: 0.6, y: 3.4, w: 8.8, h: 1.0 });
}

// Closing slide
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.cyan, transparency: 40 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.565, w: 10, h: 0.06, fill: { color: C.cyan, transparency: 40 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.06, w: 0.04, h: 5.505, fill: { color: C.cyan, transparency: 75 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 9.96, y: 0.06, w: 0.04, h: 5.505, fill: { color: C.cyan, transparency: 75 } });

  s.addText("Thank You", {
    x: 0.5, y: 1.4, w: 9, h: 1.0, fontSize: 48, fontFace: "Calibri",
    color: C.white, bold: true, align: "center", margin: 0
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.5, w: 3, h: 0.02, fill: { color: C.cyan, transparency: 40 }
  });
  s.addText("EyeWire II: Community Neuroscience Platform", {
    x: 0.5, y: 2.7, w: 9, h: 0.5, fontSize: 18, fontFace: "Calibri",
    color: C.cyan, align: "center"
  });
  s.addText([
    { text: "Amy Esterling", options: { fontSize: 14, color: C.textMain, fontFace: "Calibri", breakLine: true } },
    { text: "Seung Lab  •  Princeton University", options: { fontSize: 12, color: C.textDim, fontFace: "Calibri", breakLine: true } },
    { text: "github.com/seung-lab/ng-extend", options: { fontSize: 11, color: C.cyanDim, fontFace: "Calibri" } },
  ], { x: 0.5, y: 3.4, w: 9, h: 1.5, align: "center" });
}

// ── Write file ──
const outPath = "C:\\Users\\amyle\\ng-extend\\EyeWire-II-Technical-Overview.pptx";
pres.writeFile({ fileName: outPath }).then(() => {
  console.log("Presentation saved to: " + outPath);
  console.log("Total slides: " + pres.slides.length);
}).catch(err => {
  console.error("Error:", err);
});
