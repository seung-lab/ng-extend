/**
 * demo-users.ts
 * Hardcoded leaderboard participants for the EyeWire II community demo.
 * Replace with live CAVE API calls once the leaderboard endpoint is wired up.
 *
 * User [0] (Amy Sterling) is used to seed the logged-in user's profile when
 * no real stats have been pushed via useUserStatsStore().setStats().
 *
 * mergesThisWeek + splitsThisWeek  = editsThisWeek   (always)
 * mergesThisMonth + splitsThisMonth = editsThisMonth  (always)
 */

export interface DemoUser {
  id: string;
  name: string;
  flag: string;   // flag emoji e.g. "🇺🇸"
  bio: string;
  stats: {
    editsAllTime: number;
    mergesAllTime: number;
    splitsAllTime: number;
    editsThisWeek: number;
    mergesThisWeek: number;
    splitsThisWeek: number;
    editsThisMonth: number;
    mergesThisMonth: number;
    splitsThisMonth: number;
    cellsSubmitted: number;
    currentStreak: number;
    longestStreak: number;
  };
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: 'amy',
    name: 'Amy Sterling',
    flag: '🇺🇸',
    bio: 'Executive Director of EyeWire. #3 author on FlyWire. Mapping brains since 2012.',
    stats: {
      editsAllTime: 48_732, mergesAllTime: 29_800, splitsAllTime: 18_932,
      editsThisWeek: 312, mergesThisWeek: 191, splitsThisWeek: 121,
      editsThisMonth: 1_840, mergesThisMonth: 1_125, splitsThisMonth: 715,
      cellsSubmitted: 892, currentStreak: 7, longestStreak: 31,
    },
  },
  {
    id: 'u2',
    name: 'Tariq Hassan',
    flag: '🇸🇦',
    bio: 'Postdoc at KAUST. Focused on inhibitory interneurons.',
    stats: {
      editsAllTime: 127_443, mergesAllTime: 78_200, splitsAllTime: 49_243,
      editsThisWeek: 890, mergesThisWeek: 546, splitsThisWeek: 344,
      editsThisMonth: 4_120, mergesThisMonth: 2_528, splitsThisMonth: 1_592,
      cellsSubmitted: 2_341, currentStreak: 14, longestStreak: 45,
    },
  },
  {
    id: 'u3',
    name: 'Mei-Ling Chen',
    flag: '🇹🇼',
    bio: 'PhD student at NTU. Loves connectomics and late-night tracing sessions.',
    stats: {
      editsAllTime: 73_210, mergesAllTime: 44_900, splitsAllTime: 28_310,
      editsThisWeek: 541, mergesThisWeek: 332, splitsThisWeek: 209,
      editsThisMonth: 2_780, mergesThisMonth: 1_705, splitsThisMonth: 1_075,
      cellsSubmitted: 1_104, currentStreak: 21, longestStreak: 63,
    },
  },
  {
    id: 'u4',
    name: 'Lucas Ferreira',
    flag: '🇧🇷',
    bio: 'Research scientist at USP. Amateur astronomer & professional neuron tracer.',
    stats: {
      editsAllTime: 52_180, mergesAllTime: 31_500, splitsAllTime: 20_680,
      editsThisWeek: 278, mergesThisWeek: 168, splitsThisWeek: 110,
      editsThisMonth: 1_590, mergesThisMonth: 960, splitsThisMonth: 630,
      cellsSubmitted: 743, currentStreak: 3, longestStreak: 28,
    },
  },
  {
    id: 'u5',
    name: 'Ingrid Sørensen',
    flag: '🇩🇰',
    bio: 'Lab manager at Novo Nordisk Foundation Center. Weekend EyeWire champion.',
    stats: {
      editsAllTime: 38_920, mergesAllTime: 23_400, splitsAllTime: 15_520,
      editsThisWeek: 167, mergesThisWeek: 100, splitsThisWeek: 67,
      editsThisMonth: 980, mergesThisMonth: 589, splitsThisMonth: 391,
      cellsSubmitted: 512, currentStreak: 0, longestStreak: 19,
    },
  },
  {
    id: 'u6',
    name: 'James Okafor',
    flag: '🇳🇬',
    bio: 'Undergrad at UNILAG studying computational neuroscience. Future legend.',
    stats: {
      editsAllTime: 12_340, mergesAllTime: 7_400, splitsAllTime: 4_940,
      editsThisWeek: 412, mergesThisWeek: 247, splitsThisWeek: 165,
      editsThisMonth: 2_100, mergesThisMonth: 1_259, splitsThisMonth: 841,
      cellsSubmitted: 89, currentStreak: 12, longestStreak: 12,
    },
  },
  {
    id: 'u7',
    name: 'Yuki Tanaka',
    flag: '🇯🇵',
    bio: 'Citizen scientist. Day job: sushi chef. Evening job: mapping neurons.',
    stats: {
      editsAllTime: 91_887, mergesAllTime: 55_600, splitsAllTime: 36_287,
      editsThisWeek: 634, mergesThisWeek: 384, splitsThisWeek: 250,
      editsThisMonth: 3_340, mergesThisMonth: 2_021, splitsThisMonth: 1_319,
      cellsSubmitted: 1_678, currentStreak: 9, longestStreak: 50,
    },
  },
  {
    id: 'u8',
    name: 'Priya Nair',
    flag: '🇮🇳',
    bio: 'Professor at IISc Bangalore. 15 years in computational neuroscience.',
    stats: {
      editsAllTime: 210_540, mergesAllTime: 128_900, splitsAllTime: 81_640,
      editsThisWeek: 1_102, mergesThisWeek: 675, splitsThisWeek: 427,
      editsThisMonth: 5_890, mergesThisMonth: 3_606, splitsThisMonth: 2_284,
      cellsSubmitted: 4_210, currentStreak: 28, longestStreak: 87,
    },
  },
  {
    id: 'u9',
    name: 'Oliver Richter',
    flag: '🇩🇪',
    bio: 'Max Planck Institute. Specializes in axonal reconstructions.',
    stats: {
      editsAllTime: 165_320, mergesAllTime: 101_200, splitsAllTime: 64_120,
      editsThisWeek: 780, mergesThisWeek: 477, splitsThisWeek: 303,
      editsThisMonth: 4_560, mergesThisMonth: 2_791, splitsThisMonth: 1_769,
      cellsSubmitted: 3_120, currentStreak: 5, longestStreak: 42,
    },
  },
  {
    id: 'u10',
    name: 'Sofia Almeida',
    flag: '🇵🇹',
    bio: 'Grad student at Champalimaud. EyeWire keeps me sane between experiments.',
    stats: {
      editsAllTime: 29_450, mergesAllTime: 18_100, splitsAllTime: 11_350,
      editsThisWeek: 203, mergesThisWeek: 125, splitsThisWeek: 78,
      editsThisMonth: 1_120, mergesThisMonth: 688, splitsThisMonth: 432,
      cellsSubmitted: 388, currentStreak: 1, longestStreak: 15,
    },
  },
];

/** Sum of all demo users' weekly edits (used for community pulse seeding). */
export const DEMO_COMMUNITY_EDITS_WEEK = DEMO_USERS.reduce(
  (sum, u) => sum + u.stats.editsThisWeek, 0,
);

/** Sum of all demo users' monthly edits. */
export const DEMO_COMMUNITY_EDITS_MONTH = DEMO_USERS.reduce(
  (sum, u) => sum + u.stats.editsThisMonth, 0,
);
