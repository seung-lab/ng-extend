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
  { id: 1, track: 'building', sequence: 1, slug: 'battery', code: 'BAT', name: 'Battery', description: 'Your first edit! Powered up and ready to go.', imageKey: 'building/battery', threshold: 1, editThreshold: 1 },
  { id: 2, track: 'building', sequence: 2, slug: 'stylus', code: 'STY', name: 'Stylus', description: 'Ten edits! Your stylus game is strong.', imageKey: 'building/stylus', threshold: 10, editThreshold: 10 },
  { id: 3, track: 'building', sequence: 3, slug: 'twine', code: 'TWI', name: 'Twine', description: 'Tying up loose ends, one merge at a time.', imageKey: 'building/twine', threshold: 25, editThreshold: 25 },
  { id: 4, track: 'building', sequence: 4, slug: 'glue', code: 'GL', name: 'Glue', description: 'Sticking with it! 50 edits and counting.', imageKey: 'building/glue', threshold: 50, editThreshold: 50 },
  { id: 5, track: 'building', sequence: 5, slug: 'mallet', code: 'MAL', name: 'Mallet', description: 'One hundred edits! Hammer time... almost.', imageKey: 'building/mallet', threshold: 100, editThreshold: 100 },
  { id: 6, track: 'building', sequence: 6, slug: 'awl', code: 'AWL', name: 'Awl', description: 'Awl in a day\'s work.', imageKey: 'building/awl', threshold: 200, editThreshold: 200 },
  { id: 7, track: 'building', sequence: 7, slug: 'hammer', code: 'HAM', name: 'Hammer', description: 'Nailed it. Well, hammered it.', imageKey: 'building/hammer', threshold: 300, editThreshold: 300 },
  { id: 8, track: 'building', sequence: 8, slug: 'chisel', code: 'CHI', name: 'Chisel', description: 'Chiseled to perfection. Like your neurons.', imageKey: 'building/chisel', threshold: 400, editThreshold: 400 },
  { id: 9, track: 'building', sequence: 9, slug: 'wrench', code: 'WRE', name: 'Wrench', description: 'No wrench in your plans. Smooth sailing.', imageKey: 'building/wrench', threshold: 500, editThreshold: 500 },
  { id: 10, track: 'building', sequence: 10, slug: 'screwdriver', code: 'SCR', name: 'Screwdriver', description: 'Righty tighty, lefty loosey, edits fixy.', imageKey: 'building/screwdriver', threshold: 750, editThreshold: 750 },
  { id: 11, track: 'building', sequence: 11, slug: 'axe', code: 'AXE', name: 'Axe', description: 'One thousand edits! Chopping through like a lumberjack.', imageKey: 'building/axe', threshold: 1_000, editThreshold: 1_000 },
  { id: 12, track: 'building', sequence: 12, slug: 'nail', code: 'NAI', name: 'Nail', description: 'You nailed it. Again. And again.', imageKey: 'building/nail', threshold: 1_500, editThreshold: 1_500 },
  { id: 13, track: 'building', sequence: 13, slug: 'bolt', code: 'BOL', name: 'Bolt', description: 'Lightning bolt or hardware bolt? Both, really.', imageKey: 'building/bolt', threshold: 2_000, editThreshold: 2_000 },
  { id: 14, track: 'building', sequence: 14, slug: 'nut', code: 'NUT', name: 'Nut', description: 'You\'re nuts about proofreading. We love it.', imageKey: 'building/nut', threshold: 2_500, editThreshold: 2_500 },
  { id: 15, track: 'building', sequence: 15, slug: 'rope', code: 'ROP', name: 'Rope', description: 'Learning the ropes? You mastered them.', imageKey: 'building/rope', threshold: 3_000, editThreshold: 3_000 },
  { id: 16, track: 'building', sequence: 16, slug: 'bucket', code: 'BUC', name: 'Bucket', description: 'Edits by the bucketful.', imageKey: 'building/bucket', threshold: 3_500, editThreshold: 3_500 },
  { id: 17, track: 'building', sequence: 17, slug: 'trowel', code: 'TRO', name: 'Trowel', description: 'Smoothing things over like a pro.', imageKey: 'building/trowel', threshold: 4_000, editThreshold: 4_000 },
  { id: 18, track: 'building', sequence: 18, slug: 'shovel', code: 'SHO', name: 'Shovel', description: 'Digging deeper than ever.', imageKey: 'building/shovel', threshold: 4_500, editThreshold: 4_500 },
  { id: 19, track: 'building', sequence: 19, slug: 'pick-axe', code: 'PA', name: 'Pick Axe', description: 'Mining for neurons. Strike gold!', imageKey: 'building/pick-axe', threshold: 5_000, editThreshold: 5_000 },
  { id: 20, track: 'building', sequence: 20, slug: 'ladder', code: 'LAD', name: 'Ladder', description: 'Climbing the ladder of success, rung by rung.', imageKey: 'building/ladder', threshold: 6_000, editThreshold: 6_000 },
  { id: 21, track: 'building', sequence: 21, slug: 'wheelbarrow', code: 'WHE', name: 'Wheelbarrow', description: 'Hauling edits by the wheelbarrow load.', imageKey: 'building/wheelbarrow', threshold: 7_000, editThreshold: 7_000 },
  { id: 22, track: 'building', sequence: 22, slug: 'saw', code: 'SAW', name: 'Saw', description: 'I came, I saw, I cut.', imageKey: 'building/saw', threshold: 8_000, editThreshold: 8_000 },
  { id: 23, track: 'building', sequence: 23, slug: 'hand-plane', code: 'HP', name: 'Hand Plane', description: 'Smooth as butter, flat as a pancake.', imageKey: 'building/hand-plane', threshold: 9_000, editThreshold: 9_000 },
  { id: 24, track: 'building', sequence: 24, slug: 'spokeshave', code: 'SPO', name: 'Spokeshave', description: 'Ten thousand edits! Spoke too soon? Never.', imageKey: 'building/spokeshave', threshold: 10_000, editThreshold: 10_000 },
  { id: 25, track: 'building', sequence: 25, slug: 'file', code: 'FIL', name: 'File', description: 'Filed under: amazing.', imageKey: 'building/file', threshold: 12_000, editThreshold: 12_000 },
  { id: 26, track: 'building', sequence: 26, slug: 'rasp', code: 'RAS', name: 'Rasp', description: 'Rasp-berry? No, rasp. Still sweet though.', imageKey: 'building/rasp', threshold: 14_000, editThreshold: 14_000 },
  { id: 27, track: 'building', sequence: 27, slug: 'clamp', code: 'CLA', name: 'Clamp', description: 'Holding it all together like a pro.', imageKey: 'building/clamp', threshold: 16_000, editThreshold: 16_000 },
  { id: 28, track: 'building', sequence: 28, slug: 'vise', code: 'VIS', name: 'Vise', description: 'Every vise has its virtue.', imageKey: 'building/vise', threshold: 18_000, editThreshold: 18_000 },
  { id: 29, track: 'building', sequence: 29, slug: 'tape-measure', code: 'TM', name: 'Tape Measure', description: 'Measuring up nicely.', imageKey: 'building/tape-measure', threshold: 20_000, editThreshold: 20_000 },
  { id: 30, track: 'building', sequence: 30, slug: 't-square', code: 'TS', name: 'T-Square', description: 'Fair and square.', imageKey: 'building/t-square', threshold: 25_000, editThreshold: 25_000 },
  { id: 31, track: 'building', sequence: 31, slug: 'leveler', code: 'LEV', name: 'Leveler', description: 'Leveling up!', imageKey: 'building/leveler', threshold: 30_000, editThreshold: 30_000 },
  { id: 32, track: 'building', sequence: 32, slug: 'plumb-bob', code: 'PB', name: 'Plumb Bob', description: 'Plumb perfect. Thanks, Bob.', imageKey: 'building/plumb-bob', threshold: 35_000, editThreshold: 35_000 },
  { id: 33, track: 'building', sequence: 33, slug: 'laser-leveler', code: 'LL', name: 'Laser Leveler', description: 'Laser precision. Leveling, but make it sci fi.', imageKey: 'building/laser-leveler', threshold: 40_000, editThreshold: 40_000 },
  { id: 34, track: 'building', sequence: 34, slug: 'brick', code: 'BRI', name: 'Brick', description: 'You\'re a brick! That\'s a compliment, promise.', imageKey: 'building/brick', threshold: 45_000, editThreshold: 45_000 },
  { id: 35, track: 'building', sequence: 35, slug: 'column', code: 'COL', name: 'Column', description: 'You\'re a pillar of the Pyr community.', imageKey: 'building/column', threshold: 50_000, editThreshold: 50_000 },
  { id: 36, track: 'building', sequence: 36, slug: 'arch', code: 'ARC', name: 'Arch', description: 'Arch you glad you kept going?', imageKey: 'building/arch', threshold: 55_000, editThreshold: 55_000 },
  { id: 37, track: 'building', sequence: 37, slug: 'corbel', code: 'COR', name: 'Corbel', description: 'Corbel? Never heard of it. Still very supportive.', imageKey: 'building/corbel', threshold: 60_000, editThreshold: 60_000 },
  { id: 38, track: 'building', sequence: 38, slug: 'rafter', code: 'RAF', name: 'Rafter', description: 'Raising the roof! Literally.', imageKey: 'building/rafter', threshold: 65_000, editThreshold: 65_000 },
  { id: 39, track: 'building', sequence: 39, slug: 'dome', code: 'DOM', name: 'Dome', description: 'Dome sweet dome.', imageKey: 'building/dome', threshold: 70_000, editThreshold: 70_000 },
  { id: 40, track: 'building', sequence: 40, slug: 'vault', code: 'VAU', name: 'Vault', description: 'Vaulting to new heights.', imageKey: 'building/vault', threshold: 75_000, editThreshold: 75_000 },
  { id: 41, track: 'building', sequence: 41, slug: 'loom', code: 'LOO', name: 'Loom', description: 'A neuron weaver in the making.', imageKey: 'building/loom', threshold: 80_000, editThreshold: 80_000 },
  { id: 42, track: 'building', sequence: 42, slug: 'kiln', code: 'KIL', name: 'Kiln', description: 'Kiln it! Fired up and baked to perfection.', imageKey: 'building/kiln', threshold: 85_000, editThreshold: 85_000 },
  { id: 43, track: 'building', sequence: 43, slug: 'bellows', code: 'BEL', name: 'Bellows', description: 'Fanning the flames of science.', imageKey: 'building/bellows', threshold: 90_000, editThreshold: 90_000 },
  { id: 44, track: 'building', sequence: 44, slug: 'anvil', code: 'ANV', name: 'Anvil', description: 'Hitting the anvil like a cartoon coyote.', imageKey: 'building/anvil', threshold: 95_000, editThreshold: 95_000 },
  { id: 45, track: 'building', sequence: 45, slug: 'forge', code: 'FOR', name: 'Forge', description: 'One hundred thousand edits! Legend, forged in fire.', imageKey: 'building/forge', threshold: 100_000, editThreshold: 100_000 },
  { id: 46, track: 'building', sequence: 46, slug: 'catapult', code: 'CAT', name: 'Catapult', description: 'Catapulting into the science stratosphere.', imageKey: 'building/catapult', threshold: 110_000, editThreshold: 110_000 },
  { id: 47, track: 'building', sequence: 47, slug: 'ox-drawn-plow', code: 'ODP', name: 'Ox-drawn Plow', description: 'Strong as an ox. Patient as one too.', imageKey: 'building/ox-drawn-plow', threshold: 120_000, editThreshold: 120_000 },
  { id: 48, track: 'building', sequence: 48, slug: 'pulley', code: 'PUL', name: 'Pulley', description: 'Pulling your weight and then some.', imageKey: 'building/pulley', threshold: 130_000, editThreshold: 130_000 },
  { id: 49, track: 'building', sequence: 49, slug: 'piston', code: 'PIS', name: 'Piston', description: 'Pumped up and pumping out edits.', imageKey: 'building/piston', threshold: 140_000, editThreshold: 140_000 },
  { id: 50, track: 'building', sequence: 50, slug: 'actuator', code: 'ACT', name: 'Actuator', description: 'Getting things moving since day one.', imageKey: 'building/actuator', threshold: 150_000, editThreshold: 150_000 },
  { id: 51, track: 'building', sequence: 51, slug: 'electric-drill', code: 'ED', name: 'Electric Drill', description: 'Drilling down into the details.', imageKey: 'building/electric-drill', threshold: 160_000, editThreshold: 160_000 },
  { id: 52, track: 'building', sequence: 52, slug: 'hand-drill', code: 'HD', name: 'Hand Drill', description: 'Old school, still cool.', imageKey: 'building/hand-drill', threshold: 170_000, editThreshold: 170_000 },
  { id: 53, track: 'building', sequence: 53, slug: 'hot-glue-gun', code: 'HGG', name: 'Hot Glue Gun', description: 'Hot glue fixes everything. So do you.', imageKey: 'building/hot-glue-gun', threshold: 180_000, editThreshold: 180_000 },
  { id: 54, track: 'building', sequence: 54, slug: 'welding-torch', code: 'WT', name: 'Welding Torch', description: 'Fused to perfection. Sparks flying!', imageKey: 'building/welding-torch', threshold: 190_000, editThreshold: 190_000 },
  { id: 55, track: 'building', sequence: 55, slug: 'rivet-gun', code: 'RG', name: 'Rivet Gun', description: 'Riveting work, truly.', imageKey: 'building/rivet-gun', threshold: 200_000, editThreshold: 200_000 },
  { id: 56, track: 'building', sequence: 56, slug: 'workbench', code: 'WOR', name: 'Workbench', description: 'Your workbench has seen some things.', imageKey: 'building/workbench', threshold: 210_000, editThreshold: 210_000 },
  { id: 57, track: 'building', sequence: 57, slug: 'component-organizer', code: 'CO', name: 'Component Organizer', description: 'Marie Kondo would be proud.', imageKey: 'building/component-organizer', threshold: 220_000, editThreshold: 220_000 },
  { id: 58, track: 'building', sequence: 58, slug: 'pcb-etching-kit', code: 'PE', name: 'PCB Etching Kit', description: 'Etched in history.', imageKey: 'building/pcb-etching-kit', threshold: 230_000, editThreshold: 230_000 },
  { id: 59, track: 'building', sequence: 59, slug: 'breadboard', code: 'BRE', name: 'Breadboard', description: 'No bread, just circuits. Disappointing for lunch.', imageKey: 'building/breadboard', threshold: 240_000, editThreshold: 240_000 },
  { id: 60, track: 'building', sequence: 60, slug: 'jumper-wires', code: 'JW', name: 'Jumper Wires', description: 'Jumping to connections, not conclusions.', imageKey: 'building/jumper-wires', threshold: 250_000, editThreshold: 250_000 },
  { id: 61, track: 'building', sequence: 61, slug: 'wire-strippers', code: 'WS', name: 'Wire Strippers', description: 'Getting down to the bare wires.', imageKey: 'building/wire-strippers', threshold: 260_000, editThreshold: 260_000 },
  { id: 62, track: 'building', sequence: 62, slug: 'soldering-iron', code: 'SI', name: 'Soldering Iron', description: 'Soldered it! Hot stuff.', imageKey: 'building/soldering-iron', threshold: 270_000, editThreshold: 270_000 },
  { id: 63, track: 'building', sequence: 63, slug: 'heat-shrink-tubing', code: 'HST', name: 'Heat Shrink Tubing', description: 'Things are shrinking, but your skills keep growing.', imageKey: 'building/heat-shrink-tubing', threshold: 280_000, editThreshold: 280_000 },
  { id: 64, track: 'building', sequence: 64, slug: 'power-supply', code: 'PS', name: 'Power Supply', description: 'Unlimited power! Well, almost.', imageKey: 'building/power-supply', threshold: 290_000, editThreshold: 290_000 },
  { id: 65, track: 'building', sequence: 65, slug: 'microcontroller', code: 'MIC', name: 'Microcontroller', description: 'A tiny brain running a tiny robot. Cute.', imageKey: 'building/microcontroller', threshold: 300_000, editThreshold: 300_000 },
  { id: 66, track: 'building', sequence: 66, slug: 'prototyping-shield', code: 'PS', name: 'Prototyping Shield', description: 'Shields up! Prototype mode engaged.', imageKey: 'building/prototyping-shield', threshold: 310_000, editThreshold: 310_000 },
  { id: 67, track: 'building', sequence: 67, slug: 'rasberry-pi', code: 'RP', name: 'Raspberry Pi', description: 'Mmm, pie. Not that kind.', imageKey: 'building/rasberry-pi', threshold: 320_000, editThreshold: 320_000 },
  { id: 68, track: 'building', sequence: 68, slug: 'leds', code: 'LED', name: 'LEDs', description: 'Light Emitting Dedication.', imageKey: 'building/leds', threshold: 330_000, editThreshold: 330_000 },
  { id: 69, track: 'building', sequence: 69, slug: 'servo-motor', code: 'SM', name: 'Servo Motor', description: 'At your service-o.', imageKey: 'building/servo-motor', threshold: 340_000, editThreshold: 340_000 },
  { id: 70, track: 'building', sequence: 70, slug: 'stepper-motor', code: 'SM', name: 'Stepper Motor', description: 'Stepping it up a notch.', imageKey: 'building/stepper-motor', threshold: 350_000, editThreshold: 350_000 },
  { id: 71, track: 'building', sequence: 71, slug: 'dc-motor', code: 'DM', name: 'DC Motor', description: 'Spinning up, can\'t stop now.', imageKey: 'building/dc-motor', threshold: 360_000, editThreshold: 360_000 },
  { id: 72, track: 'building', sequence: 72, slug: 'motor-driver', code: 'MD', name: 'Motor Driver', description: 'Who\'s driving this thing? You are.', imageKey: 'building/motor-driver', threshold: 370_000, editThreshold: 370_000 },
  { id: 73, track: 'building', sequence: 73, slug: 'wheel-and-tire-kit', code: 'WT', name: 'Wheel And Tire Kit', description: 'Wheels up! Rolling into the next edit.', imageKey: 'building/wheel-and-tire-kit', threshold: 380_000, editThreshold: 380_000 },
  { id: 74, track: 'building', sequence: 74, slug: 'ball-caster', code: 'BC', name: 'Ball Caster', description: 'Having a ball out here.', imageKey: 'building/ball-caster', threshold: 390_000, editThreshold: 390_000 },
  { id: 75, track: 'building', sequence: 75, slug: 'track-system', code: 'TRA', name: 'Track System', description: 'Back on track. Actually, you never left.', imageKey: 'building/track-system', threshold: 400_000, editThreshold: 400_000 },
  { id: 76, track: 'building', sequence: 76, slug: 'robot-chassis', code: 'RC', name: 'Robot Chassis', description: 'Nice chassis. Wanna build a robot?', imageKey: 'building/robot-chassis', threshold: 410_000, editThreshold: 410_000 },
  { id: 77, track: 'building', sequence: 77, slug: 'claw', code: 'CLA', name: 'Claw', description: 'The claw has chosen you!', imageKey: 'building/claw', threshold: 420_000, editThreshold: 420_000 },
  { id: 78, track: 'building', sequence: 78, slug: 'gripper-kit', code: 'GRI', name: 'Gripper Kit', description: 'Get a grip! Oh, you already have one.', imageKey: 'building/gripper-kit', threshold: 430_000, editThreshold: 430_000 },
  { id: 79, track: 'building', sequence: 79, slug: 'robot-arm-kit', code: 'RA', name: 'Robot Arm Kit', description: 'Lending a robotic hand.', imageKey: 'building/robot-arm-kit', threshold: 440_000, editThreshold: 440_000 },
  { id: 80, track: 'building', sequence: 80, slug: 'robotic-fabricator', code: 'RF', name: 'Robotic Fabricator', description: 'Robots making robots. What could go wrong?', imageKey: 'building/robotic-fabricator', threshold: 450_000, editThreshold: 450_000 },
  { id: 81, track: 'building', sequence: 81, slug: '3d-printer', code: '3P', name: '3D Printer', description: 'Printing in three whole dimensions. Fancy.', imageKey: 'building/3d-printer', threshold: 460_000, editThreshold: 460_000 },
  { id: 82, track: 'building', sequence: 82, slug: 'filament-spool', code: 'FS', name: 'Filament Spool', description: 'Spooling up for the long haul.', imageKey: 'building/filament-spool', threshold: 470_000, editThreshold: 470_000 },
  { id: 83, track: 'building', sequence: 83, slug: 'resin-vat', code: 'RV', name: 'Resin Vat', description: 'Liquid to solid. That\'s some chemistry.', imageKey: 'building/resin-vat', threshold: 480_000, editThreshold: 480_000 },
  { id: 84, track: 'building', sequence: 84, slug: 'laser-cutter', code: 'LC', name: 'Laser Cutter', description: 'Cutting edge. Literally.', imageKey: 'building/laser-cutter', threshold: 490_000, editThreshold: 490_000 },
  { id: 85, track: 'building', sequence: 85, slug: 'cnc-router', code: 'CR', name: 'CNC Router', description: 'Routed straight to greatness.', imageKey: 'building/cnc-router', threshold: 500_000, editThreshold: 500_000 },
  { id: 86, track: 'building', sequence: 86, slug: 'milling-machine', code: 'MM', name: 'Milling Machine', description: 'Not just run of the mill.', imageKey: 'building/milling-machine', threshold: 510_000, editThreshold: 510_000 },
  { id: 87, track: 'building', sequence: 87, slug: 'drill-press', code: 'DP', name: 'Drill Press', description: 'Pressing on!', imageKey: 'building/drill-press', threshold: 520_000, editThreshold: 520_000 },
  { id: 88, track: 'building', sequence: 88, slug: 'bandsaw', code: 'BAN', name: 'Bandsaw', description: 'Started a band. Saw some success.', imageKey: 'building/bandsaw', threshold: 530_000, editThreshold: 530_000 },
  { id: 89, track: 'building', sequence: 89, slug: 'table-saw', code: 'TS', name: 'Table Saw', description: 'Table for one? Saw that coming.', imageKey: 'building/table-saw', threshold: 540_000, editThreshold: 540_000 },
  { id: 90, track: 'building', sequence: 90, slug: 'lathe', code: 'LAT', name: 'Lathe', description: 'Spinning wood into wonders.', imageKey: 'building/lathe', threshold: 550_000, editThreshold: 550_000 },
  { id: 91, track: 'building', sequence: 91, slug: 'linear-rail', code: 'LR', name: 'Linear Rail', description: 'Straight to the point.', imageKey: 'building/linear-rail', threshold: 560_000, editThreshold: 560_000 },
  { id: 92, track: 'building', sequence: 92, slug: 'gearbox', code: 'GEA', name: 'Gearbox', description: 'Shifting into high gear.', imageKey: 'building/gearbox', threshold: 570_000, editThreshold: 570_000 },
  { id: 93, track: 'building', sequence: 93, slug: 'carbon-fiber', code: 'CF', name: 'Carbon Fiber', description: 'Lightweight material, heavyweight results.', imageKey: 'building/carbon-fiber', threshold: 580_000, editThreshold: 580_000 },
  { id: 94, track: 'building', sequence: 94, slug: 'kevlar', code: 'KEV', name: 'Kevlar', description: 'Bulletproof dedication.', imageKey: 'building/kevlar', threshold: 590_000, editThreshold: 590_000 },
  { id: 95, track: 'building', sequence: 95, slug: 'vacuum-tube', code: 'VT', name: 'Vacuum Tube', description: 'Retro tech for a timeless editor.', imageKey: 'building/vacuum-tube', threshold: 600_000, editThreshold: 600_000 },
  { id: 96, track: 'building', sequence: 96, slug: 'transistor', code: 'TRA', name: 'Transistor', description: 'Small switch, big impact. Sounds like you.', imageKey: 'building/transistor', threshold: 610_000, editThreshold: 610_000 },
  { id: 97, track: 'building', sequence: 97, slug: 'gantry-crane', code: 'GC', name: 'Gantry Crane', description: 'Heavy lifting? You make it look easy.', imageKey: 'building/gantry-crane', threshold: 620_000, editThreshold: 620_000 },
  { id: 98, track: 'building', sequence: 98, slug: 'robotic-welder', code: 'RW', name: 'Robotic Welder', description: 'Sparks are flying. Must be love.', imageKey: 'building/robotic-welder', threshold: 630_000, editThreshold: 630_000 },
  { id: 99, track: 'building', sequence: 99, slug: 'autonomous-assembly-cell', code: 'AAC', name: 'Autonomous Assembly Cell', description: 'It builds itself. Kind of like your edit count.', imageKey: 'building/autonomous-assembly-cell', threshold: 640_000, editThreshold: 640_000 },
  { id: 100, track: 'building', sequence: 100, slug: 'microfactory', code: 'MIC', name: 'Microfactory', description: '650,000 edits. You ARE the factory.', imageKey: 'building/microfactory', threshold: 650_000, editThreshold: 650_000 },
];

