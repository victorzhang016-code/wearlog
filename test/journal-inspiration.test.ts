import assert from 'node:assert/strict';
import test from 'node:test';
import type { BestMatch, WardrobeItem } from '../src/types';
import type { AnalysisRun, CombinationOpportunity, OutfitCaseGraph, PerceptualColor, SemanticAtom, SubstitutionContract } from '../src/lib/aestheticAnalysisV3';
import { buildJournalInspiration, isRecordedJournalCombination, isSingleJournalChange } from '../src/lib/journalInspiration';

const item = (id: string, category: WardrobeItem['category']) => ({ id, category, name: id }) as WardrobeItem;
const items = [item('outer', '上装'), item('inner', '上装'), item('bottom', '下装'), item('other', '下装'), item('shoe', '鞋子'), item('bag', '配饰'), item('watch', '配饰')];
const source = {
  id: 'source', name: '原搭配', allItemIds: items.map((entry) => entry.id),
  items: { tops: [{ primary: 'outer' }, { primary: 'inner' }], bottoms: [{ primary: 'bottom', variants: ['other'] }], shoes: [{ primary: 'shoe' }], accessories: [{ primary: 'bag' }, { primary: 'watch' }] },
} as BestMatch;
const next = [
  { slot: 'tops' as const, index: 0, itemId: 'outer' },
  { slot: 'tops' as const, index: 1, itemId: 'inner' },
  { slot: 'bottoms' as const, index: 0, itemId: 'other' },
  { slot: 'shoes' as const, index: 0, itemId: 'shoe' },
  { slot: 'accessories' as const, index: 0, itemId: 'bag' },
  { slot: 'accessories' as const, index: 1, itemId: 'watch' },
];
const substitution = { id: 'pair', fromItemId: 'bottom', toItemId: 'other', slot: 'bottoms', contextMatchIds: ['source'], evidenceIds: ['e:variant'] } as SubstitutionContract;
const run = { atoms: [], colors: [], outfitCases: [], opportunities: [], substitutions: [substitution] } as unknown as AnalysisRun;

test('one replacement preserves all original positions, including the second accessory', () => {
  assert.equal(isSingleJournalChange(source, next, 'bottom', 'other'), true);
  assert.equal(isSingleJournalChange(source, next.slice(0, -1), 'bottom', 'other'), false);
  assert.equal(isSingleJournalChange(source, next.map((entry, index) => index === 0 ? { ...entry, itemId: 'another-outer' } : entry), 'bottom', 'other'), false);
});

test('does not mistake saved variant combinations for a new outfit', () => {
  assert.equal(isRecordedJournalCombination(next, [source]), true);
  const reordered = { ...source, items: { ...source.items, tops: [...source.items.tops].reverse() } };
  assert.equal(isRecordedJournalCombination(next, [reordered]), true);
  const unrecorded = next.map((entry) => entry.slot === 'bottoms' ? { ...entry, itemId: 'unrecorded-bottom' } : entry);
  assert.equal(isRecordedJournalCombination(unrecorded, [source]), false);
});

test('rejects duplicate target positions instead of hiding an extra change', () => {
  const duplicate = [...next.slice(0, -1), next[4]];
  assert.equal(isSingleJournalChange(source, duplicate, 'bottom', 'other'), false);
});

test('a current saved variant is clearly labelled saved, never new inspiration', () => {
  const result = buildJournalInspiration(items, [source], run, source.id);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'saved');
  assert.equal(result[0].to.id, 'other');
});

test('removed variants and deleted context garments cannot survive through an old run', () => {
  const changed = { ...source, items: { ...source.items, bottoms: [{ primary: 'bottom', variants: [] }] } };
  assert.deepEqual(buildJournalInspiration(items, [changed], run), []);
  assert.deepEqual(buildJournalInspiration(items.filter((entry) => entry.id !== 'watch'), [source], run), []);
});

