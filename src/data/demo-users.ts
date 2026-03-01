/**
 * demo-users.ts
 * Hardcoded leaderboard participants for the EyeWire II community demo.
 * Replace with live CAVE API calls once the leaderboard endpoint is wired up.
 *
 * User [0] (Amy Sterling) is used to seed the logged-in user's profile when
 * no real stats have been pushed via useUserStatsStore().setStats().
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
    editsThisMonth: number;
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
      editsThisWeek: 312, editsThisMonth: 1_840, cellsSubmitted: 892,
      currentStreak: 7, longestStreak: 31,
    },
  },
  {
    id: 'u2',
    name: 'Tariq Hassan',
    flag: '🇸🇦',
    bio: 'Postdoc at KAUST. Focused on inhibitory interneurons.',
    stats: {
      editsAllTime: 127_443, mergesAllTime: 78_200, splitsAllTime: 49_243,
      editsThisWeek: 890, editsThisMonth: 4_120, cellsSubmitted: 2_341,
      currentStreak: 14, longestStreak: 45,
    },
  },
  {
    id: 'u3',
    name: 'Mei-Ling Chen',
    flag: '🇹🇼',
    bio: 'PhD student at NTU. Loves connectomics and late-night tracing sessions.',
    stats: {
      editsAllTime: 73_210, mergesAllTime: 44_900, splitsAllTime: 28_310,
      editsThisWeek: 541, editsThisMonth: 2_780, cellsSubmitted: 1_104,
      currentStreak: 21, longestStreak: 63,
    },
  },
  {
    id: 'u4',
    name: 'Lucas Ferreira',
    flag: '🇧🇷',
    bio: 'Research scientist at USP. Amateur astronomer & professional neuron tracer.',
    stats: {
      editsAllTime: 52_180, mergesAllTime: 31_500, splitsAllTime: 20_680,
      editsThisWeek: 278, editsThisMonth: 1_590, cellsSubmitted: 743,
      currentStreak: 3, longestStreak: 28,
    },
  },
  {
    id: 'u5',
    name: 'Ingrid Sørensen',
    flag: '🇩🇰',
    bio: 'Lab manager at Novo Nordisk Foundation Center. Weekend EyeWire champion.',
    stats: {
      editsAllTime: 38_920, mergesAllTime: 23_400, splitsAllTime: 15_520,
      editsThisWeek: 167, editsThisMonth: 980, cellsSubmitted: 512,
      currentStreak: 0, longestStreak: 19,
    },
  },
  {
    id: 'u6',
    name: 'James Okafor',
    flag: '🇳🇬',
    bio: 'Undergrad at UNILAG studying computational neuroscience. Future legend.',
    stats: {
      editsAllTime: 12_340, mergesAllTime: 7_400, splitsAllTime: 4_940,
      editsThisWeek: 412, editsThisMonth: 2_100, cellsSubmitted: 89,
      currentStreak: 12, longestStreak: 12,
    },
  },
  {
    id: 'u7',
    name: 'Yuki Tanaka',
    flag: '🇯🇵',
    bio: 'Citizen scientist. Day job: sushi chef. Evening job: mapping neurons.',
    stats: {
      editsAllTime: 91_887, mergesAllTime: 55_600, splitsAllTime: 36_287,
      editsThisWeek: 634, editsThisMonth: 3_340, cellsSubmitted: 1_678,
      currentStreak: 9, longestStreak: 50,
    },
  },
  {
    id: 'u8',
    name: 'Priya Nair',
    flag: '🇮🇳',
    bio: 'Professor at IISc Bangalore. 15 years in computational neuroscience.',
    stats: {
      editsAllTime: 210_540, mergesAllTime: 128_900, splitsAllTime: 81_640,
      editsThisWeek: 1_102, editsThisMonth: 5_890, cellsSubmitted: 4_210,
      currentStreak: 28, longestStreak: 87,
    },
  },
  {
    id: 'u9',
    name: 'Oliver Richter',
    flag: '🇩🇪',
    bio: 'Max Planck Institute. Specializes in axonal reconstructions.',
    stats: {
      editsAllTime: 165_320, mergesAllTime: 101_200, splitsAllTime: 64_120,
      editsThisWeek: 780, editsThisMonth: 4_560, cellsSubmitted: 3_120,
      currentStreak: 5, longestStreak: 42,
    },
  },
  {
    id: 'u10',
    name: 'Sofia Almeida',
    flag: '🇵🇹',
    bio: 'Grad student at Champalimaud. EyeWire keeps me sane between experiments.',
    stats: {
      editsAllTime: 29_450, mergesAllTime: 18_100, splitsAllTime: 11_350,
      editsThisWeek: 203, editsThisMonth: 1_120, cellsSubmitted: 388,
      currentStreak: 1, longestStreak: 15,
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