export const EXPLORATION_BADGES: BadgeDefinition[] = [
  { id: 101, track: 'exploration', sequence: 1, slug: 'scroll', code: 'SCR', name: 'Scroll', description: 'Your first cell! Better jot this one down.', imageKey: 'exploration/scroll', threshold: 1, editThreshold: 1 },
  { id: 102, track: 'exploration', sequence: 2, slug: 'pencil', code: 'PEN', name: 'Pencil', description: 'The pencil is mightier than the swordcil.', imageKey: 'exploration/pencil', threshold: 5, editThreshold: 5 },
  { id: 103, track: 'exploration', sequence: 3, slug: 'ink', code: 'INK', name: 'Ink', description: 'Ten cells!! Maybe their branches will give you some calligraphic inspo.', imageKey: 'exploration/ink', threshold: 10, editThreshold: 10 },
  { id: 104, track: 'exploration', sequence: 4, slug: 'fountain-pen', code: 'FP', name: 'Fountain Pen', description: 'You\'re a science boss! This will look great on your desk.', imageKey: 'exploration/fountain-pen', threshold: 15, editThreshold: 15 },
  { id: 105, track: 'exploration', sequence: 5, slug: 'lab-notebook', code: 'LN', name: 'Lab Notebook', description: 'Dear diary, today I completed 20 cells!', imageKey: 'exploration/lab-notebook', threshold: 20, editThreshold: 20 },
  { id: 106, track: 'exploration', sequence: 6, slug: 'abacus', code: 'ABA', name: 'Abacus', description: 'Ancient peoples used these to count their completed neurons! Probably!', imageKey: 'exploration/abacus', threshold: 30, editThreshold: 30 },
  { id: 107, track: 'exploration', sequence: 7, slug: 'map', code: 'MAP', name: 'Map', description: 'The GPS of physical media.', imageKey: 'exploration/map', threshold: 40, editThreshold: 40 },
  { id: 108, track: 'exploration', sequence: 8, slug: 'compass', code: 'COM', name: 'Compass', description: '50 cells! What a feat! Take this tool to help you navigate them all.', imageKey: 'exploration/compass', threshold: 50, editThreshold: 50 },
  { id: 109, track: 'exploration', sequence: 9, slug: 'cairn', code: 'CAI', name: 'Cairn', description: 'Stone by stone, you mark the trail for others.', imageKey: 'exploration/cairn', threshold: 75, editThreshold: 75 },
  { id: 110, track: 'exploration', sequence: 10, slug: 'sextant', code: 'SEX', name: 'Reflecting Circle', description: 'One hundred cells! You\'ve found your bearings.', imageKey: 'exploration/sextant', threshold: 100, editThreshold: 100 },
  { id: 111, track: 'exploration', sequence: 11, slug: 'astrolabe', code: 'AST', name: 'Astrolabe', description: 'Sailors read the stars. You, Captain, read neurons.', imageKey: 'exploration/astrolabe', threshold: 125, editThreshold: 125 },
  { id: 112, track: 'exploration', sequence: 12, slug: 'sundial', code: 'SUN', name: 'Sundial', description: 'The sun may be setting, but I need to finish just one more cell.', imageKey: 'exploration/sundial', threshold: 150, editThreshold: 150 },
  { id: 113, track: 'exploration', sequence: 13, slug: 'globe', code: 'GLO', name: 'Globe', description: '200 cells! Our international citsci community salutes you!', imageKey: 'exploration/globe', threshold: 200, editThreshold: 200 },
  { id: 114, track: 'exploration', sequence: 14, slug: 'star-chart', code: 'SC', name: 'Star Chart', description: 'Every finished cell is a new star on the chart.', imageKey: 'exploration/star-chart', threshold: 250, editThreshold: 250 },
  { id: 115, track: 'exploration', sequence: 15, slug: 'magnifying-glass', code: 'MG', name: 'Magnifying Glass', description: 'Elementary, my dear citizen scientist!', imageKey: 'exploration/magnifying-glass', threshold: 300, editThreshold: 300 },
  { id: 116, track: 'exploration', sequence: 16, slug: 'fresnel-lens', code: 'FL', name: 'Fresnel Lens', description: 'Illuminating your path forward, lighthouse style!', imageKey: 'exploration/fresnel-lens', threshold: 350, editThreshold: 350 },
  { id: 117, track: 'exploration', sequence: 17, slug: 'telescope', code: 'TEL', name: 'Telescope', description: 'Stars are like the neurons of the sky.', imageKey: 'exploration/telescope', threshold: 400, editThreshold: 400 },
  { id: 118, track: 'exploration', sequence: 18, slug: 'binoculars', code: 'BIN', name: 'Binoculars', description: 'Two eyes on the prize. Also great for bird watching.', imageKey: 'exploration/binoculars', threshold: 450, editThreshold: 450 },
  { id: 119, track: 'exploration', sequence: 19, slug: 'periscope', code: 'PER', name: 'Periscope', description: 'Up periscope! Spotted: one more finished cell.', imageKey: 'exploration/periscope', threshold: 500, editThreshold: 500 },
  { id: 120, track: 'exploration', sequence: 20, slug: 'barometer', code: 'BAR', name: 'Barometer', description: 'Pressure\'s rising. So is your cell count.', imageKey: 'exploration/barometer', threshold: 600, editThreshold: 600 },
  { id: 121, track: 'exploration', sequence: 21, slug: 'thermometer', code: 'THE', name: 'Thermometer', description: 'Your cell count is officially running a fever.', imageKey: 'exploration/thermometer', threshold: 700, editThreshold: 700 },
  { id: 122, track: 'exploration', sequence: 22, slug: 'hygrometer', code: 'HYG', name: 'Hygrometer', description: 'Measures humidity. Also how hard you sweat over cells.', imageKey: 'exploration/hygrometer', threshold: 800, editThreshold: 800 },
  { id: 123, track: 'exploration', sequence: 23, slug: 'altimeter', code: 'ALT', name: 'Altimeter', description: 'Altitude check: still climbing, captain.', imageKey: 'exploration/altimeter', threshold: 900, editThreshold: 900 },
  { id: 124, track: 'exploration', sequence: 24, slug: 'depth-gauge', code: 'DG', name: 'Depth Gauge', description: 'One thousand cells! You\'re in deep now.', imageKey: 'exploration/depth-gauge', threshold: 1_000, editThreshold: 1_000 },
  { id: 125, track: 'exploration', sequence: 25, slug: 'gyroscope', code: 'GYR', name: 'Gyroscope', description: 'Your head may be spinning, but you stay balanced.', imageKey: 'exploration/gyroscope', threshold: 1_100, editThreshold: 1_100 },
  { id: 126, track: 'exploration', sequence: 26, slug: 'accelerometer', code: 'ACC', name: 'Accelerometer', description: 'Whoa, slow down! Actually, never mind. Keep going.', imageKey: 'exploration/accelerometer', threshold: 1_200, editThreshold: 1_200 },
  { id: 127, track: 'exploration', sequence: 27, slug: 'multimeter', code: 'MUL', name: 'Multimeter', description: 'Tested and confirmed: you are fully charged.', imageKey: 'exploration/multimeter', threshold: 1_300, editThreshold: 1_300 },
  { id: 128, track: 'exploration', sequence: 28, slug: 'oscilloscope', code: 'OSC', name: 'Oscilloscope', description: 'Your brain waves look great. We checked.', imageKey: 'exploration/oscilloscope', threshold: 1_400, editThreshold: 1_400 },
  { id: 129, track: 'exploration', sequence: 29, slug: 'logic-analyzer', code: 'LA', name: 'Logic Analyzer', description: 'Logically, the next step is another cell.', imageKey: 'exploration/logic-analyzer', threshold: 1_500, editThreshold: 1_500 },
  { id: 130, track: 'exploration', sequence: 30, slug: 'digital-caliper', code: 'DC', name: 'Digital Caliper', description: 'Measured precisely: you\'re doing great.', imageKey: 'exploration/digital-caliper', threshold: 1_600, editThreshold: 1_600 },
  { id: 131, track: 'exploration', sequence: 31, slug: 'compound-microscope', code: 'CM', name: 'Compound Microscope', description: 'Zooming in on your greatness.', imageKey: 'exploration/compound-microscope', threshold: 1_700, editThreshold: 1_700 },
  { id: 132, track: 'exploration', sequence: 32, slug: 'electron-microscope', code: 'EM', name: 'Electron Microscope', description: 'The very kind of microscope that took these pictures!', imageKey: 'exploration/electron-microscope', threshold: 1_800, editThreshold: 1_800 },
  { id: 133, track: 'exploration', sequence: 33, slug: 'tomography', code: 'TOM', name: 'Tomography', description: 'Slice, slice, baby.', imageKey: 'exploration/tomography', threshold: 1_900, editThreshold: 1_900 },
  // Was Diamond Knife until Ames 2026-10-20 ("redo Diamond Knife as an ultramicrotome");
  // the old Diamond Knife lives on as a Special Badge held only by Nik, who won it first. Its line
  // was "Slicing brains thinner than a soap bubble" until Ames 2026-10-21 ("too creepy").
  { id: 134, track: 'exploration', sequence: 34, slug: 'ultramicrotome', code: 'UM', name: 'Ultramicrotome', description: 'Your work is cutting edge.', imageKey: 'exploration/ultramicrotome', threshold: 2_000, editThreshold: 2_000 },
  { id: 135, track: 'exploration', sequence: 35, slug: 'pipette', code: 'PIP', name: 'Pipette', description: 'A drop in the bucket? Not you.', imageKey: 'exploration/pipette', threshold: 2_250, editThreshold: 2_250 },
  { id: 136, track: 'exploration', sequence: 36, slug: 'test-tube', code: 'TT', name: 'Test Tube', description: 'Test results are in: you\'re a natural.', imageKey: 'exploration/test-tube', threshold: 2_500, editThreshold: 2_500 },
  { id: 137, track: 'exploration', sequence: 37, slug: 'petri-dish', code: 'PD', name: 'Petri Dish', description: 'Your skills are growing faster than mold in here.', imageKey: 'exploration/petri-dish', threshold: 2_750, editThreshold: 2_750 },
  { id: 138, track: 'exploration', sequence: 38, slug: 'centrifuge', code: 'CEN', name: 'Centrifuge', description: 'Spinning out cells faster than ever.', imageKey: 'exploration/centrifuge', threshold: 3_000, editThreshold: 3_000 },
  { id: 139, track: 'exploration', sequence: 39, slug: 'spectrometer', code: 'SPE', name: 'Spectrometer', description: 'Shining in every color of the spectrum.', imageKey: 'exploration/spectrometer', threshold: 3_250, editThreshold: 3_250 },
  { id: 140, track: 'exploration', sequence: 40, slug: 'chromatograph', code: 'CHR', name: 'Chromatograph', description: 'Separating the great from the good. You\'re great.', imageKey: 'exploration/chromatograph', threshold: 3_500, editThreshold: 3_500 },
  { id: 141, track: 'exploration', sequence: 41, slug: 'seismograph', code: 'SEI', name: 'Seismograph', description: 'Earthquake detected. Oh wait, that\'s just you.', imageKey: 'exploration/seismograph', threshold: 3_750, editThreshold: 3_750 },
  { id: 142, track: 'exploration', sequence: 42, slug: 'geiger-counter', code: 'GC', name: 'Geiger Counter', description: 'Warning: radioactive levels of dedication.', imageKey: 'exploration/geiger-counter', threshold: 4_000, editThreshold: 4_000 },
  { id: 143, track: 'exploration', sequence: 43, slug: 'magnetometer', code: 'MAG', name: 'Magnetometer', description: 'You have a magnetic personality.', imageKey: 'exploration/magnetometer', threshold: 4_250, editThreshold: 4_250 },
  { id: 144, track: 'exploration', sequence: 44, slug: 'gravimeter', code: 'GRA', name: 'Gravimeter', description: 'Your work carries some serious weight.', imageKey: 'exploration/gravimeter', threshold: 4_500, editThreshold: 4_500 },
  { id: 145, track: 'exploration', sequence: 45, slug: 'lidar', code: 'LID', name: 'LiDAR', description: 'Pew pew! Lasers make everything cooler.', imageKey: 'exploration/lidar', threshold: 4_750, editThreshold: 4_750 },
  { id: 146, track: 'exploration', sequence: 46, slug: 'ultrasonic-sensor', code: 'US', name: 'Ultrasonic Sensor', description: 'Bats use this trick too. You\'re batty for cells.', imageKey: 'exploration/ultrasonic-sensor', threshold: 5_000, editThreshold: 5_000 },
  { id: 147, track: 'exploration', sequence: 47, slug: 'infrared-sensor', code: 'IS', name: 'Infrared Sensor', description: 'Things are heating up!', imageKey: 'exploration/infrared-sensor', threshold: 5_500, editThreshold: 5_500 },
  { id: 148, track: 'exploration', sequence: 48, slug: 'touch-sensor', code: 'TS', name: 'Touch Sensor', description: 'You\'ve got the magic touch.', imageKey: 'exploration/touch-sensor', threshold: 6_000, editThreshold: 6_000 },
  { id: 149, track: 'exploration', sequence: 49, slug: 'camera-module', code: 'CM', name: 'Camera Module', description: 'Say cheese! Another cell for the album.', imageKey: 'exploration/camera-module', threshold: 6_500, editThreshold: 6_500 },
  { id: 150, track: 'exploration', sequence: 50, slug: 'thermal-camera', code: 'TC', name: 'Thermal Camera', description: 'Spotted: one very hot streak.', imageKey: 'exploration/thermal-camera', threshold: 7_000, editThreshold: 7_000 },
  { id: 151, track: 'exploration', sequence: 51, slug: 'hyperspectral-camera', code: 'HC', name: 'Hyperspectral Camera', description: 'Seeing colors your eyes haven\'t met yet.', imageKey: 'exploration/hyperspectral-camera', threshold: 7_500, editThreshold: 7_500 },
  { id: 152, track: 'exploration', sequence: 52, slug: 'wi-fi-module', code: 'WFM', name: 'Wi-Fi Module', description: 'Full bars. Your connection to science is strong.', imageKey: 'exploration/wi-fi-module', threshold: 8_000, editThreshold: 8_000 },
  { id: 153, track: 'exploration', sequence: 53, slug: 'gps-receiver', code: 'GR', name: 'GPS Receiver', description: 'Recalculating... nope, you\'re right on course.', imageKey: 'exploration/gps-receiver', threshold: 8_500, editThreshold: 8_500 },
  { id: 154, track: 'exploration', sequence: 54, slug: 'ros', code: 'ROS', name: 'ROS', description: 'The operating system robots dream about.', imageKey: 'exploration/ros', threshold: 9_000, editThreshold: 9_000 },
  { id: 155, track: 'exploration', sequence: 55, slug: 'quadruped-robot', code: 'QR', name: 'Quadruped Robot', description: 'Four legs, zero tail wags, endless loyalty.', imageKey: 'exploration/quadruped-robot', threshold: 9_500, editThreshold: 9_500 },
  { id: 156, track: 'exploration', sequence: 56, slug: 'drone', code: 'DRO', name: 'Drone', description: 'Ten thousand cells! The view from up here is buzzing.', imageKey: 'exploration/drone', threshold: 10_000, editThreshold: 10_000 },
  { id: 157, track: 'exploration', sequence: 57, slug: 'rover', code: 'ROV', name: 'Rover', description: 'Roving where no rover has roved before.', imageKey: 'exploration/rover', threshold: 11_000, editThreshold: 11_000 },
  { id: 158, track: 'exploration', sequence: 58, slug: 'autonomous-underwater-vehicle-auv', code: 'AUV', name: 'Autonomous Underwater Vehicle (AUV)', description: 'Diving deep, no snorkel needed.', imageKey: 'exploration/autonomous-underwater-vehicle-auv', threshold: 12_000, editThreshold: 12_000 },
  { id: 159, track: 'exploration', sequence: 59, slug: 'hydrophone', code: 'HYD', name: 'Hydrophone', description: 'Whale hello there!', imageKey: 'exploration/hydrophone', threshold: 13_000, editThreshold: 13_000 },
  { id: 160, track: 'exploration', sequence: 60, slug: 'sonar-array', code: 'SA', name: 'Sonar Array', description: 'Ping! Something big down there. It\'s your cell count.', imageKey: 'exploration/sonar-array', threshold: 14_000, editThreshold: 14_000 },
  { id: 161, track: 'exploration', sequence: 61, slug: 'radar-dish', code: 'RD', name: 'Radar Dish', description: 'You\'re on our radar now.', imageKey: 'exploration/radar-dish', threshold: 15_000, editThreshold: 15_000 },
  { id: 162, track: 'exploration', sequence: 62, slug: 'weather-balloon', code: 'WB', name: 'Weather Balloon', description: 'Forecast: 100 percent chance of more cells.', imageKey: 'exploration/weather-balloon', threshold: 16_000, editThreshold: 16_000 },
  { id: 163, track: 'exploration', sequence: 63, slug: 'satellite', code: 'SAT', name: 'Satellite', description: 'Houston, we have a top scientist.', imageKey: 'exploration/satellite', threshold: 17_000, editThreshold: 17_000 },
  { id: 164, track: 'exploration', sequence: 64, slug: 'cubesat', code: 'CUB', name: 'CubeSat', description: 'Small satellite, big ambitions. Sounds familiar.', imageKey: 'exploration/cubesat', threshold: 18_000, editThreshold: 18_000 },
  { id: 165, track: 'exploration', sequence: 65, slug: 'star-tracker', code: 'ST', name: 'Star Tracker', description: 'You\'re a star. This thing would know.', imageKey: 'exploration/star-tracker', threshold: 19_000, editThreshold: 19_000 },
  { id: 166, track: 'exploration', sequence: 66, slug: 'probe', code: 'PRO', name: 'Probe', description: 'Probing the mysteries of the brain.', imageKey: 'exploration/probe', threshold: 20_000, editThreshold: 20_000 },
  { id: 167, track: 'exploration', sequence: 67, slug: 'cpu', code: 'CPU', name: 'CPU', description: 'Processing... processing... yep, you\'re awesome.', imageKey: 'exploration/cpu', threshold: 21_000, editThreshold: 21_000 },
  { id: 168, track: 'exploration', sequence: 68, slug: 'gpu', code: 'GPU', name: 'GPU', description: 'Rendering your greatness in high definition.', imageKey: 'exploration/gpu', threshold: 22_000, editThreshold: 22_000 },
  { id: 169, track: 'exploration', sequence: 69, slug: 'keyboard', code: 'KEY', name: 'Keyboard', description: 'Your keyboard has seen things.', imageKey: 'exploration/keyboard', threshold: 23_000, editThreshold: 23_000 },
  { id: 170, track: 'exploration', sequence: 70, slug: 'mouse', code: 'MOU', name: 'Mouse', description: 'Not that kind of mouse. Though we map those too!', imageKey: 'exploration/mouse', threshold: 24_000, editThreshold: 24_000 },
  { id: 171, track: 'exploration', sequence: 71, slug: 'monitor', code: 'MON', name: 'Monitor', description: 'Staring at screens, but make it science.', imageKey: 'exploration/monitor', threshold: 25_000, editThreshold: 25_000 },
  { id: 172, track: 'exploration', sequence: 72, slug: 'server', code: 'SER', name: 'Server', description: 'Serving up cells, hot and fresh.', imageKey: 'exploration/server', threshold: 26_000, editThreshold: 26_000 },
  { id: 173, track: 'exploration', sequence: 73, slug: 'cloud', code: 'CLO', name: 'Cloud', description: 'Your head is in the cloud. Your data too.', imageKey: 'exploration/cloud', threshold: 27_000, editThreshold: 27_000 },
  { id: 174, track: 'exploration', sequence: 74, slug: 'storage', code: 'STO', name: 'Storage', description: 'We\'re going to need a bigger hard drive.', imageKey: 'exploration/storage', threshold: 28_000, editThreshold: 28_000 },
  { id: 175, track: 'exploration', sequence: 75, slug: 'spare-memory', code: 'SM', name: 'Spare Memory', description: 'You\'ll never forget this one.', imageKey: 'exploration/spare-memory', threshold: 29_000, editThreshold: 29_000 },
  { id: 176, track: 'exploration', sequence: 76, slug: 'bit-to-petabyte', code: 'BP', name: 'Bit To Petabyte', description: 'A petabyte of brain, and you\'ve seen a good chunk.', imageKey: 'exploration/bit-to-petabyte', threshold: 30_000, editThreshold: 30_000 },
  { id: 177, track: 'exploration', sequence: 77, slug: 'computing-cluster', code: 'CC', name: 'Computing Cluster', description: 'Many machines, one mission: keep up with you.', imageKey: 'exploration/computing-cluster', threshold: 31_000, editThreshold: 31_000 },
  { id: 178, track: 'exploration', sequence: 78, slug: 'artificial-intelligence-ai-processor', code: 'AIA', name: 'Artificial Intelligence (AI) Processor', description: 'AI is learning from you. Teach it well.', imageKey: 'exploration/artificial-intelligence-ai-processor', threshold: 32_000, editThreshold: 32_000 },
  { id: 179, track: 'exploration', sequence: 79, slug: 'machine-learning-kit-for-robots', code: 'MLR', name: 'Machine Learning Kit For Robots', description: 'Robots study your work. You\'re their favorite teacher.', imageKey: 'exploration/machine-learning-kit-for-robots', threshold: 33_000, editThreshold: 33_000 },
  { id: 180, track: 'exploration', sequence: 80, slug: 'haptic-feedback-system', code: 'HF', name: 'Haptic Feedback System', description: 'Good vibrations only.', imageKey: 'exploration/haptic-feedback-system', threshold: 34_000, editThreshold: 34_000 },
  { id: 181, track: 'exploration', sequence: 81, slug: 'robotic-exoskeleton', code: 'RE', name: 'Robotic Exoskeleton', description: 'Super suit unlocked. Cape not included.', imageKey: 'exploration/robotic-exoskeleton', threshold: 35_000, editThreshold: 35_000 },
  { id: 182, track: 'exploration', sequence: 82, slug: 'flexible-electronic-skin-e-skin', code: 'FES', name: 'Flexible Electronic Skin (e-skin)', description: 'Thick skinned? Nope, just electronic.', imageKey: 'exploration/flexible-electronic-skin-e-skin', threshold: 36_000, editThreshold: 36_000 },
  { id: 183, track: 'exploration', sequence: 83, slug: 'biosensor', code: 'BIO', name: 'Biosensor', description: 'Sensing a lot of talent around here.', imageKey: 'exploration/biosensor', threshold: 37_000, editThreshold: 37_000 },
  { id: 184, track: 'exploration', sequence: 84, slug: 'quantum-sensor', code: 'QS', name: 'Quantum Sensor', description: 'Sensitive enough to feel your enthusiasm.', imageKey: 'exploration/quantum-sensor', threshold: 38_000, editThreshold: 38_000 },
  { id: 185, track: 'exploration', sequence: 85, slug: 'advanced-lidar-system', code: 'AL', name: 'Advanced LiDAR System', description: 'Lasers, but even fancier.', imageKey: 'exploration/advanced-lidar-system', threshold: 39_000, editThreshold: 39_000 },
  { id: 186, track: 'exploration', sequence: 86, slug: 'microbot-swarm', code: 'MS', name: 'Microbot Swarm', description: 'Tiny robots teaming up. Just like Pyr players.', imageKey: 'exploration/microbot-swarm', threshold: 40_000, editThreshold: 40_000 },
  { id: 187, track: 'exploration', sequence: 87, slug: 'dna-nanotechnology', code: 'DN', name: 'DNA Nanotechnology', description: 'Folding DNA into tiny origami. Neat!', imageKey: 'exploration/dna-nanotechnology', threshold: 41_000, editThreshold: 41_000 },
  { id: 188, track: 'exploration', sequence: 88, slug: 'gene-sequencer', code: 'GS', name: 'Gene Sequencer', description: 'Your genes say: born to proofread.', imageKey: 'exploration/gene-sequencer', threshold: 42_000, editThreshold: 42_000 },
  { id: 189, track: 'exploration', sequence: 89, slug: 'nanoscope', code: 'NAN', name: 'Nanoscope', description: 'Seeing the tiniest things. Size isn\'t everything.', imageKey: 'exploration/nanoscope', threshold: 43_000, editThreshold: 43_000 },
  { id: 190, track: 'exploration', sequence: 90, slug: 'particle-detector', code: 'PD', name: 'Particle Detector', description: 'Detected: one exceptional particle. It\'s you.', imageKey: 'exploration/particle-detector', threshold: 44_000, editThreshold: 44_000 },
  { id: 191, track: 'exploration', sequence: 91, slug: 'quantum-computer', code: 'QC', name: 'Quantum Computer', description: 'Are you done or not done? Yes.', imageKey: 'exploration/quantum-computer', threshold: 45_000, editThreshold: 45_000 },
  { id: 192, track: 'exploration', sequence: 92, slug: 'fusion-test-chamber', code: 'FTC', name: 'Fusion Test Chamber', description: 'Your energy could power a small star.', imageKey: 'exploration/fusion-test-chamber', threshold: 46_000, editThreshold: 46_000 },
  { id: 193, track: 'exploration', sequence: 93, slug: 'neutrino-detector', code: 'ND', name: 'Neutrino Detector', description: 'Catching ghost particles. Spooky science!', imageKey: 'exploration/neutrino-detector', threshold: 47_000, editThreshold: 47_000 },
  { id: 194, track: 'exploration', sequence: 94, slug: 'deep-sea-observatory', code: 'DSO', name: 'Deep Sea Observatory', description: 'Things get weird down here. You fit right in.', imageKey: 'exploration/deep-sea-observatory', threshold: 48_000, editThreshold: 48_000 },
  { id: 195, track: 'exploration', sequence: 95, slug: 'orbital-telescope', code: 'OT', name: 'Orbital Telescope', description: 'Out of this world work.', imageKey: 'exploration/orbital-telescope', threshold: 49_000, editThreshold: 49_000 },
  { id: 196, track: 'exploration', sequence: 96, slug: 'planetary-lander', code: 'PL', name: 'Planetary Lander', description: 'The eagle has landed, on a planet of cells.', imageKey: 'exploration/planetary-lander', threshold: 50_000, editThreshold: 50_000 },
  { id: 197, track: 'exploration', sequence: 97, slug: 'swarm-drone-beacon', code: 'SDB', name: 'Swarm Drone Beacon', description: 'Calling all drones. We\'ve found a leader.', imageKey: 'exploration/swarm-drone-beacon', threshold: 51_000, editThreshold: 51_000 },
  { id: 198, track: 'exploration', sequence: 98, slug: 'exoplanet-imager', code: 'EI', name: 'Exoplanet Imager', description: 'Spotting planets light years away. Legendary vision.', imageKey: 'exploration/exoplanet-imager', threshold: 52_000, editThreshold: 52_000 },
  { id: 199, track: 'exploration', sequence: 99, slug: 'dark-matter-array', code: 'DMA', name: 'Dark Matter Array', description: 'Hunting for what no one can see. You\'d find it.', imageKey: 'exploration/dark-matter-array', threshold: 53_000, editThreshold: 53_000 },
  { id: 200, track: 'exploration', sequence: 100, slug: 'interstellar-probe', code: 'IP', name: 'Interstellar Probe', description: 'To infinity, and beyond! You did it all.', imageKey: 'exploration/interstellar-probe', threshold: 54_000, editThreshold: 54_000 },
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
