import { env } from 'cloudflare:workers';
import type { LeaderboardRow } from '@/db/schema';

type Bindings = { DB: D1Database };

export type LeaderboardEntry = {
  rank: number;
  playerId: string;
  playerName: string;
  score: number;
  characterId: number;
};

const topTenQuery = `
  SELECT player_id, player_name, score, character_id, updated_at
  FROM leaderboard
  ORDER BY score DESC, updated_at ASC
  LIMIT 10
`;

function database() {
  return (env as unknown as Bindings).DB;
}

function publicEntries(rows: LeaderboardRow[]): LeaderboardEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    playerId: row.player_id,
    playerName: row.player_name,
    score: row.score,
    characterId: row.character_id,
  }));
}

export async function readLeaderboard() {
  const result = await database().prepare(topTenQuery).all<LeaderboardRow>();
  return publicEntries(result.results);
}

export async function saveLeaderboardScore(input: {
  playerId: string;
  playerName: string;
  score: number;
  characterId: number;
}) {
  const db = database();
  const upsert = db.prepare(`
    INSERT INTO leaderboard (player_id, player_name, score, character_id, updated_at)
    VALUES (?1, ?2, ?3, ?4, unixepoch())
    ON CONFLICT(player_id) DO UPDATE SET
      player_name = excluded.player_name,
      character_id = excluded.character_id,
      score = MAX(leaderboard.score, excluded.score),
      updated_at = CASE
        WHEN excluded.score > leaderboard.score THEN excluded.updated_at
        ELSE leaderboard.updated_at
      END
  `).bind(input.playerId, input.playerName, input.score, input.characterId);
  const trim = db.prepare(`
    DELETE FROM leaderboard
    WHERE player_id NOT IN (
      SELECT player_id FROM leaderboard
      ORDER BY score DESC, updated_at ASC
      LIMIT 10
    )
  `);
  await db.batch([upsert, trim]);
  return readLeaderboard();
}
