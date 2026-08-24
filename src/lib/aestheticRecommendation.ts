import type { CombinationOpportunity, OutfitCaseGraph, PerceptualColor, SemanticAtom } from './aestheticAnalysisV3';
import type { BestMatch, BestMatchItems, BestMatchSlot, WardrobeItem } from '../types';
import { PALETTE_RULE_VERSION, evaluateOutfitPalette, type PaletteAssessment, type PaletteSelection, type PaletteSlot } from './outfitPalette';

export type RecommendationSlot = keyof BestMatchItems;

export type RecommendationSelection = {
  slot: RecommendationSlot;
  index: number;
  itemId: string;
};

export type RecommendationReason = {
  text: string;
  evidenceIds: string[];
};

export type RecommendationOrigin = 'replacement' | 'direct' | 'reference';
export type RecommendationReferenceLevel = 'canonical' | 'variant';
export type RecommendationTier = 'strict' | 'exploration';

export type OutfitRecommendation = {
  id: string;
  recommendationKey: string;
  anchorItemId: string;
  sourceMatchId: string;
  kind: 'new' | 'history';
  origin: RecommendationOrigin;
  referenceLevel?: RecommendationReferenceLevel;
  selections: RecommendationSelection[];
  changedSlot?: RecommendationSlot;
  replacedItemId?: string;
  candidateItemId?: string;
  opportunityId?: string;
  tier?: RecommendationTier;
  paletteAssessment?: PaletteAssessment;
  sourceAnchorItemId?: string;
  ruleVersion?: string;
  snapshotHash?: string;
  engineVersion?: string;
  reasons: RecommendationReason[];
  confidence: 'early' | 'supported';
  score: number;
};

export type RecommendationRun = {
  inputSnapshotHash?: string;
  engineVersion?: string;
  recommendationRuleVersion?: string;
  opportunities: CombinationOpportunity[];
  outfitCases?: OutfitCaseGraph[];
  atoms?: SemanticAtom[];
  colors?: PerceptualColor[];
};

export type RecommendationOptions = {
  rejectedKeys?: ReadonlySet<string>;
  resolvedKeys?: ReadonlySet<string>;
  maxNew?: number;
  maxHistory?: number;
};

const SLOT_ORDER: RecommendationSlot[] = ['tops', 'bottoms', 'shoes', 'accessories'];

const SLOT_CATEGORY: Record<RecommendationSlot, WardrobeItem['category']> = {
  tops: '上装',
  bottoms: '下装',
  shoes: '鞋子',
  accessories: '配饰',
};

function selectionKey(selections: RecommendationSelection[]) {
  return selections
    .slice()
    .sort((left, right) => SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot) || left.index - right.index)
    .map((entry) => `${entry.slot}:${entry.index}:${entry.itemId}`)
    .join('|');
}

function matchSelections(match: BestMatch): RecommendationSelection[] {
  return SLOT_ORDER.flatMap((slot) => match.items[slot].map((entry, index) => ({ slot, index, itemId: entry.primary })));
}

function selectionsForAnchor(match: BestMatch, anchorItemId: string) {
  const primary = matchSelections(match);
  if (primary.some((entry) => entry.itemId === anchorItemId)) return primary;

  for (const slot of SLOT_ORDER) {
    const variantIndex = match.items[slot].findIndex((entry) => (entry.variants || []).includes(anchorItemId));
    if (variantIndex < 0) continue;
    const next = primary.map((selection) => (
      selection.slot === slot && selection.index === variantIndex
        ? { ...selection, itemId: anchorItemId }
        : selection
    ));
    if (isComplete(next)) return next;
  }

  return null;
}

function isComplete(selections: RecommendationSelection[]) {
  return selections.some((entry) => entry.slot === 'tops') && selections.some((entry) => entry.slot === 'bottoms');
}

function isCompleteBase(selections: RecommendationSelection[]) {
  return selections.filter((entry) => entry.slot === 'tops').length >= 2
    && selections.some((entry) => entry.slot === 'bottoms')
    && selections.some((entry) => entry.slot === 'shoes');
}

function itemIdsForSlot(entry: BestMatchSlot) {
  return [entry.primary, ...(entry.variants || [])];
}

