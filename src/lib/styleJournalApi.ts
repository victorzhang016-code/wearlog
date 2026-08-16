import type { StyleJournal } from './styleJournal';
import { supabase } from './supabase';

async function tokenOrThrow() {
  if (!supabase) throw new Error('Supabase 未配置');
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('登录状态已失效');
  return data.session.access_token;
}

export async function persistStyleJournal(journal: StyleJournal) {
  const token = await tokenOrThrow();
  const response = await fetch('/api/aesthetic/journal', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ journal }),
  });
  if (!response.ok) throw new Error('风格志暂时无法保存');
  return response.json();
}

export async function persistStyleJournalFeedback(journal: StyleJournal, chapterId: string, feedback: 'accurate' | 'not_quite', note = '') {
  const token = await tokenOrThrow();
  const response = await fetch('/api/aesthetic/journal-feedback', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ journalSnapshotHash: journal.snapshotHash, chapterId, feedback, note, sourceVersion: journal.engineVersion }),
  });
  if (!response.ok) throw new Error('风格志反馈暂时无法保存');
  return response.json();
}
