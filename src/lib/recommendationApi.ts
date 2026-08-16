import { supabase } from './supabase';
import type { OutfitRecommendation } from './aestheticRecommendation';
import { type RecommendationEventType } from './recommendationEvents';

export async function recordRecommendationEvent(
  recommendation: OutfitRecommendation,
  eventType: RecommendationEventType,
  reason?: string,
) {
  if (!supabase) throw new Error('Supabase 未配置，反馈暂时只保留在本地');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录');

  const idempotencyKey = `${recommendation.recommendationKey}:${eventType}:${crypto.randomUUID()}`;
  const response = await fetch(`/api/outfit/recommendations/${encodeURIComponent(recommendation.recommendationKey)}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      eventType,
      idempotencyKey,
      reason: reason?.trim() || undefined,
      recommendationSnapshot: {
        anchorItemId: recommendation.anchorItemId,
        sourceMatchId: recommendation.sourceMatchId,
        kind: recommendation.kind,
        selections: recommendation.selections,
        changedSlot: recommendation.changedSlot,
        replacedItemId: recommendation.replacedItemId,
        candidateItemId: recommendation.candidateItemId,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || '推荐反馈暂时无法保存'));
  return payload;
}