function expandedMatchCompositions(match: BestMatch, max = 256): RecommendationSelection[][] {
  const slots = SLOT_ORDER.flatMap((slot) => match.items[slot].flatMap((entry, index) => itemIdsForSlot(entry).map((itemId) => ({ slot, index, itemId }))));
  const compositions: RecommendationSelection[][] = [[]];
  for (const slot of slots) {
    const next: RecommendationSelection[][] = [];
    for (const composition of compositions) {
      next.push([...composition, slot]);
      if (next.length >= max) break;
    }
    compositions.splice(0, compositions.length, ...next);
    if (!compositions.length) break;
  }
  return compositions.filter(isComplete);
}

function hasAnchor(match: BestMatch, anchorItemId: string) {
  return match.allItemIds.includes(anchorItemId)
    || SLOT_ORDER.some((slot) => match.items[slot].some((entry) => itemIdsForSlot(entry).includes(anchorItemId)));
}

function trimAccessories(selections: RecommendationSelection[]) {
  let accessorySeen = false;
  return selections.filter((entry) => {
    if (entry.slot !== 'accessories') return true;
    if (accessorySeen) return false;
    accessorySeen = true;
    return true;
  });
}

function compatible(target: WardrobeItem | undefined, candidate: WardrobeItem | undefined, slot: RecommendationSlot) {
  if (!target || !candidate || candidate.category !== SLOT_CATEGORY[slot]) return false;
  if (slot === 'accessories' && target.accessoryType && candidate.accessoryType) return target.accessoryType === candidate.accessoryType;
  return true;
}

export function recommendationContextKey(input: {
  sourceMatchId: string;
  anchorItemId: string;
  changedSlot: RecommendationSlot;
  replacedItemId: string;
  candidateItemId: string;
}) {
  return [input.sourceMatchId, input.anchorItemId, input.changedSlot, input.replacedItemId, input.candidateItemId].join('|');
}

function historyRecommendation(match: BestMatch, anchorItemId: string, selections: RecommendationSelection[], changedSlot?: RecommendationSlot, replacedItemId?: string, variantIndex?: number): OutfitRecommendation {
  const key = recommendationContextKey({
    sourceMatchId: match.id,
    anchorItemId,
    changedSlot: changedSlot || 'tops',
    replacedItemId: replacedItemId || anchorItemId,
    candidateItemId: anchorItemId,
  });
  return {
    id: `history:${match.id}:${anchorItemId}:${changedSlot || 'primary'}:${variantIndex ?? 'primary'}`,
    recommendationKey: key,
    anchorItemId,
    sourceMatchId: match.id,
    kind: 'history',
    origin: 'reference',
    referenceLevel: changedSlot ? 'variant' : 'canonical',
    selections: trimAccessories(selections),
    changedSlot,
    replacedItemId,
    candidateItemId: changedSlot ? anchorItemId : undefined,
    reasons: [],
    confidence: 'supported',
    score: 0,
  };
}

function structuralReasons(anchor: WardrobeItem, replaced: WardrobeItem, run: RecommendationRun) {
  const reasons: RecommendationReason[] = [];
  const anchorAtoms = (run.atoms || []).filter((atom) => atom.itemId === anchor.id && atom.evidenceStatus === 'confirmed');
  const replacedAtoms = (run.atoms || []).filter((atom) => atom.itemId === replaced.id && atom.evidenceStatus === 'confirmed');
  const sharedAtoms = anchorAtoms.filter((left) => replacedAtoms.some((right) => left.normalized && left.normalized === right.normalized)).slice(0, 2);
  if (sharedAtoms.length) reasons.push({ text: `两件单品共享${sharedAtoms.map((atom) => atom.value).join('、')}的风格或结构条件`, evidenceIds: sharedAtoms.map((atom) => `e:${atom.id}`) });
  if (anchor.category === replaced.category && ((anchor.topType && anchor.topType === replaced.topType) || (anchor.length && anchor.length === replaced.length))) {
    reasons.push({ text: '两件单品承担相近的功能位置，替换后不会破坏基础结构', evidenceIds: [`e:slot:${replaced.id}`] });
  }
  return reasons;
}

function asPaletteSelections(selections: RecommendationSelection[]) {
  return selections as PaletteSelection[];
}

