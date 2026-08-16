import type { VercelRequest, VercelResponse } from '@vercel/node';
import { blockDevProdServices } from '../_lib/devGuard.js';
import { supabaseRest, verifySupabaseToken } from '../_lib/supabase.js';

const STAGES = new Set(['starting', 'growing', 'established']);
const MATURITIES = new Set(['observation', 'emerging', 'stable', 'explicit']);
const KNOWLEDGE_TYPES = new Set(['explicit', 'observed', 'emerging']);

function bodyOf(req: VercelRequest): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body as Record<string, any>;
}

function text(value: unknown, max: number) { return String(value || '').trim().slice(0, max); }
function list(value: unknown, max: number) { return Array.isArray(value) ? value.map((entry) => text(entry, 160)).filter(Boolean).slice(0, max) : []; }

function normalizeJournal(value: unknown) {
  const raw = value && typeof value === 'object' ? value as Record<string, any> : {};
  const stage = text(raw.stage, 30);
  const snapshotHash = text(raw.snapshotHash, 160);
  const engineVersion = text(raw.engineVersion, 120);
  if (!STAGES.has(stage) || !snapshotHash || !engineVersion) return null;
  const chapters = Array.isArray(raw.chapters) ? raw.chapters.slice(0, 8).map((entry) => {
    const chapter = entry && typeof entry === 'object' ? entry as Record<string, any> : {};
    const maturity = text(chapter.maturity, 30);
    const knowledgeType = text(chapter.knowledgeType, 30);
    return {
      id: text(chapter.id, 80),
      title: text(chapter.title, 160),
      summary: text(chapter.summary, 1600),
      maturity: MATURITIES.has(maturity) ? maturity : 'observation',
      knowledgeType: KNOWLEDGE_TYPES.has(knowledgeType) ? knowledgeType : 'observed',
      sourceIds: list(chapter.sourceIds, 32),
      caseIds: list(chapter.caseIds, 32),
      itemIds: list(chapter.itemIds, 64),
    };
  }).filter((entry) => entry.id && entry.title) : [];
  return {
    stage,
    portrait: text(raw.portrait, 2400),
    chapters,
    snapshot_hash: snapshotHash,
    engine_version: engineVersion,
    prompt_version: text(raw.promptVersion, 120) || 'deterministic-style-journal-v1',
    generated_at: text(raw.generatedAt, 80) || new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (blockDevProdServices(res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method not allowed');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  let user: { id: string };
  try { user = await verifySupabaseToken(token) as { id: string }; }
  catch { return res.status(401).json({ error: '登录状态已失效，请重新登录' }); }

  if (req.method === 'GET') {
    const response = await supabaseRest(`aesthetic_style_journals?owner_id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`, {}, token);
    if (!response.ok) return res.status(503).json({ error: '风格志暂时无法读取' });
    const rows = await response.json();
    return res.status(200).json({ journal: Array.isArray(rows) ? rows[0] || null : null });
  }

  const body = bodyOf(req);
  if (JSON.stringify(body).length > 256 * 1024) return res.status(413).json({ error: '风格志内容过大' });
  const journal = normalizeJournal(body.journal);
  if (!journal) return res.status(400).json({ error: '风格志格式不完整' });
  const response = await supabaseRest('aesthetic_style_journals', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ owner_id: user.id, ...journal }),
  }, token);
  if (!response.ok) return res.status(503).json({ error: '风格志暂时无法保存' });
  const rows = await response.json();
  return res.status(200).json({ journal: Array.isArray(rows) ? rows[0] || null : rows });
}
