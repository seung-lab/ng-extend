/**
 * badge_definitions.ts
 * Eyewire II — Badge catalogue for the community branch.
 *
 * Two tracks:
 *   - Building (100 badges) — earned via edits. Ames 2026-10-11: 1, 10, 25, 50,
 *     100, every 100 to 500, 750, 1,000, every 500 to 5,000, every 1,000 to
 *     10,000, every 2,000 to 20,000, every 5,000 to 100,000, every 10,000 to
 *     650,000. (Before: uneven steps to 1,000,000.)
 *   - Exploration (100 badges) — earned via cells completed. Round numbers
 *     (Ames 2026-10-11; the old cubic curve gave tiers like 1,797): 1, 5, 10,
 *     15, 20, 30, 40, 50, 75, 100, 125, 150, every 50 to 500, every 100 to
 *     2,000, every 250 to 5,000, every 500 to 10,000, every 1,000 to 54,000.
 *     Several tiers moved UP in that change. Nobody loses one: what each
 *     player held was saved to badge_awards first
 *     (supabase-cell-tiers-save-held.sql), and a saved Achievement counts as
 *     earned everywhere, whatever its number is now. Keep it that way: never
 *     decide "earned" from the count alone.
 *
 * Kept by hand. It began as output of gen_badge_defs.py (amyleesterling/badges)
 * but has not been generated since the Loyalty track and the 2026-10-11 tiers;
 * that script is retired and must not be run over this file.
 * Descriptions (Ames and Celia, 2026-10-21): jokes, written and edited on the
 * review page https://claude.ai/artifact/QohCgVUUsdJ4zMPLzjH7LH and copied in
 * from there. Edit them there first, then copy them here, so the two agree.
 * After changing a name or a threshold: node scripts/build-achievement-thresholds.js
 *
 * Interneuron quests (Ames 2026-10-28, art to come): onClaimMilestone in
 * src/util/claim_time.ts hears each hour milestone a claim passes (10, 25, 50
 * and 100 hours, recorded on the server in claim_active_time.milestones) and
 * each finished quest. Award from there, or from those rows server side.
 */

/**
 * HARD RULE (Ames 2026-10-07): achievements count ONLY what a player did in
 * this game. A cell completed in another tool, or recorded on a legacy
 * dataset's own tables (BANC, FlyWire, MICrONS), never counts toward an
 * achievement, a profile total or the leaderboard. The numbers these
 * thresholds are checked against (users.total_edits, users.cells_completed,
 * users.total_days) are moved only by the server, from the game's own log
 * (ew_log_activity and the view ew_cell_completions). Never feed a track from
 * a CAVE table or from cave_completions_mirror.
 */
export type BadgeTrack = 'building' | 'exploration' | 'loyalty';

export interface BadgeDefinition {
  /** Unique badge ID: building badges 1–100, exploration badges 101–200. */
  id: number;
  /** Which track this badge belongs to. */
  track: BadgeTrack;
  /** Sequence within the track (1–100). */
  sequence: number;
  /** URL-friendly slug (used as image key). */
  slug: string;
  /** Short code (2–3 letters). */
  code: string;
  name: string;
  description: string;
  /**
   * Key used to look up the image in BADGE_IMAGE_MAP.
   * Format: 'building/<slug>' or 'exploration/<slug>'.
   */
  imageKey: string;
  /**
   * Number of all-time edits (building) or cells completed (exploration)
   * required to earn this badge.
   */
  threshold: number;
  /**
   * @deprecated Alias for threshold. Kept for backward compatibility.
   */
  editThreshold: number;
}

