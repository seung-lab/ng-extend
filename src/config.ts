export type Config = {
  volumes_url?: string;
  volumes_enabled?: string[];
  volumes_default?: { name: string; image: string; segmentation: string };

  leaderboard_url: string;

  // MERGER FREE review service endpoints, patched into config/ng-extend.json by
  // .github/workflows/deploy-frontend.yml (all optional; each client falls back
  // to a localhost default and can be overridden at runtime via window.*).
  candela_api?: string; // Candela merge-cut queue — mergeQueueClient.ts (window.CANDELA_API)
  candela_datastack?: string; // window.CANDELA_DATASTACK
  autoproof_api?: string; // auto-proofread pipeline API — autoproofClient.ts (window.AUTOPROOF_API)
};
