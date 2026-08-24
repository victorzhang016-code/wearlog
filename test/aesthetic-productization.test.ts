import assert from 'node:assert/strict';
import test from 'node:test';
import type { BestMatch, WardrobeItem } from '../src/types';
import type { CombinationOpportunity } from '../src/lib/aestheticAnalysisV3';
import { buildOutfitRecommendations, isPaletteRecommendationRunCurrent, recommendationContextKey } from '../src/lib/aestheticRecommendation';
import { applyRecommendationEvent } from '../src/lib/recommendationEvents';
import { buildStyleJournal } from '../src/lib/styleJournal';

const timestamp = { toDate: () => new Date('2026-01-01T00:00:00.000Z') } as any;

function item(id: string, category: WardrobeItem['category'], name = id, extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    userId: 'victor',
    name,
    category,
    season: '四季',
    rating: 4,
    story: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra,
  };
}

function match(id: string, items: BestMatch['items']): BestMatch {
  return {
    id,
    userId: 'victor',
    items,
    allItemIds: Object.values(items).flatMap((slots) => slots.flatMap((slot) => [slot.primary, ...(slot.variants || [])])),
    name: id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function opportunity(overrides: Partial<CombinationOpportunity> = {}): CombinationOpportunity {
  return {
    id: 'opportunity-1',
    anchorItemId: 'top-anchor',
    anchorItemName: '核心上装',
    targetSlot: 'bottoms',
    replacesItemId: 'bottom-base',
    replacesItemName: '原下装',
    candidateItemId: 'bottom-new',
    candidateItemName: '新下装',
    sourceMatchId: 'match-1',
    sourceAnchorItemId: 'top-anchor',
    paletteAssessment: {
      ruleVersion: 'outfit-palette-v1',
      status: 'strict',
      sourceMatchId: 'match-1',
      sourceAnchorItemId: 'top-anchor',
      completeBase: true,
      relation: 'ground',
      summary: '深色下装压住重心，鞋履重复下半身的低明度。',
      evidenceIds: ['e:palette'],
      structuralEvidenceIds: ['e:structure'],
      supportEdgeCount: 2,
      affectedSlots: ['bottoms', 'shoes'],
    },
    reasons: ['与核心外衣存在相近色彩关系', '共享收束线条'],
    evidenceIds: ['e:color', 'e:silhouette'],
    score: 8,
    ...overrides,
  };
}

const items = [
  item('top-anchor', '上装', '核心上装', { topType: '外套' }),
  item('inner', '上装', '内搭', { topType: '长袖' }),
  item('bottom-base', '下装', '原下装', { length: '长裤' }),
  item('bottom-new', '下装', '新下装', { length: '长裤' }),
  item('bottom-other', '下装', '另一条下装', { length: '长裤' }),
  item('shoe', '鞋子', '鞋'),
];

const sourceMatch = match('match-1', {
  tops: [{ primary: 'top-anchor' }, { primary: 'inner' }],
  bottoms: [{ primary: 'bottom-base' }],
  shoes: [{ primary: 'shoe' }],
  accessories: [],
});

test('builds a new recommendation that keeps the anchor and changes one slot', () => {
  const [recommendation] = buildOutfitRecommendations('top-anchor', [sourceMatch], items, { opportunities: [opportunity()] });

  assert.equal(recommendation.kind, 'new');
  assert.equal(recommendation.anchorItemId, 'top-anchor');
  assert.equal(recommendation.sourceMatchId, 'match-1');
  assert.equal(recommendation.changedSlot, 'bottoms');
  assert.deepEqual(recommendation.selections.map((entry) => entry.itemId), ['top-anchor', 'inner', 'bottom-new', 'shoe']);
  assert.equal(recommendation.replacedItemId, 'bottom-base');
  assert.equal(recommendation.candidateItemId, 'bottom-new');
  assert.equal(recommendation.reasons.length, 2);
});

test('keeps a non-top anchor when applying opportunities from its Best Match', () => {
  const recommendations = buildOutfitRecommendations('bottom-base', [sourceMatch], [
    ...items,
    item('shoe-new', '鞋子', '新鞋'),
  ], {
    opportunities: [opportunity({ targetSlot: 'shoes', replacesItemId: 'shoe', candidateItemId: 'shoe-new', score: 9 })],
  });

  const [recommendation] = recommendations.filter((entry) => entry.kind === 'new');
  assert.equal(recommendation.anchorItemId, 'bottom-base');
  assert.equal(recommendation.changedSlot, 'shoes');
  assert.deepEqual(recommendation.selections.map((entry) => entry.itemId), ['top-anchor', 'inner', 'bottom-base', 'shoe-new']);
});

test('keeps a variant item as the anchor when applying a replacement opportunity', () => {
  const variantMatch = match('variant-match', {
    tops: [{ primary: 'top-anchor' }, { primary: 'inner' }],
    bottoms: [{ primary: 'bottom-other', variants: ['bottom-base'] }],
    shoes: [{ primary: 'shoe' }],
    accessories: [],
  });

  const recommendations = buildOutfitRecommendations('bottom-base', [variantMatch], [
    ...items,
    item('shoe-new', '鞋子', '新鞋'),
  ], {
    opportunities: [opportunity({
      targetSlot: 'shoes',
      replacesItemId: 'shoe',
      candidateItemId: 'shoe-new',
      sourceMatchId: 'variant-match',
      paletteAssessment: { ...opportunity().paletteAssessment!, sourceMatchId: 'variant-match' },
    })],
  });

  const [recommendation] = recommendations.filter((entry) => entry.kind === 'new');
  assert.equal(recommendation.anchorItemId, 'bottom-base');
  assert.deepEqual(recommendation.selections.map((entry) => entry.itemId), ['top-anchor', 'inner', 'bottom-base', 'shoe-new']);
});

test('does not reuse an opportunity from one Best Match inside another source skeleton', () => {
  const recommendations = buildOutfitRecommendations('top-anchor', [sourceMatch], items, {
    opportunities: [opportunity({ sourceMatchId: 'foreign-match', sourceAnchorItemId: 'foreign-top' })],
  });

  assert.equal(recommendations.some((entry) => entry.kind === 'new'), false);
});

test('returns only one clearly marked exploration when no strict palette survives', () => {
  const exploration = (id: string, candidateItemId: string) => opportunity({
    id,
    candidateItemId,
    paletteAssessment: {
      ...opportunity().paletteAssessment!,
      status: 'exploration',
      newVariable: '把下装从深蓝改为低饱和灰绿，保留低明度鞋履承接。',
    },
  });
  const recommendations = buildOutfitRecommendations('top-anchor', [sourceMatch], items, {
    opportunities: [exploration('exploration-a', 'bottom-new'), exploration('exploration-b', 'bottom-other')],
  });
  const fresh = recommendations.filter((entry) => entry.kind === 'new');

  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].tier, 'exploration');
  assert.match(fresh[0].paletteAssessment?.newVariable || '', /新变量|下装/);
});