export const BUILDING_BADGES: BadgeDefinition[] = [
  { id: 1001, track: 'building', sequence: 1, slug: 'twine', code: 'TWI', name: 'Twine', description: 'Tying up loose ends, one merge at a time.', imageKey: 'building/twine', threshold: 1, editThreshold: 1 },
  { id: 1002, track: 'building', sequence: 2, slug: 'screwdriver', code: 'SCR', name: 'Screwdriver', description: 'Righty tighty, lefty loosey.', imageKey: 'building/screwdriver', threshold: 10, editThreshold: 10 },
  { id: 1003, track: 'building', sequence: 3, slug: 'hammer', code: 'HAM', name: 'Hammer', description: 'Nailed it!', imageKey: 'building/hammer', threshold: 25, editThreshold: 25 },
  { id: 1004, track: 'building', sequence: 4, slug: 'chisel', code: 'CHI', name: 'Chisel', description: 'You\'re the Michelangelo of neuron sculpting.', imageKey: 'building/chisel', threshold: 50, editThreshold: 50 },
  { id: 1005, track: 'building', sequence: 5, slug: 'glue', code: 'GL', name: 'Glue', description: 'Sticking with it! 100 edits and counting.', imageKey: 'building/glue', threshold: 100, editThreshold: 100 },
  { id: 1006, track: 'building', sequence: 6, slug: 'bucket', code: 'BUC', name: 'Bucket', description: 'Full of mergers you\'ve lopped off. We\'re gonna need another bucket!', imageKey: 'building/bucket', threshold: 200, editThreshold: 200 },
  { id: 1007, track: 'building', sequence: 7, slug: 'shovel', code: 'SHO', name: 'Shovel', description: 'Great for shoveling mergers into the recycling bin.', imageKey: 'building/shovel', threshold: 300, editThreshold: 300 },
  { id: 1008, track: 'building', sequence: 8, slug: 'mallet', code: 'MAL', name: 'Mallet', description: 'Four hundred edits! It\'s mallet time.', imageKey: 'building/mallet', threshold: 400, editThreshold: 400 },
  { id: 1009, track: 'building', sequence: 9, slug: 'wrench', code: 'WRE', name: 'Wrench', description: 'No wrench in your plans. Just 500 edits made!', imageKey: 'building/wrench', threshold: 500, editThreshold: 500 },
  { id: 1010, track: 'building', sequence: 10, slug: 'trowel', code: 'TRO', name: 'Trowel', description: 'No jagged edges in sight. You\'re a smooth operator!', imageKey: 'building/trowel', threshold: 750, editThreshold: 750 },
  { id: 1011, track: 'building', sequence: 11, slug: 'axe', code: 'AXE', name: 'Axe', description: 'One thousand edits! Timberrr!', imageKey: 'building/axe', threshold: 1_000, editThreshold: 1_000 },
  { id: 1012, track: 'building', sequence: 12, slug: 'ladder', code: 'LAD', name: 'Ladder', description: 'One step at a time, you\'re climbing to the top of the leaderboard!', imageKey: 'building/ladder', threshold: 1_500, editThreshold: 1_500 },
  { id: 1013, track: 'building', sequence: 13, slug: 'pick-axe', code: 'PA', name: 'Pick Axe', description: 'Hidden mergers are your gemstones!', imageKey: 'building/pick-axe', threshold: 2_000, editThreshold: 2_000 },
  { id: 1014, track: 'building', sequence: 14, slug: 'wheelbarrow', code: 'WHE', name: 'Wheelbarrow', description: 'We\'ll need a couple of these to haul away all your edited mergers!', imageKey: 'building/wheelbarrow', threshold: 2_500, editThreshold: 2_500 },
  { id: 1015, track: 'building', sequence: 15, slug: 'saw', code: 'SAW', name: 'Saw', description: 'I merged, I sawed, I conquered.', imageKey: 'building/saw', threshold: 3_000, editThreshold: 3_000 },
  { id: 1016, track: 'building', sequence: 16, slug: 'hand-plane', code: 'HP', name: 'Hand Plane', description: 'Just take a little off the top.', imageKey: 'building/hand-plane', threshold: 3_500, editThreshold: 3_500 },
  { id: 1017, track: 'building', sequence: 17, slug: 'clamp', code: 'CLA', name: 'Clamp', description: 'How we hold your segments together before you merge them.', imageKey: 'building/clamp', threshold: 4_000, editThreshold: 4_000 },
  { id: 1018, track: 'building', sequence: 18, slug: 'tape-measure', code: 'TM', name: 'Tape Measure', description: 'That\'s one tall pile of edits! Glad we sprung for the retractable model.', imageKey: 'building/tape-measure', threshold: 4_500, editThreshold: 4_500 },
  { id: 1019, track: 'building', sequence: 19, slug: 'leveler', code: 'LEV', name: 'Leveler', description: '5K edits! You\'re leveling up!', imageKey: 'building/leveler', threshold: 5_000, editThreshold: 5_000 },
  { id: 1020, track: 'building', sequence: 20, slug: 'plumb-bob', code: 'PB', name: 'Plumb Bob', description: 'Plumb perfect. Thanks, Bob.', imageKey: 'building/plumb-bob', threshold: 6_000, editThreshold: 6_000 },
  { id: 1021, track: 'building', sequence: 21, slug: 'laser-leveler', code: 'LL', name: 'Laser Leveler', description: 'Everything\'s cooler with a laser! And probably more precise or something.', imageKey: 'building/laser-leveler', threshold: 7_000, editThreshold: 7_000 },
  { id: 1022, track: 'building', sequence: 22, slug: 'battery', code: 'BAT', name: 'Battery', description: 'You\'re an AA+ editor!', imageKey: 'building/battery', threshold: 8_000, editThreshold: 8_000 },
  { id: 1023, track: 'building', sequence: 23, slug: 'column', code: 'COL', name: 'Column', description: 'You\'re a pillar of the Pyr community.', imageKey: 'building/column', threshold: 9_000, editThreshold: 9_000 },
  { id: 1024, track: 'building', sequence: 24, slug: 'arch', code: 'ARC', name: 'Arch', description: 'The Romans built these with only gravity as an adhesive! (But there\'s no gravity in cyberspace, please merge!)', imageKey: 'building/arch', threshold: 10_000, editThreshold: 10_000 },
  { id: 1025, track: 'building', sequence: 25, slug: 'corbel', code: 'COR', name: 'Corbel', description: 'Brace yourself! More mergers on the horizon!', imageKey: 'building/corbel', threshold: 11_000, editThreshold: 11_000 },
  { id: 1026, track: 'building', sequence: 26, slug: 'dome', code: 'DOM', name: 'Dome', description: 'Reminds me of a soma at the edge of the dataset.', imageKey: 'building/dome', threshold: 12_000, editThreshold: 12_000 },
  { id: 1027, track: 'building', sequence: 27, slug: 'vault', code: 'VAU', name: 'Vault', description: 'Where we keep all the coolest neurons.', imageKey: 'building/vault', threshold: 13_000, editThreshold: 13_000 },
  { id: 1028, track: 'building', sequence: 28, slug: 'loom', code: 'LOO', name: 'Loom', description: 'You\'re a professional neuron weaver.', imageKey: 'building/loom', threshold: 14_000, editThreshold: 14_000 },
  { id: 1029, track: 'building', sequence: 29, slug: 'bellows', code: 'BEL', name: 'Bellows', description: 'How we expand the lantern tool.', imageKey: 'building/bellows', threshold: 15_000, editThreshold: 15_000 },
  { id: 1030, track: 'building', sequence: 30, slug: 'kiln', code: 'KIL', name: 'Kiln', description: 'Not to glaze you but you\'re completely kiln it!', imageKey: 'building/kiln', threshold: 16_000, editThreshold: 16_000 },
  { id: 1031, track: 'building', sequence: 31, slug: 'anvil', code: 'ANV', name: 'Anvil', description: 'Working those neurons into perfect shape.', imageKey: 'building/anvil', threshold: 17_000, editThreshold: 17_000 },
  { id: 1032, track: 'building', sequence: 32, slug: 'catapult', code: 'CAT', name: 'Catapult', description: 'Launching your mergers into a land far far away.', imageKey: 'building/catapult', threshold: 18_000, editThreshold: 18_000 },
  { id: 1033, track: 'building', sequence: 33, slug: 'forge', code: 'FOR', name: 'Forge', description: 'From the ashes of 19K edits, beautifully forged cells rise!', imageKey: 'building/forge', threshold: 19_000, editThreshold: 19_000 },
  { id: 1034, track: 'building', sequence: 34, slug: 'actuator', code: 'ACT', name: 'Actuator', description: 'Converts your enthusiasm for science into 20K edits!', imageKey: 'building/actuator', threshold: 20_000, editThreshold: 20_000 },
  { id: 1035, track: 'building', sequence: 35, slug: 'electric-drill', code: 'ED', name: 'Electric Drill', description: 'Power tools for a power user!', imageKey: 'building/electric-drill', threshold: 22_500, editThreshold: 22_500 },
  { id: 1036, track: 'building', sequence: 36, slug: 'welding-torch', code: 'WT', name: 'Welding Torch', description: 'Those branches are coming off anytime soon!', imageKey: 'building/welding-torch', threshold: 25_000, editThreshold: 25_000 },
  { id: 1037, track: 'building', sequence: 37, slug: 'rivet-gun', code: 'RG', name: 'Rivet Gun', description: 'Riveting work, truly.', imageKey: 'building/rivet-gun', threshold: 27_500, editThreshold: 27_500 },
  { id: 1038, track: 'building', sequence: 38, slug: 'workbench', code: 'WOR', name: 'Workbench', description: 'Clear out some space in the garage!', imageKey: 'building/workbench', threshold: 30_000, editThreshold: 30_000 },
  { id: 1039, track: 'building', sequence: 39, slug: 'component-organizer', code: 'CO', name: 'Component Organizer', description: 'Marie Kondo would be proud.', imageKey: 'building/component-organizer', threshold: 32_500, editThreshold: 32_500 },
  { id: 1040, track: 'building', sequence: 40, slug: 'pcb-etching-kit', code: 'PE', name: 'PCB Etching Kit', description: 'Custom designed neurons.', imageKey: 'building/pcb-etching-kit', threshold: 35_000, editThreshold: 35_000 },
  { id: 1041, track: 'building', sequence: 41, slug: 'breadboard', code: 'BRE', name: 'Breadboard', description: 'Great for testing out edits! Also making me hungry...', imageKey: 'building/breadboard', threshold: 37_500, editThreshold: 37_500 },
  { id: 1042, track: 'building', sequence: 42, slug: 'jumper-wires', code: 'JW', name: 'Jumper Wires', description: 'Easy to attach and remove! Just like your segments! Mostly!', imageKey: 'building/jumper-wires', threshold: 40_000, editThreshold: 40_000 },
  { id: 1043, track: 'building', sequence: 43, slug: 'wire-strippers', code: 'WS', name: 'Wire Strippers', description: 'Creating space for a better connection.', imageKey: 'building/wire-strippers', threshold: 42_500, editThreshold: 42_500 },
  { id: 1044, track: 'building', sequence: 44, slug: 'soldering-iron', code: 'SI', name: 'Soldering Iron', description: 'Your joining skills are never in flux.', imageKey: 'building/soldering-iron', threshold: 45_000, editThreshold: 45_000 },
  { id: 1045, track: 'building', sequence: 45, slug: 'power-supply', code: 'PS', name: 'Power Supply', description: 'You\'ll need a couple of these at the rate you\'re going!', imageKey: 'building/power-supply', threshold: 47_500, editThreshold: 47_500 },
  { id: 1046, track: 'building', sequence: 46, slug: 'microcontroller', code: 'MIC', name: 'Microcontroller', description: 'Aww it\'s so cute!', imageKey: 'building/microcontroller', threshold: 50_000, editThreshold: 50_000 },
  { id: 1047, track: 'building', sequence: 47, slug: 'prototyping-shield', code: 'PS', name: 'Prototyping Shield', description: 'Got an idea? Try it out!', imageKey: 'building/prototyping-shield', threshold: 55_000, editThreshold: 55_000 },
  { id: 1048, track: 'building', sequence: 48, slug: 'rasberry-pi', code: 'RP', name: 'Raspberry Pi', description: 'Sounds tasty. I\'ll take two!', imageKey: 'building/rasberry-pi', threshold: 60_000, editThreshold: 60_000 },
  { id: 1049, track: 'building', sequence: 49, slug: 'leds', code: 'LED', name: 'LEDs', description: 'You\'re a true gamer now!', imageKey: 'building/leds', threshold: 65_000, editThreshold: 65_000 },
  { id: 1050, track: 'building', sequence: 50, slug: 'servo-motor', code: 'SM', name: 'Servo Motor', description: 'At your service-o.', imageKey: 'building/servo-motor', threshold: 70_000, editThreshold: 70_000 },
  { id: 1051, track: 'building', sequence: 51, slug: 'motor-driver', code: 'MD', name: 'Motor Driver', description: 'Who\'s driving this thing? You are.', imageKey: 'building/motor-driver', threshold: 75_000, editThreshold: 75_000 },
  { id: 1052, track: 'building', sequence: 52, slug: 'ball-caster', code: 'BC', name: 'Ball Caster', description: 'Having a ball out here.', imageKey: 'building/ball-caster', threshold: 80_000, editThreshold: 80_000 },
  { id: 1053, track: 'building', sequence: 53, slug: 'claw', code: 'CLA', name: 'Claw', description: 'The claw has chosen you!', imageKey: 'building/claw', threshold: 85_000, editThreshold: 85_000 },
  { id: 1054, track: 'building', sequence: 54, slug: 'track-system', code: 'TRA', name: 'Track System', description: 'Back on track. Actually, you never left.', imageKey: 'building/track-system', threshold: 90_000, editThreshold: 90_000 },
  { id: 1055, track: 'building', sequence: 55, slug: 'robot-chassis', code: 'RC', name: 'Robot Chassis', description: 'Nice chassis. Wanna build a robot?', imageKey: 'building/robot-chassis', threshold: 95_000, editThreshold: 95_000 },
  { id: 1056, track: 'building', sequence: 56, slug: 'robot-arm-kit', code: 'RA', name: 'Robot Arm Kit', description: 'Lending a robotic hand.', imageKey: 'building/robot-arm-kit', threshold: 100_000, editThreshold: 100_000 },
  { id: 1057, track: 'building', sequence: 57, slug: 'gripper-kit', code: 'GRI', name: 'Gripper Kit', description: 'Get a grip! Oh, you already have one.', imageKey: 'building/gripper-kit', threshold: 125_000, editThreshold: 125_000 },
  { id: 1058, track: 'building', sequence: 58, slug: '3d-printer', code: '3P', name: '3D Printer', description: 'Printing in three whole dimensions. Fancy.', imageKey: 'building/3d-printer', threshold: 150_000, editThreshold: 150_000 },
  { id: 1059, track: 'building', sequence: 59, slug: 'resin-vat', code: 'RV', name: 'Resin Vat', description: 'Liquid to solid. That\'s some chemistry.', imageKey: 'building/resin-vat', threshold: 175_000, editThreshold: 175_000 },
  { id: 1060, track: 'building', sequence: 60, slug: 'robotic-fabricator', code: 'RF', name: 'Robotic Fabricator', description: 'Robots making robots. What could go wrong?', imageKey: 'building/robotic-fabricator', threshold: 200_000, editThreshold: 200_000 },
  { id: 1061, track: 'building', sequence: 61, slug: 'laser-cutter', code: 'LC', name: 'Laser Cutter', description: 'Cutting edge. Literally.', imageKey: 'building/laser-cutter', threshold: 225_000, editThreshold: 225_000 },
  { id: 1062, track: 'building', sequence: 62, slug: 'cnc-router', code: 'CR', name: 'CNC Router', description: 'Routed straight to greatness.', imageKey: 'building/cnc-router', threshold: 250_000, editThreshold: 250_000 },
  { id: 1063, track: 'building', sequence: 63, slug: 'milling-machine', code: 'MM', name: 'Milling Machine', description: 'Not just run of the mill.', imageKey: 'building/milling-machine', threshold: 275_000, editThreshold: 275_000 },
  { id: 1064, track: 'building', sequence: 64, slug: 'bandsaw', code: 'BAN', name: 'Bandsaw', description: 'Started a band. Saw some success.', imageKey: 'building/bandsaw', threshold: 300_000, editThreshold: 300_000 },
  { id: 1065, track: 'building', sequence: 65, slug: 'table-saw', code: 'TS', name: 'Table Saw', description: 'Table for one? Saw that coming.', imageKey: 'building/table-saw', threshold: 325_000, editThreshold: 325_000 },
  { id: 1066, track: 'building', sequence: 66, slug: 'lathe', code: 'LAT', name: 'Lathe', description: 'Spinning wood into wonders.', imageKey: 'building/lathe', threshold: 350_000, editThreshold: 350_000 },
  { id: 1067, track: 'building', sequence: 67, slug: 'gearbox', code: 'GEA', name: 'Gearbox', description: 'Shifting into high gear.', imageKey: 'building/gearbox', threshold: 375_000, editThreshold: 375_000 },
  { id: 1068, track: 'building', sequence: 68, slug: 'carbon-fiber', code: 'CF', name: 'Carbon Fiber', description: 'Lightweight material, heavyweight results.', imageKey: 'building/carbon-fiber', threshold: 400_000, editThreshold: 400_000 },
  { id: 1069, track: 'building', sequence: 69, slug: 'kevlar', code: 'KEV', name: 'Kevlar', description: 'Bulletproof dedication.', imageKey: 'building/kevlar', threshold: 425_000, editThreshold: 425_000 },
  { id: 1070, track: 'building', sequence: 70, slug: 'vacuum-tube', code: 'VT', name: 'Vacuum Tube', description: 'Retro tech for a timeless editor.', imageKey: 'building/vacuum-tube', threshold: 450_000, editThreshold: 450_000 },
  { id: 1071, track: 'building', sequence: 71, slug: 'transistor', code: 'TRA', name: 'Transistor', description: 'Small switch, big impact. Sounds like you.', imageKey: 'building/transistor', threshold: 475_000, editThreshold: 475_000 },
  { id: 1072, track: 'building', sequence: 72, slug: 'gantry-crane', code: 'GC', name: 'Gantry Crane', description: 'Heavy lifting? You make it look easy.', imageKey: 'building/gantry-crane', threshold: 500_000, editThreshold: 500_000 },
  { id: 1073, track: 'building', sequence: 73, slug: 'robotic-welder', code: 'RW', name: 'Robotic Welder', description: 'Sparks are flying. Must be love.', imageKey: 'building/robotic-welder', threshold: 525_000, editThreshold: 525_000 },
  { id: 1074, track: 'building', sequence: 74, slug: 'autonomous-assembly-cell', code: 'AAC', name: 'Autonomous Assembly Cell', description: 'It builds itself. Kind of like your edit count.', imageKey: 'building/autonomous-assembly-cell', threshold: 550_000, editThreshold: 550_000 },
  { id: 1075, track: 'building', sequence: 75, slug: 'microfactory', code: 'MIC', name: 'Microfactory', description: '575,000 edits. You ARE the factory.', imageKey: 'building/microfactory', threshold: 575_000, editThreshold: 575_000 },
];

