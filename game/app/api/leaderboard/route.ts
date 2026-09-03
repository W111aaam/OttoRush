import { readLeaderboard, saveLeaderboardScore } from '@/lib/leaderboard-db';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    return Response.json({ entries: await readLeaderboard() }, { headers: responseHeaders });
  } catch (error) {
    console.error('Unable to read leaderboard', error);
    return Response.json({ error: '排行榜暂时无法连接' }, { status: 503, headers: responseHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';
    const score = Number(body.score);
    const characterId = Number(body.characterId);

    if (!/^[a-zA-Z0-9-]{8,64}$/.test(playerId)
      || playerName.length < 1 || playerName.length > 16
      || !Number.isSafeInteger(score) || score < 0 || score > 100_000_000
      || !Number.isInteger(characterId) || characterId < 1 || characterId > 999) {
      return Response.json({ error: '成绩数据无效' }, { status: 400, headers: responseHeaders });
    }

    const entries = await saveLeaderboardScore({ playerId, playerName, score, characterId });
    const rank = entries.find((entry) => entry.playerId === playerId)?.rank ?? null;
    return Response.json({ entries, rank }, { headers: responseHeaders });
  } catch (error) {
    console.error('Unable to save leaderboard score', error);
    return Response.json({ error: '成绩提交失败，请稍后再试' }, { status: 503, headers: responseHeaders });
  }
}
