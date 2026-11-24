import type { BestMatch, WardrobeItem } from '../types';
import { colorFamily, type AnalysisRun, type SemanticAtom } from './aestheticAnalysisV3';
import { buildOutfitRecommendations, type RecommendationSelection } from './aestheticRecommendation';
import { evaluateOutfitPalette, type PaletteAssessment } from './outfitPalette';
import { journalSubstitutions } from './styleJournalView';

const slots = ['tops', 'bottoms', 'shoes', 'accessories'] as const;
type Slot = typeof slots[number];
const isSlot = (value: string): value is Slot => slots.some((slot) => slot === value);

export type JournalInspiration = {
  id: string;
  kind: 'new' | 'saved';
  from: WardrobeItem;
  to: WardrobeItem;
  match: BestMatch;
  slot: Slot;
  description: string;
  evidenceIds: string[];
  assessment?: PaletteAssessment;
};

function selections(match: BestMatch): RecommendationSelection[] {
  return slots.flatMap((slot) => match.items[slot].map((entry, index) => ({ slot, index, itemId: entry.primary })));
}

/** Compare the complete outfit, including every accessory. */
export function isSingleJournalChange(match: BestMatch, next: RecommendationSelection[], from: string, to: string) {
  const previous = selections(match);
  if (previous.length !== next.length) return false;
  const positions = new Set(next.map((entry) => `${entry.slot}:${entry.index}`));
  if (positions.size !== next.length) return false;
  const changed = previous.filter((entry) => next.find((part) => part.slot === entry.slot && part.index === entry.index)?.itemId !== entry.itemId);
  return changed.length === 1 && changed[0].itemId === from
    && next.find((entry) => entry.slot === changed[0].slot && entry.index === changed[0].index)?.itemId === to;
}

/** Test membership without enumerating the Cartesian product of saved variants. */
export function isRecordedJournalCombination(next: RecommendationSelection[], matches: BestMatch[]) {
  return matches.some((match) => selections(match).length === next.length && slots.every((slot) => {
    const proposed = next.filter((entry) => entry.slot === slot).map((entry) => entry.itemId);
    const stored = match.items[slot];
    if (proposed.length !== stored.length) return false;
    // Item order within a slot must not make an already saved look appear new.
    const assign = (index: number, used: Set<number>): boolean => index === proposed.length || stored.some((entry, position) => {
      if (used.has(position) || (entry.primary !== proposed[index] && !entry.variants?.includes(proposed[index]))) return false;
      return assign(index + 1, new Set([...used, position]));
    });
    return assign(0, new Set());
  }));
}

function sharedStructure(run: AnalysisRun, from: string, to: string) {
  const useful = new Set<SemanticAtom['field']>(['silhouette', 'material', 'style', 'design_highlight']);
  const left = run.atoms.filter((atom) => atom.itemId === from && atom.evidenceStatus === 'confirmed' && useful.has(atom.field));
  const right = run.atoms.filter((atom) => atom.itemId === to && atom.evidenceStatus === 'confirmed' && useful.has(atom.field));
  const usefulConcepts = new Set(['宽松体量', '收束线条', '机能表达', '正式表达', '轻盈材质', '厚重材质']);
  const concepts = (atom: SemanticAtom) => (run.conceptRelations || [])
    .filter((relation) => relation.kind === 'broader' && usefulConcepts.has(relation.to) && atom.normalized.includes(relation.from.toLowerCase()))
    .map((relation) => relation.to);
  return left.flatMap((atom) => {
    const other = right.find((candidate) => candidate.field === atom.field && atom.normalized
      && (candidate.normalized === atom.normalized || concepts(atom).some((concept) => concepts(candidate).includes(concept))));
    return other ? [{ from: atom, to: other }] : [];
  });
}

function description(run: AnalysisRun, from: WardrobeItem, to: WardrobeItem) {
  const common = sharedStructure(run, from.id, to.id);
  const color = (id: string) => run.colors.filter((entry) => entry.itemId === id && entry.evidenceStatus === 'confirmed' && entry.role === 'dominant')
    .sort((a, b) => b.areaRatio - a.areaRatio)[0];
  const first = color(from.id);
  const second = color(to.id);
  const sentences: string[] = [];
  const loose = common.some((pair) => pair.from.field === 'silhouette'
    && /宽松|阔腿|oversize/i.test(pair.from.value) && /宽松|阔腿|oversize/i.test(pair.to.value));
  const same = common.find((pair) => pair.from.normalized === pair.to.normalized);
  if (loose) sentences.push('两件都是宽松版型。');
  else if (same?.from.field === 'silhouette' && /衣|裤|裙|鞋|靴|衫/.test(same.from.value))
    sentences.push(`两件都是${same.from.value}。`);
  else if (same?.from.field === 'material') sentences.push(`两件都用了${same.from.value}。`);
  if (first && second) {
    const a = colorFamily(first);
    const b = colorFamily(second);
    sentences.push(a === b ? `两件都以${a}色为主。` : `主色从${a}色换成${b}色。`);
  }
  return sentences.join('') || `只替换这件${from.category === '鞋子' ? '鞋' : from.category}，其余单品沿用原搭配。`;
}