export const EXPLORATION_BADGES: BadgeDefinition[] = [
  { id: 1101, track: 'exploration', sequence: 1, slug: 'abacus', code: 'ABA', name: 'Abacus', description: 'Ancient peoples used these to count their completed neurons! Probably!', imageKey: 'exploration/abacus', threshold: 1, editThreshold: 1 },
  { id: 1102, track: 'exploration', sequence: 2, slug: 'pencil', code: 'PEN', name: 'Pencil', description: 'The pencil is mightier than the swordcil.', imageKey: 'exploration/pencil', threshold: 5, editThreshold: 5 },
  { id: 1103, track: 'exploration', sequence: 3, slug: 'lab-notebook', code: 'LN', name: 'Lab Notebook', description: 'Dear diary, today I completed 10 cells!', imageKey: 'exploration/lab-notebook', threshold: 10, editThreshold: 10 },
  { id: 1104, track: 'exploration', sequence: 4, slug: 'ink', code: 'INK', name: 'Ink', description: 'Fifteen cells!! Maybe their branches will give you some calligraphic inspo.', imageKey: 'exploration/ink', threshold: 15, editThreshold: 15 },
  { id: 1105, track: 'exploration', sequence: 5, slug: 'fountain-pen', code: 'FP', name: 'Fountain Pen', description: 'You\'re a science boss! This will look great on your desk.', imageKey: 'exploration/fountain-pen', threshold: 20, editThreshold: 20 },
  { id: 1106, track: 'exploration', sequence: 6, slug: 'safety-goggles', code: 'SG', name: 'Safety Goggles', description: 'Eyes protected. You\'ll need them for the next thousand cells.', imageKey: 'exploration/safety-goggles', threshold: 30, editThreshold: 30 },
  { id: 1107, track: 'exploration', sequence: 7, slug: 'lab-coat', code: 'LC', name: 'Lab Coat', description: 'You look the part now.', imageKey: 'exploration/lab-coat', threshold: 40, editThreshold: 40 },
  { id: 1108, track: 'exploration', sequence: 8, slug: 'astrolabe', code: 'AST', name: 'Astrolabe', description: 'Sailors read the stars. You, Captain, read neurons.', imageKey: 'exploration/astrolabe', threshold: 50, editThreshold: 50 },
  { id: 1109, track: 'exploration', sequence: 9, slug: 'map', code: 'MAP', name: 'Map', description: 'The GPS of physical media.', imageKey: 'exploration/map', threshold: 75, editThreshold: 75 },
  { id: 1110, track: 'exploration', sequence: 10, slug: 'compass', code: 'COM', name: 'Compass', description: '100 cells! What a feat! Take this tool to help you navigate them all.', imageKey: 'exploration/compass', threshold: 100, editThreshold: 100 },
  { id: 1111, track: 'exploration', sequence: 11, slug: 'bunsen-burner', code: 'BB', name: 'Bunsen Burner', description: 'Keep that flame of curiosity burning.', imageKey: 'exploration/bunsen-burner', threshold: 125, editThreshold: 125 },
  { id: 1112, track: 'exploration', sequence: 12, slug: 'thermometer', code: 'THE', name: 'Thermometer', description: 'Your cell count is officially running a fever.', imageKey: 'exploration/thermometer', threshold: 150, editThreshold: 150 },
  { id: 1113, track: 'exploration', sequence: 13, slug: 'globe', code: 'GLO', name: 'Globe', description: '200 cells! Our international citsci community salutes you!', imageKey: 'exploration/globe', threshold: 200, editThreshold: 200 },
  { id: 1114, track: 'exploration', sequence: 14, slug: 'barometer', code: 'BAR', name: 'Barometer', description: 'Pressure\'s rising. So is your cell count.', imageKey: 'exploration/barometer', threshold: 250, editThreshold: 250 },
  { id: 1115, track: 'exploration', sequence: 15, slug: 'fresnel-lens', code: 'FL', name: 'Fresnel Lens', description: 'Illuminating your path forward, lighthouse style!', imageKey: 'exploration/fresnel-lens', threshold: 300, editThreshold: 300 },
  { id: 1116, track: 'exploration', sequence: 16, slug: 'telescope', code: 'TEL', name: 'Telescope', description: 'Stars are like the neurons of the sky.', imageKey: 'exploration/telescope', threshold: 350, editThreshold: 350 },
  { id: 1117, track: 'exploration', sequence: 17, slug: 'depth-gauge', code: 'DG', name: 'Depth Gauge', description: 'Four hundred cells! You\'re in deep now.', imageKey: 'exploration/depth-gauge', threshold: 400, editThreshold: 400 },
  { id: 1118, track: 'exploration', sequence: 18, slug: 'binoculars', code: 'BIN', name: 'Binoculars', description: 'Two eyes on the prize. Also great for bird watching.', imageKey: 'exploration/binoculars', threshold: 450, editThreshold: 450 },
  { id: 1119, track: 'exploration', sequence: 19, slug: 'hygrometer', code: 'HYG', name: 'Hygrometer', description: 'It\'s not the heat, it\'s the humidity! Or maybe it\'s your overclocked CPU...', imageKey: 'exploration/hygrometer', threshold: 500, editThreshold: 500 },
  { id: 1120, track: 'exploration', sequence: 20, slug: 'altimeter', code: 'ALT', name: 'Altimeter', description: 'Your cell count is making me dizzy!', imageKey: 'exploration/altimeter', threshold: 600, editThreshold: 600 },
  { id: 1121, track: 'exploration', sequence: 21, slug: 'gyroscope', code: 'GYR', name: 'Gyroscope', description: 'You spin those cells right round (right round)', imageKey: 'exploration/gyroscope', threshold: 700, editThreshold: 700 },
  { id: 1122, track: 'exploration', sequence: 22, slug: 'accelerometer', code: 'ACC', name: 'Accelerometer', description: 'Whoa, slow down! Actually, never mind. Keep going.', imageKey: 'exploration/accelerometer', threshold: 800, editThreshold: 800 },
  { id: 1123, track: 'exploration', sequence: 23, slug: 'multimeter', code: 'MUL', name: 'Multimeter', description: 'Cells that fire together, wire together!', imageKey: 'exploration/multimeter', threshold: 900, editThreshold: 900 },
  { id: 1124, track: 'exploration', sequence: 24, slug: 'oscilloscope', code: 'OSC', name: 'Oscilloscope', description: 'Let\'s do the wave. The brainwave!', imageKey: 'exploration/oscilloscope', threshold: 1_000, editThreshold: 1_000 },
  { id: 1125, track: 'exploration', sequence: 25, slug: 'logic-analyzer', code: 'LA', name: 'Logic Analyzer', description: 'Logically, the next step is another cell.', imageKey: 'exploration/logic-analyzer', threshold: 1_100, editThreshold: 1_100 },
  { id: 1126, track: 'exploration', sequence: 26, slug: 'magnetometer', code: 'MAG', name: 'Magnetometer', description: 'Like a moth to a flame, or a citizen scientist to one more cell.', imageKey: 'exploration/magnetometer', threshold: 1_200, editThreshold: 1_200 },
  { id: 1127, track: 'exploration', sequence: 27, slug: 'centrifuge', code: 'CEN', name: 'Centrifuge', description: 'Separating cells from their mergers at dizzying speeds!', imageKey: 'exploration/centrifuge', threshold: 1_300, editThreshold: 1_300 },
  { id: 1128, track: 'exploration', sequence: 28, slug: 'golgi-stain-kit', code: 'GSK', name: 'Golgi Stain Kit', description: 'The stain that first showed us neurons. Dyed and true.', imageKey: 'exploration/golgi-stain-kit', threshold: 1_400, editThreshold: 1_400 },
  { id: 1129, track: 'exploration', sequence: 29, slug: 'cajals-sketchbook', code: 'CSS', name: 'Cajal\'s Sketchbook', description: 'Cajal drew neurons by hand. You\'re in good company.', imageKey: 'exploration/cajals-sketchbook', threshold: 1_500, editThreshold: 1_500 },
  { id: 1130, track: 'exploration', sequence: 30, slug: 'compound-microscope', code: 'CM', name: 'Compound Microscope', description: 'Your cell completion rate is multiplying!', imageKey: 'exploration/compound-microscope', threshold: 1_600, editThreshold: 1_600 },
  { id: 1131, track: 'exploration', sequence: 31, slug: 'electron-microscope', code: 'EM', name: 'Electron Microscope', description: 'The microscope that gave us Pyr!', imageKey: 'exploration/electron-microscope', threshold: 1_700, editThreshold: 1_700 },
  { id: 1132, track: 'exploration', sequence: 32, slug: 'tomography', code: 'TOM', name: 'Tomography', description: 'Slice, slice, baby.', imageKey: 'exploration/tomography', threshold: 1_800, editThreshold: 1_800 },
  { id: 1133, track: 'exploration', sequence: 33, slug: 'gps-receiver', code: 'GR', name: 'GPS Receiver', description: 'Cells detected in your area! Add to route?', imageKey: 'exploration/gps-receiver', threshold: 1_900, editThreshold: 1_900 },
  { id: 1134, track: 'exploration', sequence: 34, slug: 'ultramicrotome', code: 'ULT', name: 'Ultramicrotome', description: 'Your work is cutting edge.', imageKey: 'exploration/ultramicrotome', threshold: 2_000, editThreshold: 2_000 },
  { id: 1135, track: 'exploration', sequence: 35, slug: 'spectrometer', code: 'SPE', name: 'Spectrometer', description: 'A colorful bouquet of cells belongs to your collection!', imageKey: 'exploration/spectrometer', threshold: 2_250, editThreshold: 2_250 },
  { id: 1136, track: 'exploration', sequence: 36, slug: 'hydrophone', code: 'HYD', name: 'Hydrophone', description: 'Whale hello there!', imageKey: 'exploration/hydrophone', threshold: 2_500, editThreshold: 2_500 },
  { id: 1137, track: 'exploration', sequence: 37, slug: 'chromatograph', code: 'CHR', name: 'Chromatograph', description: 'Separating the great from the good. You\'re great.', imageKey: 'exploration/chromatograph', threshold: 2_750, editThreshold: 2_750 },
  { id: 1138, track: 'exploration', sequence: 38, slug: 'seismograph', code: 'SEI', name: 'Seismograph', description: 'Earthquake detected. Oh wait, that\'s just you.', imageKey: 'exploration/seismograph', threshold: 3_000, editThreshold: 3_000 },
  { id: 1139, track: 'exploration', sequence: 39, slug: 'geiger-counter', code: 'GC', name: 'Geiger Counter', description: 'Warning: radioactive levels of dedication.', imageKey: 'exploration/geiger-counter', threshold: 3_250, editThreshold: 3_250 },
  { id: 1140, track: 'exploration', sequence: 40, slug: 'cloud-chamber', code: 'CC', name: 'Cloud Chamber', description: 'Particle trails, like ghosts passing through.', imageKey: 'exploration/cloud-chamber', threshold: 3_500, editThreshold: 3_500 },
  { id: 1141, track: 'exploration', sequence: 41, slug: 'tesla-coil', code: 'TC', name: 'Tesla Coil', description: 'Shocking progress.', imageKey: 'exploration/tesla-coil', threshold: 3_750, editThreshold: 3_750 },
  { id: 1142, track: 'exploration', sequence: 42, slug: 'gravimeter', code: 'GRA', name: 'Gravimeter', description: 'According to our calculations your neuron collection is getting pretty weighty.', imageKey: 'exploration/gravimeter', threshold: 4_000, editThreshold: 4_000 },
  { id: 1143, track: 'exploration', sequence: 43, slug: 'sonar-array', code: 'SA', name: 'Sonar Array', description: 'You\'ve turned your cell count up to 11!', imageKey: 'exploration/sonar-array', threshold: 4_250, editThreshold: 4_250 },
  { id: 1144, track: 'exploration', sequence: 44, slug: 'lidar', code: 'LID', name: 'LiDAR', description: 'Pew pew! Lasers make everything cooler.', imageKey: 'exploration/lidar', threshold: 4_500, editThreshold: 4_500 },
  { id: 1145, track: 'exploration', sequence: 45, slug: 'infrared-sensor', code: 'IS', name: 'Infrared Sensor', description: 'Your cell count is heating up!', imageKey: 'exploration/infrared-sensor', threshold: 4_750, editThreshold: 4_750 },
  { id: 1146, track: 'exploration', sequence: 46, slug: 'ultrasonic-sensor', code: 'US', name: 'Ultrasonic Sensor', description: 'Echo, echo echo! I hear the sound of 5K cells.', imageKey: 'exploration/ultrasonic-sensor', threshold: 5_000, editThreshold: 5_000 },
  { id: 1147, track: 'exploration', sequence: 47, slug: 'touch-sensor', code: 'TS', name: 'Touch Sensor', description: 'You\'ve got the magic touch.', imageKey: 'exploration/touch-sensor', threshold: 5_500, editThreshold: 5_500 },
  { id: 1148, track: 'exploration', sequence: 48, slug: 'camera-module', code: 'CAM', name: 'Camera Module', description: 'Say cheese! Another cell for the album.', imageKey: 'exploration/camera-module', threshold: 6_000, editThreshold: 6_000 },
  { id: 1149, track: 'exploration', sequence: 49, slug: 'thermal-camera', code: 'TH8', name: 'Thermal Camera', description: 'Spotted: one very hot streak.', imageKey: 'exploration/thermal-camera', threshold: 6_500, editThreshold: 6_500 },
  { id: 1150, track: 'exploration', sequence: 50, slug: 'hyperspectral-camera', code: 'HC', name: 'Hyperspectral Camera', description: 'You visualize each voxel with hyperhuman precision!', imageKey: 'exploration/hyperspectral-camera', threshold: 7_000, editThreshold: 7_000 },
  { id: 1151, track: 'exploration', sequence: 51, slug: 'ros', code: 'ROS', name: 'ROS', description: 'Beep boop. Hello human!', imageKey: 'exploration/ros', threshold: 7_500, editThreshold: 7_500 },
  { id: 1152, track: 'exploration', sequence: 52, slug: 'quadruped-robot', code: 'QR', name: 'Quadruped Robot', description: 'Robot\'s best friend.', imageKey: 'exploration/quadruped-robot', threshold: 8_000, editThreshold: 8_000 },
  { id: 1153, track: 'exploration', sequence: 53, slug: 'drone', code: 'DRO', name: 'Drone', description: '8,500 cells! The view from up here is buzzing.', imageKey: 'exploration/drone', threshold: 8_500, editThreshold: 8_500 },
  { id: 1154, track: 'exploration', sequence: 54, slug: 'rover', code: 'ROV', name: 'Rover', description: 'A loyal interplanetary companion, also obsessed with finding cells!', imageKey: 'exploration/rover', threshold: 9_000, editThreshold: 9_000 },
  { id: 1155, track: 'exploration', sequence: 55, slug: 'autonomous-underwater-vehicle-auv', code: 'AUV', name: 'Autonomous Underwater Vehicle (AUV)', description: 'A robot\'s favorite type of sandwich.', imageKey: 'exploration/autonomous-underwater-vehicle-auv', threshold: 9_500, editThreshold: 9_500 },
  { id: 1156, track: 'exploration', sequence: 56, slug: 'bathysphere', code: 'BAT', name: 'Bathysphere', description: 'Deeper than the deep end.', imageKey: 'exploration/bathysphere', threshold: 10_000, editThreshold: 10_000 },
  { id: 1157, track: 'exploration', sequence: 57, slug: 'radar-dish', code: 'RD', name: 'Radar Dish', description: 'You\'re on our radar now.', imageKey: 'exploration/radar-dish', threshold: 11_000, editThreshold: 11_000 },
  { id: 1158, track: 'exploration', sequence: 58, slug: 'weather-balloon', code: 'WB', name: 'Weather Balloon', description: 'Forecast: 100 percent chance of more cells.', imageKey: 'exploration/weather-balloon', threshold: 12_000, editThreshold: 12_000 },
  { id: 1159, track: 'exploration', sequence: 59, slug: 'rocket', code: 'ROC', name: 'Rocket', description: 'Three, two, one, lift off!', imageKey: 'exploration/rocket', threshold: 13_000, editThreshold: 13_000 },
  { id: 1160, track: 'exploration', sequence: 60, slug: 'gene-sequencer', code: 'GS', name: 'Gene Sequencer', description: 'Your genes say: born to proofread.', imageKey: 'exploration/gene-sequencer', threshold: 14_000, editThreshold: 14_000 },
  { id: 1161, track: 'exploration', sequence: 61, slug: 'cubesat', code: 'CUB', name: 'CubeSat', description: 'Small satellite, big ambitions. Sounds familiar.', imageKey: 'exploration/cubesat', threshold: 15_000, editThreshold: 15_000 },
  { id: 1162, track: 'exploration', sequence: 62, slug: 'star-tracker', code: 'ST', name: 'Star Tracker', description: 'You\'re a star. This thing would know.', imageKey: 'exploration/star-tracker', threshold: 16_000, editThreshold: 16_000 },
  { id: 1163, track: 'exploration', sequence: 63, slug: 'mission-control-console', code: 'MCC', name: 'Mission Control Console', description: 'All systems go.', imageKey: 'exploration/mission-control-console', threshold: 17_000, editThreshold: 17_000 },
  { id: 1164, track: 'exploration', sequence: 64, slug: 'space-station', code: 'SS', name: 'Space Station', description: 'Home is where the science is.', imageKey: 'exploration/space-station', threshold: 18_000, editThreshold: 18_000 },
  { id: 1165, track: 'exploration', sequence: 65, slug: 'cpu', code: 'CPU', name: 'CPU', description: 'Processing... processing... yep, you\'re awesome.', imageKey: 'exploration/cpu', threshold: 19_000, editThreshold: 19_000 },
  { id: 1166, track: 'exploration', sequence: 66, slug: 'gpu', code: 'GPU', name: 'GPU', description: 'Rendering your greatness in high definition.', imageKey: 'exploration/gpu', threshold: 20_000, editThreshold: 20_000 },
  { id: 1167, track: 'exploration', sequence: 67, slug: 'server', code: 'SER', name: 'Server', description: 'Serving up cells, hot and fresh.', imageKey: 'exploration/server', threshold: 21_000, editThreshold: 21_000 },
  { id: 1168, track: 'exploration', sequence: 68, slug: 'cloud', code: 'CLO', name: 'Cloud', description: 'Your head is in the cloud. Your data too.', imageKey: 'exploration/cloud', threshold: 22_000, editThreshold: 22_000 },
  { id: 1169, track: 'exploration', sequence: 69, slug: 'spare-memory', code: 'SM', name: 'Spare Memory', description: 'You\'ll never forget this one.', imageKey: 'exploration/spare-memory', threshold: 23_000, editThreshold: 23_000 },
  { id: 1170, track: 'exploration', sequence: 70, slug: 'bit-to-petabyte', code: 'ZET', name: 'Zettabyte', description: 'A petabyte of brain, and you\'ve seen a good chunk.', imageKey: 'exploration/bit-to-petabyte', threshold: 24_000, editThreshold: 24_000 },
  { id: 1171, track: 'exploration', sequence: 71, slug: 'computing-cluster', code: 'CO0', name: 'Computing Cluster', description: 'Many machines, one mission: keep up with you.', imageKey: 'exploration/computing-cluster', threshold: 25_000, editThreshold: 25_000 },
  { id: 1172, track: 'exploration', sequence: 72, slug: 'artificial-intelligence-ai-processor', code: 'AIA', name: 'Artificial Intelligence (AI) Processor', description: 'AI is learning from you. Teach it well.', imageKey: 'exploration/artificial-intelligence-ai-processor', threshold: 26_000, editThreshold: 26_000 },
  { id: 1173, track: 'exploration', sequence: 73, slug: 'machine-learning-kit-for-robots', code: 'MLK', name: 'Machine Learning Kit', description: 'Robots study your work. You\'re their favorite teacher.', imageKey: 'exploration/machine-learning-kit-for-robots', threshold: 27_000, editThreshold: 27_000 },
  { id: 1174, track: 'exploration', sequence: 74, slug: 'neural-interface-headset', code: 'NIH', name: 'Neural Interface Headset', description: 'Think it, map it.', imageKey: 'exploration/neural-interface-headset', threshold: 28_000, editThreshold: 28_000 },
  { id: 1175, track: 'exploration', sequence: 75, slug: 'haptic-feedback-system', code: 'HFS', name: 'Haptic Feedback System', description: 'Good vibrations only.', imageKey: 'exploration/haptic-feedback-system', threshold: 29_000, editThreshold: 29_000 },
  { id: 1176, track: 'exploration', sequence: 76, slug: 'robotic-exoskeleton', code: 'RE', name: 'Robotic Exoskeleton', description: 'Super suit unlocked. Cape not included.', imageKey: 'exploration/robotic-exoskeleton', threshold: 30_000, editThreshold: 30_000 },
  { id: 1177, track: 'exploration', sequence: 77, slug: 'flexible-electronic-skin-e-skin', code: 'FES', name: 'Flexible Electronic Skin (e-skin)', description: 'Thick skinned? Nope, just electronic.', imageKey: 'exploration/flexible-electronic-skin-e-skin', threshold: 31_000, editThreshold: 31_000 },
  { id: 1178, track: 'exploration', sequence: 78, slug: 'biosensor', code: 'BIO', name: 'Biosensor', description: 'Sensing a lot of talent around here.', imageKey: 'exploration/biosensor', threshold: 32_000, editThreshold: 32_000 },
  { id: 1179, track: 'exploration', sequence: 79, slug: 'quantum-sensor', code: 'QS', name: 'Quantum Sensor', description: 'Sensitive enough to feel your enthusiasm.', imageKey: 'exploration/quantum-sensor', threshold: 33_000, editThreshold: 33_000 },
  { id: 1180, track: 'exploration', sequence: 80, slug: 'satellite', code: 'SAT', name: 'Satellite', description: 'Houston, we have a top scientist.', imageKey: 'exploration/satellite', threshold: 34_000, editThreshold: 34_000 },
  { id: 1181, track: 'exploration', sequence: 81, slug: 'microbot-swarm', code: 'MS', name: 'Microbot Swarm', description: 'Tiny robots teaming up. Just like Pyr players.', imageKey: 'exploration/microbot-swarm', threshold: 35_000, editThreshold: 35_000 },
  { id: 1182, track: 'exploration', sequence: 82, slug: 'dna-nanotechnology', code: 'DN', name: 'DNA Nanotechnology', description: 'Folding DNA into tiny origami. Neat!', imageKey: 'exploration/dna-nanotechnology', threshold: 36_000, editThreshold: 36_000 },
  { id: 1183, track: 'exploration', sequence: 83, slug: 'brain-organoid', code: 'BO', name: 'Brain Organoid', description: 'A tiny brain, grown with care.', imageKey: 'exploration/brain-organoid', threshold: 37_000, editThreshold: 37_000 },
  { id: 1184, track: 'exploration', sequence: 84, slug: 'nanoscope', code: 'NAN', name: 'Nanoscope', description: 'Seeing the tiniest things. Size isn\'t everything.', imageKey: 'exploration/nanoscope', threshold: 38_000, editThreshold: 38_000 },
  { id: 1185, track: 'exploration', sequence: 85, slug: 'synchrotron', code: 'SYN', name: 'Synchrotron', description: 'A ring of light big enough to see a whole brain.', imageKey: 'exploration/synchrotron', threshold: 39_000, editThreshold: 39_000 },
  { id: 1186, track: 'exploration', sequence: 86, slug: 'particle-detector', code: 'PD', name: 'Particle Detector', description: 'Detected: one exceptional particle. It\'s you.', imageKey: 'exploration/particle-detector', threshold: 40_000, editThreshold: 40_000 },
  { id: 1187, track: 'exploration', sequence: 87, slug: 'quantum-computer', code: 'QC', name: 'Quantum Computer', description: 'Are you done or not done? Yes.', imageKey: 'exploration/quantum-computer', threshold: 41_000, editThreshold: 41_000 },
  { id: 1188, track: 'exploration', sequence: 88, slug: 'fusion-test-chamber', code: 'FTC', name: 'Fusion Test Chamber', description: 'Your energy could power a small star.', imageKey: 'exploration/fusion-test-chamber', threshold: 42_000, editThreshold: 42_000 },
  { id: 1189, track: 'exploration', sequence: 89, slug: 'neutrino-detector', code: 'ND', name: 'Neutrino Detector', description: 'Catching ghost particles. Spooky science!', imageKey: 'exploration/neutrino-detector', threshold: 43_000, editThreshold: 43_000 },
  { id: 1190, track: 'exploration', sequence: 90, slug: 'gravitational-wave-detector', code: 'GWD', name: 'Gravitational Wave Detector', description: 'Listening to space bend.', imageKey: 'exploration/gravitational-wave-detector', threshold: 44_000, editThreshold: 44_000 },
  { id: 1191, track: 'exploration', sequence: 91, slug: 'deep-sea-observatory', code: 'DSO', name: 'Deep Sea Observatory', description: 'Things get weird down here. You fit right in.', imageKey: 'exploration/deep-sea-observatory', threshold: 45_000, editThreshold: 45_000 },
  { id: 1192, track: 'exploration', sequence: 92, slug: 'orbital-telescope', code: 'OT', name: 'Orbital Telescope', description: 'Out of this world work.', imageKey: 'exploration/orbital-telescope', threshold: 46_000, editThreshold: 46_000 },
  { id: 1193, track: 'exploration', sequence: 93, slug: 'planetary-lander', code: 'PL', name: 'Planetary Lander', description: 'The eagle has landed, on a planet of cells.', imageKey: 'exploration/planetary-lander', threshold: 47_000, editThreshold: 47_000 },
  { id: 1194, track: 'exploration', sequence: 94, slug: 'mars-habitat', code: 'MH', name: 'Mars Habitat', description: 'Pack a sweater.', imageKey: 'exploration/mars-habitat', threshold: 48_000, editThreshold: 48_000 },
  { id: 1195, track: 'exploration', sequence: 95, slug: 'swarm-drone-beacon', code: 'SDB', name: 'Swarm Drone Beacon', description: 'Calling all drones. We\'ve found a leader.', imageKey: 'exploration/swarm-drone-beacon', threshold: 49_000, editThreshold: 49_000 },
  { id: 1196, track: 'exploration', sequence: 96, slug: 'exoplanet-imager', code: 'EI', name: 'Exoplanet Imager', description: 'Spotting planets light years away. Legendary vision.', imageKey: 'exploration/exoplanet-imager', threshold: 50_000, editThreshold: 50_000 },
  { id: 1197, track: 'exploration', sequence: 97, slug: 'black-hole-imager', code: 'BHI', name: 'Black Hole Imager', description: 'Seeing the unseeable.', imageKey: 'exploration/black-hole-imager', threshold: 51_000, editThreshold: 51_000 },
  { id: 1198, track: 'exploration', sequence: 98, slug: 'dark-matter-array', code: 'DMA', name: 'Dark Matter Array', description: 'Hunting for what no one can see. You\'d find it.', imageKey: 'exploration/dark-matter-array', threshold: 52_000, editThreshold: 52_000 },
  { id: 1199, track: 'exploration', sequence: 99, slug: 'space-elevator', code: 'SE', name: 'Space Elevator', description: 'Going up? Way, way up.', imageKey: 'exploration/space-elevator', threshold: 53_000, editThreshold: 53_000 },
  { id: 1200, track: 'exploration', sequence: 100, slug: 'golden-record', code: 'GOL', name: 'Golden Record', description: 'Earth\'s greatest hits, now featuring you.', imageKey: 'exploration/golden-record', threshold: 54_000, editThreshold: 54_000 },
  { id: 1201, track: 'exploration', sequence: 101, slug: 'interstellar-probe', code: 'IP', name: 'Interstellar Probe', description: 'To infinity, and beyond! You did it all.', imageKey: 'exploration/interstellar-probe', threshold: 55_000, editThreshold: 55_000 },
  { id: 1202, track: 'exploration', sequence: 102, slug: 'wormhole-gate', code: 'WG', name: 'Wormhole Gate', description: 'A shortcut to the next cell.', imageKey: 'exploration/wormhole-gate', threshold: 56_000, editThreshold: 56_000 },
  { id: 1203, track: 'exploration', sequence: 103, slug: 'brain-in-a-jar', code: 'BIA', name: 'Brain in a Jar', description: 'Classic mad scientist decor.', imageKey: 'exploration/brain-in-a-jar', threshold: 57_000, editThreshold: 57_000 },
  { id: 1204, track: 'exploration', sequence: 104, slug: 'robot-lab-partner', code: 'RLP', name: 'Robot Lab Partner', description: 'Finally, a lab partner who never sleeps.', imageKey: 'exploration/robot-lab-partner', threshold: 58_000, editThreshold: 58_000 },
  { id: 1205, track: 'exploration', sequence: 105, slug: 'hologram-lab', code: 'HL', name: 'Hologram Lab', description: 'Step inside the data.', imageKey: 'exploration/hologram-lab', threshold: 59_000, editThreshold: 59_000 },
  { id: 1206, track: 'exploration', sequence: 106, slug: 'memory-crystal', code: 'MC', name: 'Memory Crystal', description: 'Every memory, polished and stored.', imageKey: 'exploration/memory-crystal', threshold: 60_000, editThreshold: 60_000 },
  { id: 1207, track: 'exploration', sequence: 107, slug: 'synapse-submarine', code: 'SY6', name: 'Synapse Submarine', description: 'Shrunk down and sailing through a synapse.', imageKey: 'exploration/synapse-submarine', threshold: 61_000, editThreshold: 61_000 },
  { id: 1208, track: 'exploration', sequence: 108, slug: 'thought-projector', code: 'TP', name: 'Thought Projector', description: 'Your ideas, on the big screen.', imageKey: 'exploration/thought-projector', threshold: 62_000, editThreshold: 62_000 },
  { id: 1209, track: 'exploration', sequence: 109, slug: 'moon-base', code: 'MB', name: 'Moon Base', description: 'Low gravity, high scores.', imageKey: 'exploration/moon-base', threshold: 63_000, editThreshold: 63_000 },
  { id: 1210, track: 'exploration', sequence: 110, slug: 'lunar-observatory', code: 'LO', name: 'Lunar Observatory', description: 'The best view in the solar system.', imageKey: 'exploration/lunar-observatory', threshold: 64_000, editThreshold: 64_000 },
  { id: 1211, track: 'exploration', sequence: 111, slug: 'solar-sail', code: 'SOL', name: 'Solar Sail', description: 'Sailing on sunlight.', imageKey: 'exploration/solar-sail', threshold: 65_000, editThreshold: 65_000 },
  { id: 1212, track: 'exploration', sequence: 112, slug: 'asteroid-miner', code: 'AM', name: 'Asteroid Miner', description: 'Digging for space gold.', imageKey: 'exploration/asteroid-miner', threshold: 66_000, editThreshold: 66_000 },
  { id: 1213, track: 'exploration', sequence: 113, slug: 'comet-catcher', code: 'CO2', name: 'Comet Catcher', description: 'Caught one, tail and all.', imageKey: 'exploration/comet-catcher', threshold: 67_000, editThreshold: 67_000 },
  { id: 1214, track: 'exploration', sequence: 114, slug: 'seed-vault', code: 'SV', name: 'Seed Vault', description: 'Every seed, safe and sound.', imageKey: 'exploration/seed-vault', threshold: 68_000, editThreshold: 68_000 },
  { id: 1215, track: 'exploration', sequence: 115, slug: 'terraforming-engine', code: 'TE', name: 'Terraforming Engine', description: 'Making Mars a little more homey.', imageKey: 'exploration/terraforming-engine', threshold: 69_000, editThreshold: 69_000 },
  { id: 1216, track: 'exploration', sequence: 116, slug: 'mind-uploader', code: 'MU', name: 'Mind Uploader', description: 'Backing up your brain. Just in case.', imageKey: 'exploration/mind-uploader', threshold: 70_000, editThreshold: 70_000 },
  { id: 1217, track: 'exploration', sequence: 117, slug: 'neuron-constellation', code: 'NC', name: 'Neuron Constellation', description: 'Connect the dots. You\'re good at that.', imageKey: 'exploration/neuron-constellation', threshold: 71_000, editThreshold: 71_000 },
  { id: 1218, track: 'exploration', sequence: 118, slug: 'pulsar-clock', code: 'PC', name: 'Pulsar Clock', description: 'Keeping time by a spinning star.', imageKey: 'exploration/pulsar-clock', threshold: 72_000, editThreshold: 72_000 },
  { id: 1219, track: 'exploration', sequence: 119, slug: 'gravity-lens', code: 'GL', name: 'Gravity Lens', description: 'Bending light like a pro.', imageKey: 'exploration/gravity-lens', threshold: 73_000, editThreshold: 73_000 },
  { id: 1220, track: 'exploration', sequence: 120, slug: 'quantum-entangler', code: 'QE', name: 'Quantum Entangler', description: 'Spooky action, up close.', imageKey: 'exploration/quantum-entangler', threshold: 74_000, editThreshold: 74_000 },
  { id: 1221, track: 'exploration', sequence: 121, slug: 'antimatter-trap', code: 'AT', name: 'Antimatter Trap', description: 'Handle with extreme care.', imageKey: 'exploration/antimatter-trap', threshold: 75_000, editThreshold: 75_000 },
  { id: 1222, track: 'exploration', sequence: 122, slug: 'supernova-detector', code: 'SD', name: 'Supernova Detector', description: 'Big bang energy.', imageKey: 'exploration/supernova-detector', threshold: 76_000, editThreshold: 76_000 },
  { id: 1223, track: 'exploration', sequence: 123, slug: 'generation-ship', code: 'GEN', name: 'Generation Ship', description: 'Packed for a very long trip.', imageKey: 'exploration/generation-ship', threshold: 77_000, editThreshold: 77_000 },
  { id: 1224, track: 'exploration', sequence: 124, slug: 'starship', code: 'STA', name: 'Starship', description: 'Full speed ahead, captain.', imageKey: 'exploration/starship', threshold: 78_000, editThreshold: 78_000 },
  { id: 1225, track: 'exploration', sequence: 125, slug: 'warp-drive', code: 'WD', name: 'Warp Drive', description: 'Faster than light, faster than ever.', imageKey: 'exploration/warp-drive', threshold: 79_000, editThreshold: 79_000 },
  { id: 1226, track: 'exploration', sequence: 126, slug: 'teleporter', code: 'TE5', name: 'Teleporter', description: 'Be right back. Like, instantly.', imageKey: 'exploration/teleporter', threshold: 80_000, editThreshold: 80_000 },
  { id: 1227, track: 'exploration', sequence: 127, slug: 'galaxy-map', code: 'GM', name: 'Galaxy Map', description: 'You are here. Roughly.', imageKey: 'exploration/galaxy-map', threshold: 81_000, editThreshold: 81_000 },
  { id: 1228, track: 'exploration', sequence: 128, slug: 'android-scientist', code: 'AS', name: 'Android Scientist', description: 'It wants to be just like you.', imageKey: 'exploration/android-scientist', threshold: 82_000, editThreshold: 82_000 },
  { id: 1229, track: 'exploration', sequence: 129, slug: 'dyson-sphere', code: 'DS', name: 'Dyson Sphere', description: 'A whole star, harnessed for science.', imageKey: 'exploration/dyson-sphere', threshold: 83_000, editThreshold: 83_000 },
  { id: 1230, track: 'exploration', sequence: 130, slug: 'alien-artifact', code: 'AA', name: 'Alien Artifact', description: 'Nobody knows what it does. Perfect for you.', imageKey: 'exploration/alien-artifact', threshold: 84_000, editThreshold: 84_000 },
  { id: 1231, track: 'exploration', sequence: 131, slug: 'time-machine', code: 'TM', name: 'Time Machine', description: 'Go back and do it all again? Sure.', imageKey: 'exploration/time-machine', threshold: 85_000, editThreshold: 85_000 },
  { id: 1232, track: 'exploration', sequence: 132, slug: 'multiverse-portal', code: 'MP', name: 'Multiverse Portal', description: 'Somewhere out there, another you is mapping cells too.', imageKey: 'exploration/multiverse-portal', threshold: 86_000, editThreshold: 86_000 },
  { id: 1233, track: 'exploration', sequence: 133, slug: 'cosmic-brain', code: 'CB', name: 'Cosmic Brain', description: 'A brain the size of a galaxy. Or is it the other way around?', imageKey: 'exploration/cosmic-brain', threshold: 87_000, editThreshold: 87_000 },
  { id: 1234, track: 'exploration', sequence: 134, slug: 'connectome', code: 'CON', name: 'Connectome', description: 'Every cell you finished is in here. Thank you.', imageKey: 'exploration/connectome', threshold: 88_000, editThreshold: 88_000 },
];

