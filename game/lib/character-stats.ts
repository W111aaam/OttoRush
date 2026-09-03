export type CharacterStats = {
  speed: number;
  health: number;
  growth: number;
  dodge: number;
  speedMultiplier: number;
  scoreMultiplier: number;
  dodgeChance: number;
};

const BASE_STATS: CharacterStats = {
  speed: 2,
  health: 2,
  growth: 2,
  dodge: 0,
  speedMultiplier: 1,
  scoreMultiplier: 1,
  dodgeChance: 0,
};

export const CHARACTER_STATS: Record<number, CharacterStats> = {
  1: BASE_STATS,
  2: { ...BASE_STATS, speed: 3, growth: 3, speedMultiplier: 1.2, scoreMultiplier: 1.4 },
  3: { ...BASE_STATS, health: 3, growth: 2 },
  4: { ...BASE_STATS, dodge: 1, dodgeChance: 0.5 },
};

export const CHARACTER_NAMES: Record<number, string> = {
  1: '棍子爹',
  2: '哈基米',
  3: '曼波',
  4: '龙哥',
};

export function getCharacterName(characterId: number) {
  return CHARACTER_NAMES[characterId] ?? `角色 ${characterId}`;
}

export function getCharacterStats(characterId: number) {
  return CHARACTER_STATS[characterId] ?? BASE_STATS;
}

export function characterIdFromUrl(url: string) {
  return Number(/character(\d+)/i.exec(url)?.[1] ?? 1);
}