test('treats legacy or mismatched synced runs as unsafe for Quick recommendations', () => {
  assert.equal(isPaletteRecommendationRunCurrent({ opportunities: [] }, 'snapshot-now'), false);
  assert.equal(isPaletteRecommendationRunCurrent({
    inputSnapshotHash: 'snapshot-now',
    recommendationRuleVersion: 'outfit-palette-v1',
    opportunities: [opportunity()],
    outfitCases: [{} as any],
    colors: [{} as any],
  }, 'snapshot-now'), true);
  assert.equal(isPaletteRecommendationRunCurrent({
    inputSnapshotHash: 'snapshot-then',
    recommendationRuleVersion: 'outfit-palette-v1',
    opportunities: [opportunity()],
    outfitCases: [{} as any],
    colors: [{} as any],
  }, 'snapshot-now'), false);
});

test('removes complete combinations and exact rejected contexts', () => {
  const alreadyRecorded = match('match-2', {
    tops: [{ primary: 'top-anchor' }, { primary: 'inner' }],
    bottoms: [{ primary: 'bottom-new' }],
    shoes: [{ primary: 'shoe' }],
    accessories: [],
  });
  const rejected = recommendationContextKey({
    sourceMatchId: 'match-1',
    anchorItemId: 'top-anchor',
    changedSlot: 'bottoms',
    replacedItemId: 'bottom-base',
    candidateItemId: 'bottom-other',
  });

  const recommendations = buildOutfitRecommendations(
    'top-anchor',
    [sourceMatch, alreadyRecorded],
    items,
    { opportunities: [opportunity(), opportunity({ id: 'opportunity-2', candidateItemId: 'bottom-other', score: 7 })] },
    { rejectedKeys: new Set([rejected]) },
  );

  assert.equal(recommendations.some((entry) => entry.candidateItemId === 'bottom-new'), false);
  assert.equal(recommendations.some((entry) => entry.candidateItemId === 'bottom-other'), false);
});