/**
 * Loyalty (Ames 2026-10-06): earned by TOTAL days at EyeWire II. The days do
 * not have to be in a row (Ames: "they don't have to be 'in a row'"), so a
 * holiday or a sick week never costs anyone an achievement. The threshold is
 * a number of days, checked against users.total_days. A day is one with
 * real work in it, an edit or a completed cell (supabase-days-need-action.sql):
 * signing in alone earns nothing, so a bot can not collect these.
 * Each is NAMED FOR THE TIME IT MARKS (Ames 2026-10-06: "the names should
 * reflect time, these are badges for time spent as citizen scientist"): One
 * Week, Three Months, One Year. Not for the art, and not a mood. The slug is
 * the art file's name and the saved key; it is not shown and does not change.
 * Art: github.com/amyleesterling/badges/tree/main/loyalty. Written by hand
 * (the two tracks above are generated); ids 201 and up.
 */
const loyalty = (n: number, days: number, slug: string, code: string, name: string, description: string): BadgeDefinition =>
  ({ id: 200 + n, track: 'loyalty', sequence: n, slug, code, name, description, imageKey: `loyalty/${slug}`, threshold: days, editThreshold: days });
/**
 * OFF for now (Ames 2026-10-06: "remove the loyalty badges for now. We need
 * to iterate. The counter can stay."). The names, text and art below are
 * drafts and are kept for that work, but nothing is shown, earned, announced
 * or favourited while this is false. The Days counter in the profile is
 * separate and stays. Turn on only when Ames says the set is ready; the art
 * folder must then go back into the build copy (scripts/build-prod.js and
 * scripts/dev-server.js).
 */