test('duplicate contexts are curated to one example of the same pair', () => {
  const second = { ...source, id: 'second', name: '第二套' };
  const shared = { ...run, substitutions: [{ ...substitution, contextMatchIds: ['source', 'second'] }] };
  const result = buildJournalInspiration(items, [source, second], shared, 'second');
  assert.equal(result.length, 1);
  assert.equal(result[0].match.id, 'second');
});

const freshSource = { ...source, items: { ...source.items, bottoms: [{ primary: 'bottom' }] } };
const freshItems = items.map((entry) => entry.category === '下装' ? { ...entry, length: '长裤' as const } : entry);
function color(id: string, lightness: number): PerceptualColor {
  return { itemId: id, rgb: [80, 80, 80], hex: '#505050', role: 'dominant', areaRatio: 1, lab: [lightness * 100, 0, 0], oklch: [lightness, 0, 0], source: 'user', evidenceStatus: 'confirmed' };
}
const freshCase = {
  matchId: 'source', anchorItemId: 'outer',
  primaryItems: Object.entries(freshSource.items).flatMap(([slot, entries]) => entries.map((entry) => ({ slot, itemId: entry.primary }))),
  relations: [
    { id: 'relation-bottom', matchId: 'source', anchorItemId: 'outer', supportItemId: 'bottom', slot: 'bottoms', operation: 'color_ground', effect: '深色下装', evidenceIds: ['e:bottom'], confidence: 1 },
    { id: 'relation-shoe', matchId: 'source', anchorItemId: 'outer', supportItemId: 'shoe', slot: 'shoes', operation: 'color_ground', effect: '深色鞋', evidenceIds: ['e:shoe'], confidence: 1 },
  ],
} as OutfitCaseGraph;
const freshRun = {
  ...run, substitutions: [], outfitCases: [freshCase], conceptRelations: [],
  atoms: ['bottom', 'other'].map((itemId) => ({ id: `atom-${itemId}`, itemId, field: 'silhouette', normalized: '阔腿', value: '阔腿', evidenceStatus: 'confirmed' })) as SemanticAtom[],
  colors: [color('outer', .7), color('inner', .95), color('bottom', .25), color('other', .27), color('shoe', .2)],
  opportunities: [{
    id: 'opportunity', sourceMatchId: 'source', sourceAnchorItemId: 'outer', anchorItemId: 'outer', targetSlot: 'bottoms', replacesItemId: 'bottom', candidateItemId: 'other', score: 1,
    reasons: ['共享阔腿轮廓'], evidenceIds: ['e:structure'],
    paletteAssessment: { status: 'strict', ruleVersion: 'outfit-palette-v1', sourceMatchId: 'source', sourceAnchorItemId: 'outer', structuralEvidenceIds: ['e:structure'], evidenceIds: [], completeBase: true, supportEdgeCount: 1, affectedSlots: ['bottoms'], summary: '' },
  }] as CombinationOpportunity[],
};

test('curates a new single-slot experiment only after a current palette evaluation', () => {
  const result = buildJournalInspiration(freshItems, [freshSource], freshRun);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'new');
  assert.equal(result[0].assessment?.status, 'strict');
  assert.match(result[0].description, /宽松版型/);
});

test('stale strict scores cannot bypass missing current colors or structure', () => {
  assert.deepEqual(buildJournalInspiration(freshItems, [freshSource], { ...freshRun, colors: [] }), []);
  assert.deepEqual(buildJournalInspiration(freshItems, [freshSource], { ...freshRun, atoms: [] }), []);
  assert.deepEqual(buildJournalInspiration(freshItems, [source], freshRun), []);
});

test('accepted and rejected experiments are not proposed again from a stale opportunity list', () => {
  for (const choice of ['接受', '拒绝']) {
    const decided = { ...freshRun, manualFeedback: [{ id: 'decision', targetType: 'opportunity' as const, targetId: 'opportunity', choice, updatedAt: '2026-11-23' }] };
    assert.deepEqual(buildJournalInspiration(freshItems, [freshSource], decided), []);
  }
});
