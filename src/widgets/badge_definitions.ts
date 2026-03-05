/**
 * badge_definitions.ts
 * Eyewire II — Badge catalogue for the community branch.
 *
 * badge_10.png is absent from the asset zip; id 10 is intentionally omitted.
 * Update `editThreshold` values once the official thresholds are confirmed.
 */

export interface BadgeDefinition {
  /** Numeric badge ID (matches the filename badge_<id>.png). */
  id: number;
  name: string;
  description: string;
  /**
   * Key used to look up the image via import.meta.glob.
   * Corresponds to `../assets/badges/badge_<id>.png` relative to components/.
   */
  imageKey: string;
  /**
   * Number of all-time edits required to earn this badge.
   * 0 = awarded by a different mechanism (e.g. first login, manual grant).
   */
  editThreshold: number;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 1,
    name: 'First Merge',
    description: 'Made your very first merge.',
    imageKey: 'badge_1',
    editThreshold: 1,
  },
  {
    id: 2,
    name: 'Getting Started',
    description: 'Reached 5 edits.',
    imageKey: 'badge_2',
    editThreshold: 5,
  },
  {
    id: 3,
    name: 'Explorer',
    description: 'Reached 25 edits.',
    imageKey: 'badge_3',
    editThreshold: 25,
  },
  {
    id: 4,
    name: 'Trailblazer',
    description: 'Reached 50 edits.',
    imageKey: 'badge_4',
    editThreshold: 50,
  },
  {
    id: 5,
    name: 'Pathfinder',
    description: 'Reached 100 edits.',
    imageKey: 'badge_5',
    editThreshold: 100,
  },
  {
    id: 6,
    name: 'Navigator',
    description: 'Reached 250 edits.',
    imageKey: 'badge_6',
    editThreshold: 250,
  },
  {
    id: 7,
    name: 'Mapper',
    description: 'Reached 500 edits.',
    imageKey: 'badge_7',
    editThreshold: 500,
  },
  {
    id: 8,
    name: 'Cartographer',
    description: 'Reached 1,000 edits.',
    imageKey: 'badge_8',
    editThreshold: 1_000,
  },
  {
    id: 9,
    name: 'Master Mapper',
    description: 'Reached 2,500 edits.',
    imageKey: 'badge_9',
    editThreshold: 2_500,
  },
  // badge_10 image is missing from the asset set — id 10 is skipped
  {
    id: 11,
    name: 'Synapse Scout',
    description: 'Reached 5,000 edits.',
    imageKey: 'badge_11',
    editThreshold: 5_000,
  },
  {
    id: 12,
    name: 'Connectome Builder',
    description: 'Reached 7,500 edits.',
    imageKey: 'badge_12',
    editThreshold: 7_500,
  },
  {
    id: 13,
    name: 'Dendrite Diver',
    description: 'Reached 10,000 edits.',
    imageKey: 'badge_13',
    editThreshold: 10_000,
  },
  {
    id: 14,
    name: 'Axon Expert',
    description: 'Reached 15,000 edits.',
    imageKey: 'badge_14',
    editThreshold: 15_000,
  },
  {
    id: 15,
    name: 'Neuron Nerd',
    description: 'Reached 20,000 edits.',
    imageKey: 'badge_15',
    editThreshold: 20_000,
  },
  {
    id: 16,
    name: 'Circuit Breaker',
    description: 'Reached 30,000 edits.',
    imageKey: 'badge_16',
    editThreshold: 30_000,
  },
  {
    id: 17,
    name: 'Synaptologist',
    description: 'Reached 50,000 edits.',
    imageKey: 'badge_17',
    editThreshold: 50_000,
  },
  {
    id: 18,
    name: 'Neural Architect',
    description: 'Reached 75,000 edits.',
    imageKey: 'badge_18',
    editThreshold: 75_000,
  },
  {
    id: 19,
    name: 'Connectomics Hero',
    description: 'Reached 100,000 edits.',
    imageKey: 'badge_19',
    editThreshold: 100_000,
  },
  {
    id: 20,
    name: 'Legend',
    description: 'Reached 250,000 edits.',
    imageKey: 'badge_20',
    editThreshold: 250_000,
  },
];