export const LOYALTY_ENABLED = true;
/**
 * Anywhere but the production site (a test site, a triage preview, a dev
 * server) the unlock card is shown but nothing is saved: no award row and no
 * bell note. Those sites read and write the live database, and a bell note's
 * picture would point at a test site that closes after a day. There the card
 * also ignores awards already saved, so a tester sees it once per browser.
 * Production is recognised by its App Engine version name in the address.
 */
/**
 * The redesigned Editor and Cell Completion ladders (Ames 2026-11-02) are on a GM test site only.
 * Anywhere but the production site they save no badge_awards row and post no chat line: those
 * sites read and write the live database, and the server still checks the live ladder. Saved
 * awards are ignored there too, because their ids belong to the live ladder (the new ones start
 * at 1001 and 1101), so a tester's case shows what their counts earn on the new ladder.
 */
export const ACHIEVEMENT_TEST_ONLY = typeof location !== 'undefined' && !location.hostname.startsWith('eyewire-ii-community-dot-');
const testTrack = (track: string) => ACHIEVEMENT_TEST_ONLY && (track === 'building' || track === 'exploration');
export { testTrack as achievementTestTrack };
export const LOYALTY_TEST_ONLY = typeof location !== 'undefined' && !location.hostname.startsWith('eyewire-ii-community-dot-');
const LOYALTY_DRAFTS: BadgeDefinition[] = [
  loyalty(1,  2, 'second-spark',   'SS', 'Day Two',   "Day 2! We're glad you came back :)"),
  loyalty(2,  3, 'third-light',    'TL', 'Day Three',    'Three days of science! You are on a roll.'),
  loyalty(3,  5, 'growing-signal', 'GS', 'Five Days', 'Five days for science!'),
  loyalty(4,  7, 'first-orbit',    'FO', 'One Week',    'Seven days of mapping the brain! That is a whole week of science.'),
  loyalty(5, 14, 'double-orbit',   'DO', 'Two Weeks',   'Fourteen days at Pyr! Two weeks of discoveries.'),
  loyalty(6, 21, 'steady-signal',  'ST', 'Three Weeks',  'Three cheers for three weeks of citizen science!'),
  loyalty(7, 28, 'constellation',  'CO', 'One Month',  "We're fourtunate that you have been helping to advance neuroscience for 4 weeks!"),
  // No separate One Month (Ames 2026-10-08: "4 weeks is one month yet there are 2"):
  // the 28 day achievement is One Month. Id 208 ('one-month') is retired and not reused; its
  // art is now Two Months' (deep-orbit.png).
  // Added 2026-10-06 with the second set of art. The first line is Ames's own;
  // the rest are first drafts, to be reviewed (she asked for a text review).
  loyalty(9,   40, 'golden-orbit',        'GO', 'Forty Days',        'Forty days at Pyr! A whole month of showing up for science. You are becoming a legend.'),
  loyalty(10,  50, 'celestial-compass',   'CC', 'Fifty Days',   'Fifty days of science! You always find your way back.'),
  loyalty(11,  60, 'deep-orbit',          'DP', 'Two Months',          'Sixty days at Pyr! Two months of discoveries.'),
  loyalty(12,  70, 'star-weaver',         'SW', 'Ten Weeks',         'Seventy days of science! Thank you for weaving your days into the map of the brain.'),
  loyalty(13,  80, 'amethyst-crown',      'AC', 'Eighty Days',      'Eighty days at Pyr! Thank you for every single one.'),
  loyalty(14,  90, 'radiant-return',      'RR', 'Three Months',      'Ninety days of science! Three months of coming back, and we are glad every time.'),
  loyalty(15, 100, 'century-star',        'CS', 'One Hundred Days',        'One hundred days at Pyr! That is royal dedication.'),
  // Past 100 days: one a month (Celia, Ames 2026-10-07), with 200 kept as a
  // hundred day milestone beside 100 and 300. The art is the existing set,
  // each piece moved to the nearest new day; ids and slugs are unchanged, so
  // an award saved on 2026-10-06 still means the same picture. The 350 day
  // achievement (id 225, 'yearward') is retired and its id is not reused.
  loyalty(16, 120, 'celestial-bloom',     'CB', 'Four Months',        '120 days of science! Four months, and your dedication keeps growing.'),
  loyalty(17, 150, 'constellation-crown', 'CN', 'Five Months',        '150 days at Pyr! You are a guiding light for this community.'),
  loyalty(18, 180, 'astral-engine',       'AE', 'Six Months',         '180 days of science! Half a year, and you help power this whole project.'),
  loyalty(19, 200, 'twin-century',        'TC', 'Two Hundred Days',   'Two hundred days at Pyr! Double the century, double the cheers.'),
  loyalty(20, 210, 'nebula-heart',        'NH', 'Seven Months',       '210 days of science! You are at the heart of Pyr.'),
  loyalty(21, 240, 'gilded-galaxy',       'GG', 'Eight Months',       '240 days at Pyr! That is a galaxy of good work.'),
  loyalty(22, 270, 'astral-crown',        'AS', 'Nine Months',        '270 days of science! Few have come this far.'),
  loyalty(23, 300, 'three-hundred-suns',  'TS', 'Three Hundred Days', 'Three hundred days at Pyr! Three hundred sunrises of science.'),
  loyalty(24, 330, 'everstar',            'EV', 'Eleven Months',      '330 days of science! Your star never fades, and a full year is in sight.'),
  loyalty(26, 365, 'the-constant',        'TH', 'One Year',           '365 days at Pyr! A whole year of science. You are a legend.'),
];

