CREATE TABLE `leaderboard` (
  `player_id` text PRIMARY KEY NOT NULL,
  `player_name` text NOT NULL,
  `score` integer NOT NULL,
  `character_id` integer NOT NULL DEFAULT 1,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_leaderboard_score_updated`
ON `leaderboard` (`score` DESC, `updated_at` ASC);
--> statement-breakpoint
PRAGMA optimize;
