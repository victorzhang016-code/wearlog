import type { VercelRequest, VercelResponse } from '@vercel/node';
import { blockDevProdServices } from '../../../_lib/devGuard.js';
import { supabaseRest, verifySupabaseToken } from '../../../_lib/supabase.js';
import {
  applyRecommendationEvent,
  normalizeRecommendationEvent,
  type RecommendationState,
} from '../../../../src/lib/recommendationEvents.js';

const MAX_BODY_CHARS = 128 * 1024;

function bodyOf(req: VercelRequest): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body as Record<string, any>;
}

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function existingByIdempotency(ownerId: string, idempotencyKey: string, token: string) {
  const response = await supabaseRest(
    `outfit_recommendation_events?owner_id=eq.${encodeURIComponent(ownerId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
    {},
    token,
  );
  if (!response.ok) return null;
  const rows = await response.json() as unknown;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (blockDevProdServices(res)) return;
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  let user: { id: string };
  try { user = await verifySupabaseToken(token) as { id: string }; }
  catch { return res.status(401).json({ error: '登录状态已失效，请重新登录' }); }

  const key = text(req.query.key, 500);
  const body = bodyOf(req);
  if (!key) return res.status(400).json({ error: '缺少推荐上下文' });
  if (JSON.stringify(body).length > MAX_BODY_CHARS) return res.status(413).json({ error: '反馈内容过大' });

  const idempotencyKey = text(body.idempotencyKey, 160);
  let eventType;
  try { eventType = normalizeRecommendationEvent(body.eventType); }
  catch { return res.status(400).json({ error: '不支持的推荐反馈类型' }); }
  const reason = text(body.reason, 1000) || null;
  if (!idempotencyKey) return res.status(400).json({ error: '缺少幂等键' });

  const snapshot = jsonObject(body.recommendationSnapshot);
  const sourceMatchId = text(snapshot.sourceMatchId, 160);
  const anchorItemId = text(snapshot.anchorItemId, 160);
  const keyParts = key.split('|');
  if (!sourceMatchId || !anchorItemId || keyParts[0] !== sourceMatchId || keyParts[1] !== anchorItemId) {
    return res.status(409).json({ error: '推荐来源与当前用户上下文不一致' });
  }
  const [matchResponse, itemResponse] = await Promise.all([
    supabaseRest(`best_matches?id=eq.${encodeURIComponent(sourceMatchId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, {}, token),
    supabaseRest(`wardrobe_items?id=eq.${encodeURIComponent(anchorItemId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, {}, token),
  ]);
  if (!matchResponse.ok || !itemResponse.ok) return res.status(503).json({ error: '推荐来源暂时无法验证' });
  const [matchRows, itemRows] = await Promise.all([matchResponse.json(), itemResponse.json()]);
  if (!Array.isArray(matchRows) || !matchRows.length || !Array.isArray(itemRows) || !itemRows.length) return res.status(404).json({ error: '推荐来源已不存在' });

  const existing = await existingByIdempotency(user.id, idempotencyKey, token);
  if (existing) return res.status(200).json({ event: existing, idempotentReplay: true });

  const latestResponse = await supabaseRest(
    `outfit_recommendation_events?owner_id=eq.${encodeURIComponent(user.id)}&recommendation_key=eq.${encodeURIComponent(key)}&select=state&order=created_at.desc&limit=1`,
    {},
    token,
  );
  if (!latestResponse.ok) return res.status(503).json({ error: '推荐反馈状态暂时不可用' });
  const latest = (await latestResponse.json() as Array<{ state?: RecommendationState }>)[0];
  const previousState = latest?.state || 'new';
  let state: RecommendationState;
  try { state = applyRecommendationEvent(previousState, eventType); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : '推荐反馈状态不允许此操作' }); }

  const row = {
    owner_id: user.id,
    recommendation_key: key,
    event_type: eventType,
    previous_state: previousState,
    state,
    reason,
    recommendation_snapshot: snapshot,
    engine_version: text(body.engineVersion, 120) || null,
    snapshot_hash: text(body.snapshotHash, 160) || null,
    idempotency_key: idempotencyKey,
  };
  const response = await supabaseRest('outfit_recommendation_events', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  }, token);
  if (response.ok) {
    const created = await response.json();
    return res.status(201).json({ event: Array.isArray(created) ? created[0] : created, idempotentReplay: false });
  }

  // A concurrent request may win the unique idempotency key between our read and insert.
  const replay = await existingByIdempotency(user.id, idempotencyKey, token);
  if (replay) return res.status(200).json({ event: replay, idempotentReplay: true });
  return res.status(503).json({ error: '推荐反馈暂时无法保存' });
}
