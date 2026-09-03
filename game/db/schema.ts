export type LeaderboardRow = {
  player_id: string;
  player_name: string;
  score: number;
  character_id: number;
  updated_at: number;
};

// Canonical application schema. Production changes are applied only through
// the matching immutable SQL migrations in /drizzle.
export const leaderboardTable = {
  name: 'leaderboard',
  primaryKey: 'player_id',
  scoreIndex: 'idx_leaderboard_score_updated',
} as const;