export const LOYALTY_BADGES: BadgeDefinition[] = LOYALTY_ENABLED ? LOYALTY_DRAFTS : [];

/**
 * Legacy Achievements (Ames 2026-11-02): the Editor and Cell Completion ladder as it was before the
 * redesign, ids 1 to 200, with its own art (center-art/legacy-building, legacy-exploration). The
 * Trophy Case shows each one a player saved in badge_awards or had reached by its old number, so
 * nothing anyone earned is lost. Written as legacy(...) so the server's table is only the new ladder.
 */
const legacy = (id: number, track: 'building' | 'exploration', sequence: number, slug: string, code: string, name: string, description: string, threshold: number): BadgeDefinition =>
  ({ id, track, sequence, slug, code, name, description, imageKey: `legacy-${track}/${slug}`, threshold, editThreshold: threshold });
export const LEGACY_BADGES: BadgeDefinition[] = [
  legacy(1, 'building', 1, 'battery', 'BAT', 'Battery', 'Your first edit! Powered up and ready to go.', 1),
  legacy(2, 'building', 2, 'stylus', 'STY', 'Stylus', 'Ten edits! Your stylus game is strong.', 10),
  legacy(3, 'building', 3, 'twine', 'TWI', 'Twine', 'Tying up loose ends, one merge at a time.', 25),
  legacy(4, 'building', 4, 'glue', 'GL', 'Glue', 'Sticking with it! 50 edits and counting.', 50),
  legacy(5, 'building', 5, 'mallet', 'MAL', 'Mallet', 'One hundred edits! Hammer time... almost.', 100),
  legacy(6, 'building', 6, 'awl', 'AWL', 'Awl', 'Awl in a day\'s work.', 200),
  legacy(7, 'building', 7, 'hammer', 'HAM', 'Hammer', 'Nailed it. Well, hammered it.', 300),
  legacy(8, 'building', 8, 'chisel', 'CHI', 'Chisel', 'Chiseled to perfection. Like your neurons.', 400),
  legacy(9, 'building', 9, 'wrench', 'WRE', 'Wrench', 'No wrench in your plans. Smooth sailing.', 500),
  legacy(10, 'building', 10, 'screwdriver', 'SCR', 'Screwdriver', 'Righty tighty, lefty loosey, edits fixy.', 750),
  legacy(11, 'building', 11, 'axe', 'AXE', 'Axe', 'One thousand edits! Chopping through like a lumberjack.', 1_000),
  legacy(12, 'building', 12, 'nail', 'NAI', 'Nail', 'You nailed it. Again. And again.', 1_500),
  legacy(13, 'building', 13, 'bolt', 'BOL', 'Bolt', 'Lightning bolt or hardware bolt? Both, really.', 2_000),
  legacy(14, 'building', 14, 'nut', 'NUT', 'Nut', 'You\'re nuts about proofreading. We love it.', 2_500),
  legacy(15, 'building', 15, 'rope', 'ROP', 'Rope', 'Learning the ropes? You mastered them.', 3_000),
  legacy(16, 'building', 16, 'bucket', 'BUC', 'Bucket', 'Edits by the bucketful.', 3_500),
  legacy(17, 'building', 17, 'trowel', 'TRO', 'Trowel', 'Smoothing things over like a pro.', 4_000),
  legacy(18, 'building', 18, 'shovel', 'SHO', 'Shovel', 'Digging deeper than ever.', 4_500),
  legacy(19, 'building', 19, 'pick-axe', 'PA', 'Pick Axe', 'Mining for neurons. Strike gold!', 5_000),
  legacy(20, 'building', 20, 'ladder', 'LAD', 'Ladder', 'Climbing the ladder of success, rung by rung.', 6_000),
  legacy(21, 'building', 21, 'wheelbarrow', 'WHE', 'Wheelbarrow', 'Hauling edits by the wheelbarrow load.', 7_000),
  legacy(22, 'building', 22, 'saw', 'SAW', 'Saw', 'I came, I saw, I cut.', 8_000),
  legacy(23, 'building', 23, 'hand-plane', 'HP', 'Hand Plane', 'Smooth as butter, flat as a pancake.', 9_000),
  legacy(24, 'building', 24, 'spokeshave', 'SPO', 'Spokeshave', 'Ten thousand edits! Spoke too soon? Never.', 10_000),
  legacy(25, 'building', 25, 'file', 'FIL', 'File', 'Filed under: amazing.', 12_000),
  legacy(26, 'building', 26, 'rasp', 'RAS', 'Rasp', 'Rasp-berry? No, rasp. Still sweet though.', 14_000),
  legacy(27, 'building', 27, 'clamp', 'CLA', 'Clamp', 'Holding it all together like a pro.', 16_000),
  legacy(28, 'building', 28, 'vise', 'VIS', 'Vise', 'Every vise has its virtue.', 18_000),
  legacy(29, 'building', 29, 'tape-measure', 'TM', 'Tape Measure', 'Measuring up nicely.', 20_000),
  legacy(30, 'building', 30, 't-square', 'TS', 'T-Square', 'Fair and square.', 25_000),
  legacy(31, 'building', 31, 'leveler', 'LEV', 'Leveler', 'Leveling up!', 30_000),
  legacy(32, 'building', 32, 'plumb-bob', 'PB', 'Plumb Bob', 'Plumb perfect. Thanks, Bob.', 35_000),
  legacy(33, 'building', 33, 'laser-leveler', 'LL', 'Laser Leveler', 'Laser precision. Leveling, but make it sci fi.', 40_000),
  legacy(34, 'building', 34, 'brick', 'BRI', 'Brick', 'You\'re a brick! That\'s a compliment, promise.', 45_000),
  legacy(35, 'building', 35, 'column', 'COL', 'Column', 'You\'re a pillar of the Pyr community.', 50_000),
  legacy(36, 'building', 36, 'arch', 'ARC', 'Arch', 'Arch you glad you kept going?', 55_000),
  legacy(37, 'building', 37, 'corbel', 'COR', 'Corbel', 'Corbel? Never heard of it. Still very supportive.', 60_000),
  legacy(38, 'building', 38, 'rafter', 'RAF', 'Rafter', 'Raising the roof! Literally.', 65_000),
  legacy(39, 'building', 39, 'dome', 'DOM', 'Dome', 'Dome sweet dome.', 70_000),
  legacy(40, 'building', 40, 'vault', 'VAU', 'Vault', 'Vaulting to new heights.', 75_000),
  legacy(41, 'building', 41, 'loom', 'LOO', 'Loom', 'A neuron weaver in the making.', 80_000),
  legacy(42, 'building', 42, 'kiln', 'KIL', 'Kiln', 'Kiln it! Fired up and baked to perfection.', 85_000),
  legacy(43, 'building', 43, 'bellows', 'BEL', 'Bellows', 'Fanning the flames of science.', 90_000),
  legacy(44, 'building', 44, 'anvil', 'ANV', 'Anvil', 'Hitting the anvil like a cartoon coyote.', 95_000),
  legacy(45, 'building', 45, 'forge', 'FOR', 'Forge', 'One hundred thousand edits! Legend, forged in fire.', 100_000),
  legacy(46, 'building', 46, 'catapult', 'CAT', 'Catapult', 'Catapulting into the science stratosphere.', 110_000),
  legacy(47, 'building', 47, 'ox-drawn-plow', 'ODP', 'Ox-drawn Plow', 'Strong as an ox. Patient as one too.', 120_000),
  legacy(48, 'building', 48, 'pulley', 'PUL', 'Pulley', 'Pulling your weight and then some.', 130_000),
  legacy(49, 'building', 49, 'piston', 'PIS', 'Piston', 'Pumped up and pumping out edits.', 140_000),
  legacy(50, 'building', 50, 'actuator', 'ACT', 'Actuator', 'Getting things moving since day one.', 150_000),
  legacy(51, 'building', 51, 'electric-drill', 'ED', 'Electric Drill', 'Drilling down into the details.', 160_000),
  legacy(52, 'building', 52, 'hand-drill', 'HD', 'Hand Drill', 'Old school, still cool.', 170_000),
  legacy(53, 'building', 53, 'hot-glue-gun', 'HGG', 'Hot Glue Gun', 'Hot glue fixes everything. So do you.', 180_000),
  legacy(54, 'building', 54, 'welding-torch', 'WT', 'Welding Torch', 'Fused to perfection. Sparks flying!', 190_000),
  legacy(55, 'building', 55, 'rivet-gun', 'RG', 'Rivet Gun', 'Riveting work, truly.', 200_000),
  legacy(56, 'building', 56, 'workbench', 'WOR', 'Workbench', 'Your workbench has seen some things.', 210_000),
  legacy(57, 'building', 57, 'component-organizer', 'CO', 'Component Organizer', 'Marie Kondo would be proud.', 220_000),
  legacy(58, 'building', 58, 'pcb-etching-kit', 'PE', 'PCB Etching Kit', 'Etched in history.', 230_000),
  legacy(59, 'building', 59, 'breadboard', 'BRE', 'Breadboard', 'No bread, just circuits. Disappointing for lunch.', 240_000),
  legacy(60, 'building', 60, 'jumper-wires', 'JW', 'Jumper Wires', 'Jumping to connections, not conclusions.', 250_000),
  legacy(61, 'building', 61, 'wire-strippers', 'WS', 'Wire Strippers', 'Getting down to the bare wires.', 260_000),
  legacy(62, 'building', 62, 'soldering-iron', 'SI', 'Soldering Iron', 'Soldered it! Hot stuff.', 270_000),
  legacy(63, 'building', 63, 'heat-shrink-tubing', 'HST', 'Heat Shrink Tubing', 'Things are shrinking, but your skills keep growing.', 280_000),
  legacy(64, 'building', 64, 'power-supply', 'PS', 'Power Supply', 'Unlimited power! Well, almost.', 290_000),
  legacy(65, 'building', 65, 'microcontroller', 'MIC', 'Microcontroller', 'A tiny brain running a tiny robot. Cute.', 300_000),
  legacy(66, 'building', 66, 'prototyping-shield', 'PS', 'Prototyping Shield', 'Shields up! Prototype mode engaged.', 310_000),
  legacy(67, 'building', 67, 'rasberry-pi', 'RP', 'Raspberry Pi', 'Mmm, pie. Not that kind.', 320_000),
  legacy(68, 'building', 68, 'leds', 'LED', 'LEDs', 'Light Emitting Dedication.', 330_000),
  legacy(69, 'building', 69, 'servo-motor', 'SM', 'Servo Motor', 'At your service-o.', 340_000),
  legacy(70, 'building', 70, 'stepper-motor', 'SM', 'Stepper Motor', 'Stepping it up a notch.', 350_000),
  legacy(71, 'building', 71, 'dc-motor', 'DM', 'DC Motor', 'Spinning up, can\'t stop now.', 360_000),
  legacy(72, 'building', 72, 'motor-driver', 'MD', 'Motor Driver', 'Who\'s driving this thing? You are.', 370_000),
  legacy(73, 'building', 73, 'wheel-and-tire-kit', 'WT', 'Wheel And Tire Kit', 'Wheels up! Rolling into the next edit.', 380_000),
  legacy(74, 'building', 74, 'ball-caster', 'BC', 'Ball Caster', 'Having a ball out here.', 390_000),
  legacy(75, 'building', 75, 'track-system', 'TRA', 'Track System', 'Back on track. Actually, you never left.', 400_000),
  legacy(76, 'building', 76, 'robot-chassis', 'RC', 'Robot Chassis', 'Nice chassis. Wanna build a robot?', 410_000),
  legacy(77, 'building', 77, 'claw', 'CLA', 'Claw', 'The claw has chosen you!', 420_000),
  legacy(78, 'building', 78, 'gripper-kit', 'GRI', 'Gripper Kit', 'Get a grip! Oh, you already have one.', 430_000),
  legacy(79, 'building', 79, 'robot-arm-kit', 'RA', 'Robot Arm Kit', 'Lending a robotic hand.', 440_000),
  legacy(80, 'building', 80, 'robotic-fabricator', 'RF', 'Robotic Fabricator', 'Robots making robots. What could go wrong?', 450_000),
  legacy(81, 'building', 81, '3d-printer', '3P', '3D Printer', 'Printing in three whole dimensions. Fancy.', 460_000),
  legacy(82, 'building', 82, 'filament-spool', 'FS', 'Filament Spool', 'Spooling up for the long haul.', 470_000),
  legacy(83, 'building', 83, 'resin-vat', 'RV', 'Resin Vat', 'Liquid to solid. That\'s some chemistry.', 480_000),
  legacy(84, 'building', 84, 'laser-cutter', 'LC', 'Laser Cutter', 'Cutting edge. Literally.', 490_000),
  legacy(85, 'building', 85, 'cnc-router', 'CR', 'CNC Router', 'Routed straight to greatness.', 500_000),
  legacy(86, 'building', 86, 'milling-machine', 'MM', 'Milling Machine', 'Not just run of the mill.', 510_000),
  legacy(87, 'building', 87, 'drill-press', 'DP', 'Drill Press', 'Pressing on!', 520_000),
  legacy(88, 'building', 88, 'bandsaw', 'BAN', 'Bandsaw', 'Started a band. Saw some success.', 530_000),
  legacy(89, 'building', 89, 'table-saw', 'TS', 'Table Saw', 'Table for one? Saw that coming.', 540_000),
  legacy(90, 'building', 90, 'lathe', 'LAT', 'Lathe', 'Spinning wood into wonders.', 550_000),
  legacy(91, 'building', 91, 'linear-rail', 'LR', 'Linear Rail', 'Straight to the point.', 560_000),
  legacy(92, 'building', 92, 'gearbox', 'GEA', 'Gearbox', 'Shifting into high gear.', 570_000),
  legacy(93, 'building', 93, 'carbon-fiber', 'CF', 'Carbon Fiber', 'Lightweight material, heavyweight results.', 580_000),
  legacy(94, 'building', 94, 'kevlar', 'KEV', 'Kevlar', 'Bulletproof dedication.', 590_000),
  legacy(95, 'building', 95, 'vacuum-tube', 'VT', 'Vacuum Tube', 'Retro tech for a timeless editor.', 600_000),
  legacy(96, 'building', 96, 'transistor', 'TRA', 'Transistor', 'Small switch, big impact. Sounds like you.', 610_000),
  legacy(97, 'building', 97, 'gantry-crane', 'GC', 'Gantry Crane', 'Heavy lifting? You make it look easy.', 620_000),
  legacy(98, 'building', 98, 'robotic-welder', 'RW', 'Robotic Welder', 'Sparks are flying. Must be love.', 630_000),
  legacy(99, 'building', 99, 'autonomous-assembly-cell', 'AAC', 'Autonomous Assembly Cell', 'It builds itself. Kind of like your edit count.', 640_000),
  legacy(100, 'building', 100, 'microfactory', 'MIC', 'Microfactory', '650,000 edits. You ARE the factory.', 650_000),
  legacy(101, 'exploration', 1, 'scroll', 'SCR', 'Scroll', 'Your first cell! Better jot this one down.', 1),
  legacy(102, 'exploration', 2, 'pencil', 'PEN', 'Pencil', 'The pencil is mightier than the swordcil.', 5),
  legacy(103, 'exploration', 3, 'ink', 'INK', 'Ink', 'Ten cells!! Maybe their branches will give you some calligraphic inspo.', 10),
  legacy(104, 'exploration', 4, 'fountain-pen', 'FP', 'Fountain Pen', 'You\'re a science boss! This will look great on your desk.', 15),
  legacy(105, 'exploration', 5, 'lab-notebook', 'LN', 'Lab Notebook', 'Dear diary, today I completed 20 cells!', 20),
  legacy(106, 'exploration', 6, 'abacus', 'ABA', 'Abacus', 'Ancient peoples used these to count their completed neurons! Probably!', 30),
  legacy(107, 'exploration', 7, 'map', 'MAP', 'Map', 'The GPS of physical media.', 40),
  legacy(108, 'exploration', 8, 'compass', 'COM', 'Compass', '50 cells! What a feat! Take this tool to help you navigate them all.', 50),
  legacy(109, 'exploration', 9, 'cairn', 'CAI', 'Cairn', 'Stone by stone, you mark the trail for others.', 75),
  legacy(110, 'exploration', 10, 'sextant', 'SEX', 'Reflecting Circle', 'One hundred cells! You\'ve found your bearings.', 100),
  legacy(111, 'exploration', 11, 'astrolabe', 'AST', 'Astrolabe', 'Sailors read the stars. You, Captain, read neurons.', 125),
  legacy(112, 'exploration', 12, 'sundial', 'SUN', 'Sundial', 'The sun may be setting, but I need to finish just one more cell.', 150),
  legacy(113, 'exploration', 13, 'globe', 'GLO', 'Globe', '200 cells! Our international citsci community salutes you!', 200),
  legacy(114, 'exploration', 14, 'star-chart', 'SC', 'Star Chart', 'Every finished cell is a new star on the chart.', 250),
  legacy(115, 'exploration', 15, 'magnifying-glass', 'MG', 'Magnifying Glass', 'Elementary, my dear citizen scientist!', 300),
  legacy(116, 'exploration', 16, 'fresnel-lens', 'FL', 'Fresnel Lens', 'Illuminating your path forward, lighthouse style!', 350),
  legacy(117, 'exploration', 17, 'telescope', 'TEL', 'Telescope', 'Stars are like the neurons of the sky.', 400),
  legacy(118, 'exploration', 18, 'binoculars', 'BIN', 'Binoculars', 'Two eyes on the prize. Also great for bird watching.', 450),
  legacy(119, 'exploration', 19, 'periscope', 'PER', 'Periscope', 'Up periscope! Spotted: one more finished cell.', 500),
  legacy(120, 'exploration', 20, 'barometer', 'BAR', 'Barometer', 'Pressure\'s rising. So is your cell count.', 600),
  legacy(121, 'exploration', 21, 'thermometer', 'THE', 'Thermometer', 'Your cell count is officially running a fever.', 700),
  legacy(122, 'exploration', 22, 'hygrometer', 'HYG', 'Hygrometer', 'Measures humidity. Also how hard you sweat over cells.', 800),
  legacy(123, 'exploration', 23, 'altimeter', 'ALT', 'Altimeter', 'Altitude check: still climbing, captain.', 900),
  legacy(124, 'exploration', 24, 'depth-gauge', 'DG', 'Depth Gauge', 'One thousand cells! You\'re in deep now.', 1_000),
  legacy(125, 'exploration', 25, 'gyroscope', 'GYR', 'Gyroscope', 'Your head may be spinning, but you stay balanced.', 1_100),
  legacy(126, 'exploration', 26, 'accelerometer', 'ACC', 'Accelerometer', 'Whoa, slow down! Actually, never mind. Keep going.', 1_200),
  legacy(127, 'exploration', 27, 'multimeter', 'MUL', 'Multimeter', 'Tested and confirmed: you are fully charged.', 1_300),
  legacy(128, 'exploration', 28, 'oscilloscope', 'OSC', 'Oscilloscope', 'Your brain waves look great. We checked.', 1_400),
  legacy(129, 'exploration', 29, 'logic-analyzer', 'LA', 'Logic Analyzer', 'Logically, the next step is another cell.', 1_500),
  legacy(130, 'exploration', 30, 'digital-caliper', 'DC', 'Digital Caliper', 'Measured precisely: you\'re doing great.', 1_600),
  legacy(131, 'exploration', 31, 'compound-microscope', 'CM', 'Compound Microscope', 'Zooming in on your greatness.', 1_700),
  legacy(132, 'exploration', 32, 'electron-microscope', 'EM', 'Electron Microscope', 'The very kind of microscope that took these pictures!', 1_800),
  legacy(133, 'exploration', 33, 'tomography', 'TOM', 'Tomography', 'Slice, slice, baby.', 1_900),
  legacy(134, 'exploration', 34, 'ultramicrotome', 'UM', 'Ultramicrotome', 'Your work is cutting edge.', 2_000),
  legacy(135, 'exploration', 35, 'pipette', 'PIP', 'Pipette', 'A drop in the bucket? Not you.', 2_250),
  legacy(136, 'exploration', 36, 'test-tube', 'TT', 'Test Tube', 'Test results are in: you\'re a natural.', 2_500),
  legacy(137, 'exploration', 37, 'petri-dish', 'PD', 'Petri Dish', 'Your skills are growing faster than mold in here.', 2_750),
  legacy(138, 'exploration', 38, 'centrifuge', 'CEN', 'Centrifuge', 'Spinning out cells faster than ever.', 3_000),
  legacy(139, 'exploration', 39, 'spectrometer', 'SPE', 'Spectrometer', 'Shining in every color of the spectrum.', 3_250),
  legacy(140, 'exploration', 40, 'chromatograph', 'CHR', 'Chromatograph', 'Separating the great from the good. You\'re great.', 3_500),
  legacy(141, 'exploration', 41, 'seismograph', 'SEI', 'Seismograph', 'Earthquake detected. Oh wait, that\'s just you.', 3_750),
  legacy(142, 'exploration', 42, 'geiger-counter', 'GC', 'Geiger Counter', 'Warning: radioactive levels of dedication.', 4_000),
  legacy(143, 'exploration', 43, 'magnetometer', 'MAG', 'Magnetometer', 'You have a magnetic personality.', 4_250),
  legacy(144, 'exploration', 44, 'gravimeter', 'GRA', 'Gravimeter', 'Your work carries some serious weight.', 4_500),
  legacy(145, 'exploration', 45, 'lidar', 'LID', 'LiDAR', 'Pew pew! Lasers make everything cooler.', 4_750),
  legacy(146, 'exploration', 46, 'ultrasonic-sensor', 'US', 'Ultrasonic Sensor', 'Bats use this trick too. You\'re batty for cells.', 5_000),
  legacy(147, 'exploration', 47, 'infrared-sensor', 'IS', 'Infrared Sensor', 'Things are heating up!', 5_500),
  legacy(148, 'exploration', 48, 'touch-sensor', 'TS', 'Touch Sensor', 'You\'ve got the magic touch.', 6_000),
  legacy(149, 'exploration', 49, 'camera-module', 'CM', 'Camera Module', 'Say cheese! Another cell for the album.', 6_500),
  legacy(150, 'exploration', 50, 'thermal-camera', 'TC', 'Thermal Camera', 'Spotted: one very hot streak.', 7_000),
  legacy(151, 'exploration', 51, 'hyperspectral-camera', 'HC', 'Hyperspectral Camera', 'Seeing colors your eyes haven\'t met yet.', 7_500),
  legacy(152, 'exploration', 52, 'wi-fi-module', 'WFM', 'Wi-Fi Module', 'Full bars. Your connection to science is strong.', 8_000),
  legacy(153, 'exploration', 53, 'gps-receiver', 'GR', 'GPS Receiver', 'Recalculating... nope, you\'re right on course.', 8_500),
  legacy(154, 'exploration', 54, 'ros', 'ROS', 'ROS', 'The operating system robots dream about.', 9_000),
  legacy(155, 'exploration', 55, 'quadruped-robot', 'QR', 'Quadruped Robot', 'Four legs, zero tail wags, endless loyalty.', 9_500),
  legacy(156, 'exploration', 56, 'drone', 'DRO', 'Drone', 'Ten thousand cells! The view from up here is buzzing.', 10_000),
  legacy(157, 'exploration', 57, 'rover', 'ROV', 'Rover', 'Roving where no rover has roved before.', 11_000),
  legacy(158, 'exploration', 58, 'autonomous-underwater-vehicle-auv', 'AUV', 'Autonomous Underwater Vehicle (AUV)', 'Diving deep, no snorkel needed.', 12_000),
  legacy(159, 'exploration', 59, 'hydrophone', 'HYD', 'Hydrophone', 'Whale hello there!', 13_000),
  legacy(160, 'exploration', 60, 'sonar-array', 'SA', 'Sonar Array', 'Ping! Something big down there. It\'s your cell count.', 14_000),
  legacy(161, 'exploration', 61, 'radar-dish', 'RD', 'Radar Dish', 'You\'re on our radar now.', 15_000),
  legacy(162, 'exploration', 62, 'weather-balloon', 'WB', 'Weather Balloon', 'Forecast: 100 percent chance of more cells.', 16_000),
  legacy(163, 'exploration', 63, 'satellite', 'SAT', 'Satellite', 'Houston, we have a top scientist.', 17_000),
  legacy(164, 'exploration', 64, 'cubesat', 'CUB', 'CubeSat', 'Small satellite, big ambitions. Sounds familiar.', 18_000),
  legacy(165, 'exploration', 65, 'star-tracker', 'ST', 'Star Tracker', 'You\'re a star. This thing would know.', 19_000),
  legacy(166, 'exploration', 66, 'probe', 'PRO', 'Probe', 'Probing the mysteries of the brain.', 20_000),
  legacy(167, 'exploration', 67, 'cpu', 'CPU', 'CPU', 'Processing... processing... yep, you\'re awesome.', 21_000),
  legacy(168, 'exploration', 68, 'gpu', 'GPU', 'GPU', 'Rendering your greatness in high definition.', 22_000),
  legacy(169, 'exploration', 69, 'keyboard', 'KEY', 'Keyboard', 'Your keyboard has seen things.', 23_000),
  legacy(170, 'exploration', 70, 'mouse', 'MOU', 'Mouse', 'Not that kind of mouse. Though we map those too!', 24_000),
  legacy(171, 'exploration', 71, 'monitor', 'MON', 'Monitor', 'Staring at screens, but make it science.', 25_000),
  legacy(172, 'exploration', 72, 'server', 'SER', 'Server', 'Serving up cells, hot and fresh.', 26_000),
  legacy(173, 'exploration', 73, 'cloud', 'CLO', 'Cloud', 'Your head is in the cloud. Your data too.', 27_000),
  legacy(174, 'exploration', 74, 'storage', 'STO', 'Storage', 'We\'re going to need a bigger hard drive.', 28_000),
  legacy(175, 'exploration', 75, 'spare-memory', 'SM', 'Spare Memory', 'You\'ll never forget this one.', 29_000),
  legacy(176, 'exploration', 76, 'bit-to-petabyte', 'BP', 'Bit To Petabyte', 'A petabyte of brain, and you\'ve seen a good chunk.', 30_000),
  legacy(177, 'exploration', 77, 'computing-cluster', 'CC', 'Computing Cluster', 'Many machines, one mission: keep up with you.', 31_000),
  legacy(178, 'exploration', 78, 'artificial-intelligence-ai-processor', 'AIA', 'Artificial Intelligence (AI) Processor', 'AI is learning from you. Teach it well.', 32_000),
  legacy(179, 'exploration', 79, 'machine-learning-kit-for-robots', 'MLR', 'Machine Learning Kit For Robots', 'Robots study your work. You\'re their favorite teacher.', 33_000),
  legacy(180, 'exploration', 80, 'haptic-feedback-system', 'HF', 'Haptic Feedback System', 'Good vibrations only.', 34_000),
  legacy(181, 'exploration', 81, 'robotic-exoskeleton', 'RE', 'Robotic Exoskeleton', 'Super suit unlocked. Cape not included.', 35_000),
  legacy(182, 'exploration', 82, 'flexible-electronic-skin-e-skin', 'FES', 'Flexible Electronic Skin (e-skin)', 'Thick skinned? Nope, just electronic.', 36_000),
  legacy(183, 'exploration', 83, 'biosensor', 'BIO', 'Biosensor', 'Sensing a lot of talent around here.', 37_000),
  legacy(184, 'exploration', 84, 'quantum-sensor', 'QS', 'Quantum Sensor', 'Sensitive enough to feel your enthusiasm.', 38_000),
  legacy(185, 'exploration', 85, 'advanced-lidar-system', 'AL', 'Advanced LiDAR System', 'Lasers, but even fancier.', 39_000),
  legacy(186, 'exploration', 86, 'microbot-swarm', 'MS', 'Microbot Swarm', 'Tiny robots teaming up. Just like Pyr players.', 40_000),
  legacy(187, 'exploration', 87, 'dna-nanotechnology', 'DN', 'DNA Nanotechnology', 'Folding DNA into tiny origami. Neat!', 41_000),
  legacy(188, 'exploration', 88, 'gene-sequencer', 'GS', 'Gene Sequencer', 'Your genes say: born to proofread.', 42_000),
  legacy(189, 'exploration', 89, 'nanoscope', 'NAN', 'Nanoscope', 'Seeing the tiniest things. Size isn\'t everything.', 43_000),
  legacy(190, 'exploration', 90, 'particle-detector', 'PD', 'Particle Detector', 'Detected: one exceptional particle. It\'s you.', 44_000),
  legacy(191, 'exploration', 91, 'quantum-computer', 'QC', 'Quantum Computer', 'Are you done or not done? Yes.', 45_000),
  legacy(192, 'exploration', 92, 'fusion-test-chamber', 'FTC', 'Fusion Test Chamber', 'Your energy could power a small star.', 46_000),
  legacy(193, 'exploration', 93, 'neutrino-detector', 'ND', 'Neutrino Detector', 'Catching ghost particles. Spooky science!', 47_000),
  legacy(194, 'exploration', 94, 'deep-sea-observatory', 'DSO', 'Deep Sea Observatory', 'Things get weird down here. You fit right in.', 48_000),
  legacy(195, 'exploration', 95, 'orbital-telescope', 'OT', 'Orbital Telescope', 'Out of this world work.', 49_000),
  legacy(196, 'exploration', 96, 'planetary-lander', 'PL', 'Planetary Lander', 'The eagle has landed, on a planet of cells.', 50_000),
  legacy(197, 'exploration', 97, 'swarm-drone-beacon', 'SDB', 'Swarm Drone Beacon', 'Calling all drones. We\'ve found a leader.', 51_000),
  legacy(198, 'exploration', 98, 'exoplanet-imager', 'EI', 'Exoplanet Imager', 'Spotting planets light years away. Legendary vision.', 52_000),
  legacy(199, 'exploration', 99, 'dark-matter-array', 'DMA', 'Dark Matter Array', 'Hunting for what no one can see. You\'d find it.', 53_000),
  legacy(200, 'exploration', 100, 'interstellar-probe', 'IP', 'Interstellar Probe', 'To infinity, and beyond! You did it all.', 54_000),
];

/** Every achievement: building, then exploration, then loyalty. */
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  ...BUILDING_BADGES,
  ...EXPLORATION_BADGES,
  ...LOYALTY_BADGES,
];

/** What a track's threshold counts, for "N <unit>" labels. */
export function unitForTrack(track: BadgeTrack, n = 2): string {
  return track === 'building' ? 'edits' : track === 'loyalty' ? (n === 1 ? 'day of science' : 'days of science') : 'cells completed';
}

/** Helper: get badges for a specific track. */
export function badgesForTrack(track: BadgeTrack): BadgeDefinition[] {
  return track === 'building' ? BUILDING_BADGES : track === 'loyalty' ? LOYALTY_BADGES : EXPLORATION_BADGES;
}

/** Helper: get the stat key to check for a given track. */
export function statKeyForTrack(track: BadgeTrack): 'editsAllTime' | 'cellsSubmitted' | 'totalDays' {
  return track === 'building' ? 'editsAllTime' : track === 'loyalty' ? 'totalDays' : 'cellsSubmitted';
}