test('ranks new recommendations before history and resolves score ties by stable key', () => {
  const recommendations = buildOutfitRecommendations(
    'top-anchor',
    [sourceMatch],
    items,
    { opportunities: [opportunity({ id: 'opportunity-z', candidateItemId: 'bottom-other', score: 4 }), opportunity({ id: 'opportunity-a', score: 4 })] },
  );

  assert.deepEqual(recommendations.map((entry) => entry.kind), ['new', 'new', 'history']);
  assert.equal(recommendations[0].id < recommendations[1].id, true);
  assert.equal(recommendations[2].sourceMatchId, 'match-1');
});

test('caps strict new directions at three instead of expanding one item into a long template list', () => {
  const candidates = ['bottom-new', 'bottom-other', 'bottom-three', 'bottom-four'];
  const recommendations = buildOutfitRecommendations('top-anchor', [sourceMatch], [
    ...items,
    item('bottom-three', '下装', '第三条下装', { length: '长裤' }),
    item('bottom-four', '下装', '第四条下装', { length: '长裤' }),
  ], {
    opportunities: candidates.map((candidateItemId, index) => opportunity({ id: `strict-${index}`, candidateItemId, score: 20 - index })),
  });

  assert.equal(recommendations.filter((entry) => entry.kind === 'new').length, 3);
});

test('builds a complete direct outfit with outerwear, inner layer, bottoms, and shoes', () => {
  const directItems = [
    item('direct-anchor', '上装', '新的外衣', { topType: '外套' }),
    item('template-outer', '上装', '模板外衣', { topType: '外套' }),
    item('template-inner', '上装', '模板内搭', { topType: '长袖' }),
    item('template-bottom', '下装', '模板下装', { length: '长裤' }),
    item('template-shoe', '鞋子', '模板鞋'),
    item('template-bag', '配饰', '模板包', { accessoryType: '包包' }),
  ];
  const template = match('template-1', {
    tops: [{ primary: 'template-outer' }, { primary: 'template-inner' }],
    bottoms: [{ primary: 'template-bottom' }],
    shoes: [{ primary: 'template-shoe' }],
    accessories: [{ primary: 'template-bag' }],
  });
  const [recommendation] = buildOutfitRecommendations('direct-anchor', [template], directItems, {
    opportunities: [],
    colors: [
      { itemId: 'direct-anchor', rgb: [100, 180, 160], hex: '#64b4a0', role: 'dominant', areaRatio: 1, lab: [69, -23, 8], oklch: [0.71, 0.09, 162], source: 'manual', evidenceStatus: 'confirmed' },
      { itemId: 'template-outer', rgb: [105, 184, 164], hex: '#69b8a4', role: 'dominant', areaRatio: 1, lab: [70, -24, 7], oklch: [0.72, 0.09, 162], source: 'manual', evidenceStatus: 'confirmed' },
      { itemId: 'template-inner', rgb: [245, 245, 245], hex: '#f5f5f5', role: 'dominant', areaRatio: 1, lab: [96, 0, 1], oklch: [0.96, 0.01, 90], source: 'manual', evidenceStatus: 'confirmed' },
      { itemId: 'template-bottom', rgb: [34, 46, 72], hex: '#222e48', role: 'dominant', areaRatio: 1, lab: [24, 5, -18], oklch: [0.28, 0.04, 258], source: 'manual', evidenceStatus: 'confirmed' },
      { itemId: 'template-shoe', rgb: [25, 34, 54], hex: '#192236', role: 'dominant', areaRatio: 1, lab: [19, 4, -15], oklch: [0.22, 0.03, 255], source: 'manual', evidenceStatus: 'confirmed' },
      { itemId: 'template-bag', rgb: [100, 100, 100], hex: '#646464', role: 'dominant', areaRatio: 1, lab: [42, 0, 0], oklch: [0.45, 0.01, 0], source: 'manual', evidenceStatus: 'confirmed' },
    ],
    outfitCases: [{
      matchId: 'template-1', name: '模板', story: '', anchorItemId: 'template-outer', anchorItemName: '模板外衣', tier: 'mature', primaryItems: [], variantItems: [], mechanismKeys: [], explicitClaimIds: [], evidenceCoverage: 1, composition: {} as any, decisionMechanisms: [],
      relations: [
        { id: 'inner', matchId: 'template-1', anchorItemId: 'template-outer', supportItemId: 'template-inner', slot: 'tops', operation: 'color_lighten', effect: '提亮', evidenceIds: ['e:inner'], confidence: 1 },
        { id: 'bottom', matchId: 'template-1', anchorItemId: 'template-outer', supportItemId: 'template-bottom', slot: 'bottoms', operation: 'color_ground', effect: '压住重心', evidenceIds: ['e:bottom'], confidence: 1 },
        { id: 'shoe', matchId: 'template-1', anchorItemId: 'template-outer', supportItemId: 'template-shoe', slot: 'shoes', operation: 'color_ground', effect: '鞋履承接', evidenceIds: ['e:shoe'], confidence: 1 },
      ],
    }],
  } as any);

  assert.equal(recommendation.origin, 'direct');
  assert.equal(recommendation.sourceMatchId, 'template-1');
  assert.equal(recommendation.changedSlot, 'tops');
  assert.equal(recommendation.replacedItemId, 'template-outer');
  assert.deepEqual(recommendation.selections.map((entry) => entry.itemId), ['direct-anchor', 'template-inner', 'template-bottom', 'template-shoe', 'template-bag']);
  assert.equal(recommendation.selections.filter((entry) => entry.slot === 'tops').length, 2);
  assert.equal(recommendation.selections.filter((entry) => entry.slot === 'accessories').length, 1);
  assert.match(recommendation.reasons[0].text, /层次|重心|颜色|色彩/);
});

