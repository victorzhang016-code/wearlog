import type { VercelRequest, VercelResponse } from '@vercel/node';
import { blockDevProdServices } from '../_lib/devGuard.js';
import { supabaseRest, verifySupabaseToken } from '../_lib/supabase.js';

function bodyOf(req: VercelRequest): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body as Record<string, any>;
}

function text(value: unknown, max: number) { return String(value || '').trim().slice(0, max); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (blockDevProdServices(res)) return;
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  let user: { id: string };
  try { user = await verifySupabaseToken(token) as { id: string }; }
  catch { return res.status(401).json({ error: '登录状态已失效，请重新登录' }); }

  const body = bodyOf(req);
  const feedback = text(body.feedback, 30);
  const journalSnapshotHash = text(body.journalSnapshotHash, 160);
  const chapterId = text(body.chapterId, 80);
  if (!journalSnapshotHash || !chapterId || !['accurate', 'not_quite'].includes(feedback)) return res.status(400).json({ error: '风格志反馈格式不完整' });
  const response = await supabaseRest('aesthetic_journal_feedback', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ owner_id: user.id, journal_snapshot_hash: journalSnapshotHash, chapter_id: chapterId, feedback, note: text(body.note, 1000) || null, source_version: text(body.sourceVersion, 120) || 'deterministic-style-journal-v1' }),
  }, token);
  if (!response.ok) return res.status(503).json({ error: '风格志反馈暂时无法保存' });
  const rows = await response.json();
  return res.status(200).json({ feedback: Array.isArray(rows) ? rows[0] || null : rows });
}
