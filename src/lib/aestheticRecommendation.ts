import type { CombinationOpportunity } from './aestheticAnalysisV3';
import type { BestMatch, BestMatchItems, BestMatchSlot, WardrobeItem } from '../types';

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

export type OutfitRecommendation = {
  id: string;
  recommendationKey: string;
  anchorItemId: string;
  sourceMatchId: string;
  kind: 'new' | 'history';
  selections: RecommendationSelection[];
  changedSlot?: RecommendationSlot;
  replacedItemId?: string;
  candidateItemId?: string;
  opportunityId?: string;
  reasons: RecommendationReason[];
  confidence: 'early' | 'supported';
  score: number;
};

export type RecommendationRun = {
  opportunities: CombinationOpportunity[];
};

export type RecommendationOptions = {
  rejectedKeys?: ReadonlySet<string>;
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

function isComplete(selections: RecommendationSelection[]) {
  return selections.some((entry) => entry.slot === 'tops') && selections.some((entry) => entry.slot === 'bottoms');
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

function historyRecommendation(match: BestMatch, anchorItemId: string, selections: RecommendationSelection[], changedSlot?: RecommendationSlot, replacedItemId?: string): OutfitRecommendation {
  const key = recommendationContextKey({
    sourceMatchId: match.id,
    anchorItemId,
    changedSlot: changedSlot || 'tops',
    replacedItemId: replacedItemId || anchorItemId,
    candidateItemId: anchorItemId,
  });
  return {
    id: `history:${match.id}:${anchorItemId}:${changedSlot || 'primary'}`,
    recommendationKey: key,
    anchorItemId,
    sourceMatchId: match.id,
    kind: 'history',
    selections,
    changedSlot,
    replacedItemId,
    candidateItemId: changedSlot ? anchorItemId : undefined,
    reasons: [],
    confidence: 'supported',
    score: 0,
  };
}

export function buildOutfitRecommendations(
  anchorItemId: string,
  matches: BestMatch[],
  items: WardrobeItem[],
  run: RecommendationRun,
  options: RecommendationOptions = {},
) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  if (!itemMap.has(anchorItemId)) return [] as OutfitRecommendation[];

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
      const option = historyRecommendation(match, anchorItemId, next, slot, replacedItemId);
      if (!seenHistory.has(option.id)) { seenHistory.add(option.id); history.push(option); }
    }));
  }

  const fresh: OutfitRecommendation[] = [];
  const seenFresh = new Set<string>();
  for (const opportunity of run.opportunities) {
    if (opportunity.anchorItemId !== anchorItemId) continue;
    const sourceMatch = matches.find((match) => hasAnchor(match, anchorItemId) && match.items[opportunity.targetSlot as RecommendationSlot]?.some((entry) => entry.primary === opportunity.replacesItemId));
    if (!sourceMatch) continue;
    const slot = opportunity.targetSlot as RecommendationSlot;
    if (!SLOT_ORDER.includes(slot)) continue;
    const targetIndex = sourceMatch.items[slot].findIndex((entry) => entry.primary === opportunity.replacesItemId);
    if (targetIndex < 0) continue;
    const candidate = itemMap.get(opportunity.candidateItemId);
    const replaced = itemMap.get(opportunity.replacesItemId);
    if (!compatible(replaced, candidate, slot) || opportunity.candidateItemId === anchorItemId) continue;
    const primary = matchSelections(sourceMatch);
    const next = primary.map((selection) => selection.slot === slot && selection.index === targetIndex ? { ...selection, itemId: opportunity.candidateItemId } : selection);
    if (!isComplete(next) || !next.some((entry) => entry.itemId === anchorItemId)) continue;
    const key = recommendationContextKey({ sourceMatchId: sourceMatch.id, anchorItemId, changedSlot: slot, replacedItemId: opportunity.replacesItemId, candidateItemId: opportunity.candidateItemId });
    if (options.rejectedKeys?.has(key) || recordedCompositions.has(selectionKey(next)) || seenFresh.has(key)) continue;
    seenFresh.add(key);
    fresh.push({
      id: `recommendation:${key}`,
      recommendationKey: key,
      anchorItemId,
      sourceMatchId: sourceMatch.id,
      kind: 'new',
      selections: next,
      changedSlot: slot,
      replacedItemId: opportunity.replacesItemId,
      candidateItemId: opportunity.candidateItemId,
      opportunityId: opportunity.id,
      reasons: opportunity.reasons.map((text) => ({ text, evidenceIds: opportunity.evidenceIds })),
      confidence: opportunity.score >= 6 ? 'supported' : 'early',
      score: opportunity.score,
    });
  }

  const sortedFresh = fresh.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const sortedHistory = history.sort((left, right) => left.sourceMatchId.localeCompare(right.sourceMatchId) || left.id.localeCompare(right.id));
  return [
    ...sortedFresh.slice(0, options.maxNew ?? 3),
    ...sortedHistory.slice(0, options.maxHistory ?? 3),
  ];
}
