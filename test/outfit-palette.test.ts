import assert from 'node:assert/strict';
import test from 'node:test';
import type { OutfitCaseGraph, PerceptualColor } from '../src/lib/aestheticAnalysisV3';
import { PALETTE_RULE_VERSION, evaluateOutfitPalette } from '../src/lib/outfitPalette';

type PaletteColor = Omit<PerceptualColor, 'rgb' | 'hex'> & { rgb?: [number, number, number]; hex?: string };

function color(itemId: string, lab: [number, number, number], oklch: [number, number, number], role: PerceptualColor['role'] = 'dominant'): PerceptualColor {
  const value: PaletteColor = {
    itemId,
    rgb: [128, 128, 128],
    hex: '#808080',
    role,
    areaRatio: role === 'dominant' ? 0.82 : 0.18,
    lab,
    oklch,
    source: 'user',
    evidenceStatus: 'confirmed',
  };
  return value as PerceptualColor;
}

const sourceCase = {
  matchId: 'mint-source',
  name: '水绿色夹克',
  anchorItemId: 'mint-outer',
  anchorItemName: '水绿色夹克',
  primaryItems: [
    { itemId: 'mint-outer', itemName: '水绿色夹克', slot: 'tops' },
    { itemId: 'white-inner', itemName: '白色内搭', slot: 'tops' },
    { itemId: 'navy-bottom', itemName: '深蓝下装', slot: 'bottoms' },
    { itemId: 'navy-shoe', itemName: '深蓝鞋', slot: 'shoes' },
  ],
  relations: [
    { id: 'r-inner', matchId: 'mint-source', anchorItemId: 'mint-outer', supportItemId: 'white-inner', slot: 'tops', operation: 'color_lighten', effect: '以浅色内搭提亮', evidenceIds: ['e:inner'], confidence: 1 },
    { id: 'r-bottom', matchId: 'mint-source', anchorItemId: 'mint-outer', supportItemId: 'navy-bottom', slot: 'bottoms', operation: 'color_ground', effect: '以深色下装压住重心', evidenceIds: ['e:bottom'], confidence: 1 },
    { id: 'r-shoe', matchId: 'mint-source', anchorItemId: 'mint-outer', supportItemId: 'navy-shoe', slot: 'shoes', operation: 'color_ground', effect: '鞋履承接下半身', evidenceIds: ['e:shoe'], confidence: 1 },
  ],
} as OutfitCaseGraph;

const sourceSelections = [
  { slot: 'tops', index: 0, itemId: 'mint-outer' },
  { slot: 'tops', index: 1, itemId: 'white-inner' },
  { slot: 'bottoms', index: 0, itemId: 'navy-bottom' },
  { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
] as const;

const colors = [
  color('mint-outer', [70, -24, 7], [0.72, 0.09, 162]),
  color('white-inner', [96, 0, 1], [0.96, 0.01, 90]),
  color('navy-bottom', [24, 5, -18], [0.28, 0.04, 258]),
  color('navy-shoe', [19, 4, -15], [0.22, 0.03, 255]),
  color('navy-bottom-new', [26, 6, -20], [0.3, 0.045, 258]),
  color('red-bottom', [55, 67, 42], [0.58, 0.22, 28]),
  color('black-bottom', [16, 0, 0], [0.17, 0.01, 0]),
  color('blue-exploration-bottom', [45, 7, -22], [0.5, 0.05, 258]),
  color('mint-outer-new', [69, -23, 8], [0.71, 0.09, 162]),
];

function assess(next: Array<{ slot: 'tops' | 'bottoms' | 'shoes' | 'accessories'; index: number; itemId: string }>, changedSlot: 'tops' | 'bottoms' | 'shoes' | 'accessories', structuralEvidenceIds = ['e:structure']) {
  return evaluateOutfitPalette({
    sourceCase,
    sourceSelections: [...sourceSelections],
    selections: next,
    changedSlot,
    colors,
    structuralEvidenceIds,
  });
}

test('rejects a candidate that echoes the outer layer locally but breaks the lower-half palette', () => {
  const assessment = assess([
    { slot: 'tops', index: 0, itemId: 'mint-outer' },
    { slot: 'tops', index: 1, itemId: 'white-inner' },
    { slot: 'bottoms', index: 0, itemId: 'red-bottom' },
    { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
  ], 'bottoms');

  assert.equal(assessment.status, 'rejected');
  assert.match(assessment.rejectionReason || '', /下装|鞋|整套/);
});

test('accepts an observed grounding grammar when the replacement keeps the outfit connected', () => {
  const assessment = assess([
    { slot: 'tops', index: 0, itemId: 'mint-outer' },
    { slot: 'tops', index: 1, itemId: 'white-inner' },
    { slot: 'bottoms', index: 0, itemId: 'navy-bottom-new' },
    { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
  ], 'bottoms');

  assert.equal(assessment.status, 'strict');
  assert.equal(assessment.relation, 'ground');
  assert.match(assessment.summary, /深色下装|鞋履|压住重心/);
  assert.equal(assessment.ruleVersion, PALETTE_RULE_VERSION);
});

test('does not let a neutral replacement pass on colour alone', () => {
  const assessment = assess([
    { slot: 'tops', index: 0, itemId: 'mint-outer' },
    { slot: 'tops', index: 1, itemId: 'white-inner' },
    { slot: 'bottoms', index: 0, itemId: 'black-bottom' },
    { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
  ], 'bottoms', []);

  assert.equal(assessment.status, 'rejected');
  assert.match(assessment.rejectionReason || '', /中性色|结构/);
});

test('offers a single controlled exploration when only one recorded colour relation changes', () => {
  const assessment = assess([
    { slot: 'tops', index: 0, itemId: 'mint-outer' },
    { slot: 'tops', index: 1, itemId: 'white-inner' },
    { slot: 'bottoms', index: 0, itemId: 'blue-exploration-bottom' },
    { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
  ], 'bottoms');

  assert.equal(assessment.status, 'exploration');
  assert.match(assessment.newVariable || '', /本次新变量/);
});

test('keeps a direct outerwear insertion only when the complete base preserves the source palette grammar', () => {
  const assessment = assess([
    { slot: 'tops', index: 0, itemId: 'mint-outer-new' },
    { slot: 'tops', index: 1, itemId: 'white-inner' },
    { slot: 'bottoms', index: 0, itemId: 'navy-bottom' },
    { slot: 'shoes', index: 0, itemId: 'navy-shoe' },
  ], 'tops');

  assert.equal(assessment.status, 'strict');
  assert.equal(assessment.completeBase, true);
  assert.ok(assessment.supportEdgeCount >= 2);
});