function assessmentFor(
  run: RecommendationRun,
  sourceMatch: BestMatch,
  sourceSelections: RecommendationSelection[],
  selections: RecommendationSelection[],
  changedSlot: RecommendationSlot,
  structural: RecommendationReason[],
) {
  const sourceCase = run.outfitCases?.find((entry) => entry.matchId === sourceMatch.id);
  if (!sourceCase || !run.colors?.length) return null;
  return evaluateOutfitPalette({
    sourceCase,
    sourceSelections: asPaletteSelections(sourceSelections),
    selections: asPaletteSelections(selections),
    changedSlot: changedSlot as PaletteSlot,
    colors: run.colors,
    structuralEvidenceIds: structural.flatMap((reason) => reason.evidenceIds),
  });
}

function scoreRecommendation(assessment: PaletteAssessment, structural: RecommendationReason[], candidate?: WardrobeItem, opportunityScore = 0) {
  const rating = typeof candidate?.rating === 'number' && Number.isFinite(candidate.rating) ? candidate.rating : 0;
  const feedbackScore = opportunityScore > 0 ? Math.min(opportunityScore, 160) * 0.05 : 0;
  return (assessment.status === 'strict' ? 1000 : 100) + assessment.supportEdgeCount * 30 + structural.length * 12 + rating + feedbackScore;
}

function reasonsFor(assessment: PaletteAssessment, structural: RecommendationReason[]) {
  return [
    { text: assessment.summary, evidenceIds: assessment.evidenceIds },
    ...structural,
    ...(assessment.newVariable ? [{ text: assessment.newVariable, evidenceIds: assessment.evidenceIds }] : []),
  ];
}

function directRecommendation(
  match: BestMatch,
  anchorItemId: string,
  anchor: WardrobeItem,
  targetSlot: RecommendationSlot,
  targetIndex: number,
  items: Map<string, WardrobeItem>,
  run: RecommendationRun,
): OutfitRecommendation | null {
  const targetEntry = match.items[targetSlot][targetIndex];
  const replaced = items.get(targetEntry.primary);
  if (!replaced || replaced.id === anchor.id) return null;
  const structural = structuralReasons(anchor, replaced, run);
  if (!structural.length) return null;
  const primary = matchSelections(match);
  const next = primary.map((selection) => selection.slot === targetSlot && selection.index === targetIndex ? { ...selection, itemId: anchor.id } : selection);
  if (!isCompleteBase(next)) return null;
  const assessment = assessmentFor(run, match, primary, next, targetSlot, structural);
  if (!assessment || assessment.status === 'rejected') return null;
  const trimmed = trimAccessories(next);
  const key = recommendationContextKey({ sourceMatchId: match.id, anchorItemId, changedSlot: targetSlot, replacedItemId: replaced.id, candidateItemId: anchor.id });
  return {
    id: `direct:${key}`,
    recommendationKey: key,
    anchorItemId,
    sourceMatchId: match.id,
    kind: 'new',
    origin: 'direct',
    selections: trimmed,
    changedSlot: targetSlot,
    replacedItemId: replaced.id,
    candidateItemId: anchor.id,
    tier: assessment.status,
    paletteAssessment: assessment,
    sourceAnchorItemId: assessment.sourceAnchorItemId,
    ruleVersion: assessment.ruleVersion,
    snapshotHash: run.inputSnapshotHash,
    engineVersion: run.engineVersion,
    reasons: reasonsFor(assessment, structural),
    confidence: assessment.status === 'strict' ? 'supported' : 'early',
    score: scoreRecommendation(assessment, structural, anchor),
  };
}

function directAccessoryRecommendation(
  match: BestMatch,
  anchorItemId: string,
  anchor: WardrobeItem,
  items: Map<string, WardrobeItem>,
  run: RecommendationRun,
): OutfitRecommendation | null {
  if (anchor.category !== '配饰') return null;
  const primary = matchSelections(match);
  const next = [...primary, { slot: 'accessories' as const, index: 0, itemId: anchorItemId }];
  if (!isCompleteBase(next)) return null;
  const core = items.get(match.items.tops[0]?.primary || '');
  if (!core) return null;
  const structural = structuralReasons(anchor, core, run);
  if (!structural.length) return null;
  const assessment = assessmentFor(run, match, primary, next, 'accessories', structural);
  if (!assessment || assessment.status === 'rejected') return null;
  const key = recommendationContextKey({ sourceMatchId: match.id, anchorItemId, changedSlot: 'accessories', replacedItemId: 'none', candidateItemId: anchorItemId });
  return {
    id: `direct:${key}`,
    recommendationKey: key,
    anchorItemId,
    sourceMatchId: match.id,
    kind: 'new',
    origin: 'direct',
    selections: trimAccessories(next),
    changedSlot: 'accessories',
    candidateItemId: anchorItemId,
    tier: assessment.status,
    paletteAssessment: assessment,
    sourceAnchorItemId: assessment.sourceAnchorItemId,
    ruleVersion: assessment.ruleVersion,
    snapshotHash: run.inputSnapshotHash,
    engineVersion: run.engineVersion,
    reasons: reasonsFor(assessment, structural),
    confidence: assessment.status === 'strict' ? 'supported' : 'early',
    score: scoreRecommendation(assessment, structural, anchor),
  };
}