/** Curate grounded experiments; no old opportunity is accepted on its saved score. */
export function buildJournalInspiration(items: WardrobeItem[], matches: BestMatch[], run: AnalysisRun, preferredMatchId?: string): JournalInspiration[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const sources = [...matches].sort((a, b) => Number(b.id === preferredMatchId) - Number(a.id === preferredMatchId));
  const result: JournalInspiration[] = [];
  const seen = new Set<string>();
  const decided = new Set((run.manualFeedback || [])
    .filter((entry) => entry.targetType === 'opportunity' && (entry.choice === '接受' || entry.choice === '拒绝'))
    .map((entry) => entry.targetId));
  const candidateRun = { ...run, opportunities: (run.opportunities || []).filter((entry) =>
    entry.paletteAssessment && isSlot(entry.targetSlot) && entry.sourceMatchId && entry.sourceAnchorItemId && !decided.has(entry.id)) };
  for (const match of sources) {
    const sourceCase = run.outfitCases.find((entry) => entry.matchId === match.id);
    const current = selections(match);
    // Saved case relations must still refer to the entire current outfit.
    if (!sourceCase || sourceCase.primaryItems.length !== current.length
      || current.some((entry) => !itemMap.has(entry.itemId) || !sourceCase.primaryItems.some((part) => part.slot === entry.slot && part.itemId === entry.itemId))) continue;
    const anchor = sourceCase.anchorItemId;
    if (!current.some((entry) => entry.itemId === anchor)) continue;
    // Scope the engine to this case before its top-three cap; other cases must
    // not crowd out the preferred outfit. Full-history exclusion runs below.
    const candidates = buildOutfitRecommendations(anchor, [match], items, candidateRun, { maxNew: 3, maxHistory: 0 });
    for (const candidate of candidates) {
      if (candidate.kind !== 'new' || candidate.sourceMatchId !== match.id || !candidate.changedSlot) continue;
      const from = itemMap.get(candidate.replacedItemId || '');
      const to = itemMap.get(candidate.candidateItemId || '');
      if (!from || !to || from.category !== to.category || from.id === to.id) continue;
      if (from.category === '上装' && (!from.topType || !to.topType || from.topType !== to.topType)) continue;
      if (from.category === '下装' && (!from.length || !to.length || from.length !== to.length)) continue;
      if (from.category === '配饰' && (!from.accessoryType || from.accessoryType !== to.accessoryType)) continue;
      if (!isSingleJournalChange(match, candidate.selections, from.id, to.id)
        || isRecordedJournalCombination(candidate.selections, matches)
        || new Set(candidate.selections.map((entry) => entry.itemId)).size !== candidate.selections.length) continue;
      const structure = sharedStructure(run, from.id, to.id);
      if (!structure.length) continue;
      const assessment = evaluateOutfitPalette({
        sourceCase,
        sourceSelections: current,
        selections: candidate.selections,
        changedSlot: candidate.changedSlot,
        colors: run.colors,
        structuralEvidenceIds: structure.flatMap((pair) => [`e:${pair.from.id}`, `e:${pair.to.id}`]),
      });
      if (assessment.status !== 'strict') continue;
      const pair = `${from.id}:${to.id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      result.push({ id: candidate.id, kind: 'new', from, to, match, slot: candidate.changedSlot, description: description(run, from, to), evidenceIds: assessment.evidenceIds, assessment });
      if (result.length === 3) return result;
    }
  }
  if (result.length) return result;

  // An existing variant is a useful comparison, but never a new recommendation.
  const saved = journalSubstitutions(run, matches, items).flatMap((entry) => entry.contexts.map((match) => ({ ...entry, match })))
    .filter(({ match }) => selections(match).every((entry) => itemMap.has(entry.itemId)))
    .sort((a, b) => Number(b.match.id === preferredMatchId) - Number(a.match.id === preferredMatchId)
      || Number(a.from.category === '配饰') - Number(b.from.category === '配饰')
      || b.contract.contextMatchIds.length - a.contract.contextMatchIds.length);
  for (const entry of saved) {
    if (!isSlot(entry.contract.slot)) continue;
    const pair = `${entry.from.id}:${entry.to.id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    result.push({ id: `saved:${entry.contract.id}:${entry.match.id}`, kind: 'saved', from: entry.from, to: entry.to, match: entry.match, slot: entry.contract.slot, description: description(run, entry.from, entry.to), evidenceIds: entry.contract.evidenceIds });
    if (result.length === 3) break;
  }
  return result;
}