test('does not invent a direct outfit when the template lacks a complete base', () => {
  const recommendations = buildOutfitRecommendations('direct-anchor', [sourceMatch], [
    ...items,
    item('direct-anchor', '上装', '新的外衣', { topType: '外套' }),
  ], { opportunities: [] });

  assert.equal(recommendations.some((entry) => entry.origin === 'direct'), false);
});

test('limits references to the canonical match followed by two variants', () => {
  const referenceItems = [...items, item('top-other', '上装', '另一件外衣', { topType: '外套' })];
  const referenceMatches = [
    sourceMatch,
    match('match-2', { tops: [{ primary: 'top-other', variants: ['top-anchor'] }], bottoms: [{ primary: 'bottom-other' }], shoes: [{ primary: 'shoe' }], accessories: [] }),
    match('match-3', { tops: [{ primary: 'top-other', variants: ['top-anchor'] }], bottoms: [{ primary: 'bottom-new' }], shoes: [{ primary: 'shoe' }], accessories: [] }),
    match('match-4', { tops: [{ primary: 'top-other', variants: ['top-anchor'] }], bottoms: [{ primary: 'bottom-base' }], shoes: [{ primary: 'shoe' }], accessories: [] }),
  ];
  const recommendations = buildOutfitRecommendations('top-anchor', referenceMatches, referenceItems, { opportunities: [] });
  const references = recommendations.filter((entry) => entry.origin === 'reference');

  assert.equal(references.length, 3);
  assert.equal(references[0].referenceLevel, 'canonical');
  assert.deepEqual(references.slice(1).map((entry) => entry.referenceLevel), ['variant', 'variant']);
});

test('keeps skip neutral and records fit feedback separately from wear outcome', () => {
  assert.equal(applyRecommendationEvent('presented', 'skipped'), 'presented');
  assert.equal(applyRecommendationEvent('presented', 'marked_suitable'), 'suitable');
  assert.equal(applyRecommendationEvent('presented', 'selected_for_wear'), 'selected');
  assert.equal(applyRecommendationEvent('suitable', 'selected_for_wear'), 'selected');
  assert.equal(applyRecommendationEvent('selected', 'worn_satisfied'), 'satisfied');
});

test('turns an exact rejection into a terminal local counterexample', () => {
  assert.equal(applyRecommendationEvent('presented', 'marked_unsuitable'), 'unsuitable');
  assert.throws(() => applyRecommendationEvent('unsuitable', 'selected_for_wear'), /terminal recommendation state/);
});

test('does not accept a wear outcome before the recommendation was shown', () => {
  assert.throws(() => applyRecommendationEvent('new', 'worn_unsatisfied'), /must be presented or selected/);
});