export function isPaletteRecommendationRunCurrent(run: RecommendationRun | null | undefined, currentSnapshotHash: string) {
  if (!run || run.inputSnapshotHash !== currentSnapshotHash || run.recommendationRuleVersion !== PALETTE_RULE_VERSION) return false;
  if (!Array.isArray(run.outfitCases) || !Array.isArray(run.colors)) return false;
  return run.opportunities.every((opportunity) => (
    Boolean(opportunity.sourceMatchId)
    && Boolean(opportunity.sourceAnchorItemId)
    && opportunity.paletteAssessment?.ruleVersion === PALETTE_RULE_VERSION
    && opportunity.paletteAssessment.sourceMatchId === opportunity.sourceMatchId
    && opportunity.paletteAssessment.sourceAnchorItemId === opportunity.sourceAnchorItemId
  ));
}

export function buildOutfitRecommendations(
  anchorItemId: string,
  matches: BestMatch[],
  items: WardrobeItem[],
  run: RecommendationRun,
  options: RecommendationOptions = {},
) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const anchor = itemMap.get(anchorItemId);
  if (!anchor) return [] as OutfitRecommendation[];

  const recordedCompositions = new Set(matches.flatMap((match) => expandedMatchCompositions(match).map(selectionKey)));
  const history: OutfitRecommendation[] = [];
  const seenHistory = new Set<string>();

  for (const match of matches) {
    if (!hasAnchor(match, anchorItemId)) continue;
    const primary = matchSelections(match);
    if (isComplete(primary) && primary.some((entry) => entry.itemId === anchorItemId)) {
      const option = historyRecommendation(match, anchorItemId, primary);
      if (!seenHistory.has(option.id)) { seenHistory.add(option.id); history.push(option); }
    }
    SLOT_ORDER.forEach((slot) => match.items[slot].forEach((entry, index) => {
      if (!(entry.variants || []).includes(anchorItemId)) return;
      const replacedItemId = entry.primary;
      const next = primary.map((selection) => selection.slot === slot && selection.index === index ? { ...selection, itemId: anchorItemId } : selection);
      if (!isComplete(next)) return;
      const option = historyRecommendation(match, anchorItemId, next, slot, replacedItemId, index);
      if (!seenHistory.has(option.id)) { seenHistory.add(option.id); history.push(option); }
    }));
  }

  const fresh: OutfitRecommendation[] = [];
  const seenFresh = new Set<string>();
  for (const opportunity of run.opportunities) {
    const slot = opportunity.targetSlot as RecommendationSlot;
    if (!SLOT_ORDER.includes(slot)) continue;
    // An opportunity is a contract with one specific Best Match. Never borrow its
    // colour evidence for another skeleton merely because the target slot happens
    // to contain the same item.
    const sourceMatch = matches.find((match) => match.id === opportunity.sourceMatchId);
    if (!sourceMatch) continue;
    const targetIndex = sourceMatch.items[slot].findIndex((entry) => entry.primary === opportunity.replacesItemId);
    if (targetIndex < 0) continue;
    const candidate = itemMap.get(opportunity.candidateItemId);
    const replaced = itemMap.get(opportunity.replacesItemId);
    if (!compatible(replaced, candidate, slot) || opportunity.candidateItemId === anchorItemId) continue;
    const primary = selectionsForAnchor(sourceMatch, anchorItemId);
    if (!primary) continue;
    const next = primary.map((selection) => selection.slot === slot && selection.index === targetIndex ? { ...selection, itemId: opportunity.candidateItemId } : selection);
    if (!isCompleteBase(next) || !next.some((entry) => entry.itemId === anchorItemId)) continue;
    const structural = opportunity.reasons
      .filter((reason) => !/色彩|颜色|明度|重心|鞋履/.test(reason))
      .map((text) => ({ text, evidenceIds: opportunity.paletteAssessment.structuralEvidenceIds }));
    const liveAssessment = assessmentFor(run, sourceMatch, matchSelections(sourceMatch), next, slot, structural);
    const assessment = liveAssessment || opportunity.paletteAssessment;
    if (assessment.status === 'rejected') continue;
    if (assessment.sourceMatchId !== sourceMatch.id || assessment.sourceAnchorItemId !== opportunity.sourceAnchorItemId) continue;
    const key = recommendationContextKey({ sourceMatchId: sourceMatch.id, anchorItemId, changedSlot: slot, replacedItemId: opportunity.replacesItemId, candidateItemId: opportunity.candidateItemId });
    if (options.rejectedKeys?.has(key) || options.resolvedKeys?.has(key) || recordedCompositions.has(selectionKey(next)) || seenFresh.has(key)) continue;
    seenFresh.add(key);
    fresh.push({
      id: `recommendation:${key}`,
      recommendationKey: key,
      anchorItemId,
      sourceMatchId: sourceMatch.id,
      kind: 'new',
      origin: 'replacement',
      selections: next,
      changedSlot: slot,
      replacedItemId: opportunity.replacesItemId,
      candidateItemId: opportunity.candidateItemId,
      opportunityId: opportunity.id,
      tier: assessment.status,
      paletteAssessment: assessment,
      sourceAnchorItemId: assessment.sourceAnchorItemId,
      ruleVersion: assessment.ruleVersion,
      snapshotHash: run.inputSnapshotHash,
      engineVersion: run.engineVersion,
      reasons: reasonsFor(assessment, structural),
      confidence: assessment.status === 'strict' ? 'supported' : 'early',
      score: scoreRecommendation(assessment, structural, candidate, opportunity.score),
    });
  }

  for (const match of matches) {
    if (hasAnchor(match, anchorItemId)) continue;
    const directSlots = SLOT_ORDER.filter((slot) => slot !== 'accessories' && match.items[slot].length > 0 && SLOT_CATEGORY[slot] === itemMap.get(anchorItemId)?.category);
    const accessorySlots = anchor.category === '配饰' && match.items.accessories.length === 0 ? ['accessories' as RecommendationSlot] : [];
    for (const slot of [...directSlots, ...accessorySlots]) {
      const targetIndexes = match.items[slot].map((_, index) => index);
      if (slot === 'accessories' && !targetIndexes.length) targetIndexes.push(0);
      for (const targetIndex of targetIndexes) {
        const recommendation = slot === 'accessories' && !match.items.accessories.length
          ? directAccessoryRecommendation(match, anchorItemId, anchor, itemMap, run)
          : directRecommendation(match, anchorItemId, itemMap.get(anchorItemId)!, slot, targetIndex, itemMap, run);
        if (!recommendation) continue;
        const composition = selectionKey(recommendation.selections);
        if (options.rejectedKeys?.has(recommendation.recommendationKey) || options.resolvedKeys?.has(recommendation.recommendationKey) || recordedCompositions.has(composition) || seenFresh.has(recommendation.recommendationKey)) continue;
        seenFresh.add(recommendation.recommendationKey);
        fresh.push(recommendation);
      }
    }
  }

  const sortedFresh = fresh.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const strictFresh = sortedFresh.filter((recommendation) => recommendation.tier === 'strict');
  const explorationFresh = sortedFresh.filter((recommendation) => recommendation.tier === 'exploration');
  const maxStrict = Math.min(options.maxNew ?? 3, 3);
  const referenceRank = (recommendation: OutfitRecommendation) => recommendation.referenceLevel === 'canonical' ? 0 : 1;
  const sortedHistory = history
    .sort((left, right) => referenceRank(left) - referenceRank(right) || left.sourceMatchId.localeCompare(right.sourceMatchId) || left.id.localeCompare(right.id))
    .slice(0, options.maxHistory ?? 3);
  return [
    ...(strictFresh.length ? strictFresh.slice(0, maxStrict) : explorationFresh.slice(0, 1)),
    ...sortedHistory,
  ];
}