test('builds an established style journal from repeated cases without losing evidence', () => {
  const journal = buildStyleJournal({
    inputSnapshotHash: 'snapshot-1',
    engineVersion: 'wearlog-aesthetic-v4.0.0',
    generatedAt: '2026-08-16T00:00:00.000Z',
    principles: [{
      id: 'principle-1', title: '把颜色当作连接', statement: '用颜色呼应建立整体感。', condition: '有色彩关系时', mechanism: '跨槽位重复色彩', effect: '不同单品形成整体', kind: 'self_aware',
      supportMatchIds: ['match-1', 'match-2', 'match-3'], representativeMatchIds: ['match-1'], evidenceIds: ['e:principle'], counterexampleMatchIds: [], unresolvedQuestionIds: [], confirmedCoverage: 1, holdoutSupport: true, supportNote: '3 套案例', decisionMechanismIds: ['mechanism-1'], reconnectedEvidenceIds: ['e:principle'], reconnectionCoverage: 1, reconnectionStatus: 'reconnected', ruleValidation: { scope: 'affected_slots', slots: ['bottoms'], cases: 3, engineTop3: 3, baselineTop3: 1, passed: true, note: '通过' },
    }],
    outfitCases: [
      { matchId: 'match-1', name: '第一套', story: '', anchorItemId: 'top-a', anchorItemName: '黑外套', tier: 'mature', primaryItems: [], variantItems: [], relations: [], decisionMechanisms: [], mechanismKeys: [], explicitClaimIds: [], evidenceCoverage: 1, composition: {} as any },
      { matchId: 'match-2', name: '第二套', story: '', anchorItemId: 'top-b', anchorItemName: '灰外套', tier: 'mature', primaryItems: [], variantItems: [], relations: [], decisionMechanisms: [], mechanismKeys: [], explicitClaimIds: [], evidenceCoverage: 1, composition: {} as any },
      { matchId: 'match-3', name: '第三套', story: '', anchorItemId: 'top-a', anchorItemName: '黑外套', tier: 'mature', primaryItems: [], variantItems: [], relations: [], decisionMechanisms: [], mechanismKeys: [], explicitClaimIds: [], evidenceCoverage: 1, composition: {} as any },
    ],
    colorInsights: [{ id: 'color-1', kind: 'outfit_pairing', title: '黑色与灰色', statement: '黑色核心与灰色下装形成稳定承接。', level: 'stable', itemIds: ['top-a', 'bottom-a'], matchIds: ['match-1'], evidenceIds: ['e:color'], confirmedCoverage: 1 }],
    designHighlights: [{ id: 'design-1', title: '结构细节', statement: '设计焦点通常由核心外衣承担。', level: 'stable', itemIds: ['top-a'], matchIds: ['match-1'], evidenceIds: ['e:design'], confirmedCoverage: 1 }],
    opportunities: [{
      id: 'opportunity-1', sourceMatchId: 'match-1', sourceAnchorItemId: 'top-a', anchorItemId: 'top-a', anchorItemName: '黑外套', targetSlot: 'bottoms', replacesItemId: 'bottom-a', replacesItemName: '灰裤', candidateItemId: 'bottom-b', candidateItemName: '黑裤', reasons: ['维持重心'], evidenceIds: ['e:opportunity'], score: 5,
      paletteAssessment: { ruleVersion: 'outfit-palette-v1', status: 'strict', sourceMatchId: 'match-1', sourceAnchorItemId: 'top-a', completeBase: true, relation: 'ground', summary: '深色下装压住重心。', evidenceIds: ['e:opportunity'], structuralEvidenceIds: ['e:structure'], supportEdgeCount: 2, affectedSlots: ['bottoms', 'shoes'] },
    }],
  });

  assert.equal(journal.stage, 'established');
  assert.deepEqual(journal.chapters.map((chapter) => chapter.id), ['core', 'outfit-method', 'palette', 'design', 'anchors', 'evolution']);
  assert.equal(journal.chapters[0].sourceIds.includes('e:principle'), true);
  assert.equal(journal.chapters[2].caseIds[0], 'match-1');
  assert.equal(journal.snapshotHash, 'snapshot-1');
});

test('keeps a sparse wardrobe in observation mode instead of inventing a stable style', () => {
  const journal = buildStyleJournal({
    inputSnapshotHash: 'sparse',
    engineVersion: 'v4',
    generatedAt: '2026-08-16T00:00:00.000Z',
    principles: [],
    outfitCases: [],
    colorInsights: [],
    designHighlights: [],
    opportunities: [],
  });

  assert.equal(journal.stage, 'starting');
  assert.match(journal.portrait, /观察/);
  assert.match(journal.chapters.find((chapter) => chapter.id === 'core')?.summary || '', /还在观察/);
});
