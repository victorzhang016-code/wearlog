import type { OutfitCaseGraph, OutfitRelation, PerceptualColor } from './aestheticAnalysisV3';

export const PALETTE_RULE_VERSION = 'outfit-palette-v1';

export type PaletteSlot = 'tops' | 'bottoms' | 'shoes' | 'accessories';
export type PaletteSelection = { slot: PaletteSlot; index: number; itemId: string };
export type PaletteRelation = 'echo' | 'lighten' | 'ground' | 'accent_link';
export type PaletteStatus = 'strict' | 'exploration' | 'rejected';

export type PaletteAssessment = {
  ruleVersion: typeof PALETTE_RULE_VERSION;
  status: PaletteStatus;
  sourceMatchId: string;
  sourceAnchorItemId: string;
  completeBase: boolean;
  relation?: PaletteRelation;
  summary: string;
  evidenceIds: string[];
  structuralEvidenceIds: string[];
  supportEdgeCount: number;
  affectedSlots: PaletteSlot[];
  rejectionReason?: string;
  newVariable?: string;
};

export type PaletteEvaluationInput = {
  sourceCase: OutfitCaseGraph;
  sourceSelections: ReadonlyArray<PaletteSelection>;
  selections: ReadonlyArray<PaletteSelection>;
  changedSlot: PaletteSlot;
  colors: PerceptualColor[];
  structuralEvidenceIds: string[];
};

type PairMetrics = {
  distance: number;
  lightnessDelta: number;
  chromaDelta: number;
  hueDelta: number;
  left: PerceptualColor;
  right: PerceptualColor;
};

const BASE_SLOTS: PaletteSlot[] = ['tops', 'bottoms', 'shoes'];
const COLOR_OPERATIONS: Record<string, PaletteRelation | undefined> = {
  color_echo: 'echo',
  color_lighten: 'lighten',
  color_ground: 'ground',
};

const unique = <T,>(values: T[]) => [...new Set(values)];

function colorEvidenceId(color: PerceptualColor) {
  return `e:color:${color.itemId}:${color.role}:${color.rgb.join('-')}`;
}

function colorRoleWeight(color: PerceptualColor) {
  return (color.role === 'dominant' ? 3 : color.role === 'secondary' ? 2 : 1) * Math.max(color.areaRatio, 0.05);
}

function confirmedColors(colors: PerceptualColor[], itemId: string) {
  return colors
    .filter((color) => color.itemId === itemId && color.evidenceStatus === 'confirmed')
    .sort((left, right) => colorRoleWeight(right) - colorRoleWeight(left));
}

function distance(left: PerceptualColor, right: PerceptualColor) {
  return Math.sqrt(left.lab.reduce((sum, value, index) => sum + (value - right.lab[index]) ** 2, 0));
}

function circularDistance(left: number, right: number) {
  const raw = Math.abs(left - right) % 360;
  return Math.min(raw, 360 - raw);
}

function pairMetrics(colors: PerceptualColor[], leftItemId: string, rightItemId: string): PairMetrics | null {
  const left = confirmedColors(colors, leftItemId);
  const right = confirmedColors(colors, rightItemId);
  const pairs = left.flatMap((leftColor) => right.map((rightColor) => ({
    left: leftColor,
    right: rightColor,
    distance: distance(leftColor, rightColor),
    lightnessDelta: rightColor.oklch[0] - leftColor.oklch[0],
    chromaDelta: rightColor.oklch[1] - leftColor.oklch[1],
    hueDelta: circularDistance(leftColor.oklch[2], rightColor.oklch[2]),
    rolePenalty: leftColor.role === rightColor.role ? 0 : 3,
  })));
  if (!pairs.length) return null;
  const best = pairs.sort((left, right) => left.distance + left.rolePenalty - right.distance - right.rolePenalty)[0];
  return { distance: best.distance, lightnessDelta: best.lightnessDelta, chromaDelta: best.chromaDelta, hueDelta: best.hueDelta, left: best.left, right: best.right };
}

function isNeutral(colors: PerceptualColor[], itemId: string) {
  const lead = confirmedColors(colors, itemId)[0];
  if (!lead) return false;
  return lead.oklch[1] < 0.055 || (lead.oklch[0] > 0.84 && lead.oklch[1] < 0.1);
}

function sourceItemForSelection(selections: ReadonlyArray<PaletteSelection>, slot: PaletteSlot, index: number) {
  return selections.find((entry) => entry.slot === slot && entry.index === index)?.itemId;
}

function hasCompleteBase(selections: ReadonlyArray<PaletteSelection>) {
  return selections.filter((entry) => entry.slot === 'tops').length >= 2
    && selections.some((entry) => entry.slot === 'bottoms')
    && selections.some((entry) => entry.slot === 'shoes');
}

function baseItemIds(selections: ReadonlyArray<PaletteSelection>) {
  return selections.filter((entry) => BASE_SLOTS.includes(entry.slot)).map((entry) => entry.itemId);
}

function activeCoreId(sourceCase: OutfitCaseGraph, selections: ReadonlyArray<PaletteSelection>) {
  if (selections.some((entry) => entry.itemId === sourceCase.anchorItemId)) return sourceCase.anchorItemId;
  return selections.find((entry) => entry.slot === 'tops')?.itemId || sourceCase.anchorItemId;
}

function paletteRelation(relation: OutfitRelation): PaletteRelation | null {
  return COLOR_OPERATIONS[relation.operation] || null;
}

function relationMatches(reference: PaletteRelation, source: PairMetrics, candidate: PairMetrics) {
  if (reference === 'echo') {
    // The source outfit sets the tolerance. We keep only candidates at least as
    // coherent as its observed colour echo, with a small Lab allowance for image
    // sampling and fabric texture. This deliberately avoids RGB distance rules.
    return candidate.distance <= source.distance + Math.max(3.5, source.distance * 0.22);
  }
  if (reference === 'lighten') {
    return candidate.lightnessDelta >= Math.max(0.1, source.lightnessDelta * 0.58);
  }
  if (reference === 'ground') {
    return candidate.lightnessDelta <= Math.min(-0.1, source.lightnessDelta * 0.58);
  }
  return false;
}

function relationSummary(relation: PaletteRelation, changedSlot: PaletteSlot) {
  if (relation === 'echo') return changedSlot === 'shoes' ? '鞋履重复主色关系，把整套颜色重新连起来。' : '换入单品延续已有色彩呼应，把上下半身连接起来。';
  if (relation === 'lighten') return changedSlot === 'tops' ? '内搭保留更高明度，给核心外层留出呼吸和层次。' : '更高明度的支持件保留了原搭配的提亮关系。';
  if (relation === 'ground') return changedSlot === 'bottoms' ? '深色下装压住重心，鞋履重复下半身的低明度。' : '更低明度的支持件继续压住整套重心。';
  return '小面积点缀重复主体颜色，不抢走主色与焦点。';
}

function relationshipPeers(selections: ReadonlyArray<PaletteSelection>, changedSlot: PaletteSlot, coreId: string) {
  const itemsFor = (slot: PaletteSlot) => selections.filter((entry) => entry.slot === slot).map((entry) => entry.itemId);
  if (changedSlot === 'tops') return unique([...itemsFor('tops').filter((itemId) => itemId !== coreId), ...itemsFor('bottoms'), ...itemsFor('shoes')]);
  if (changedSlot === 'bottoms') return unique([coreId, ...itemsFor('shoes')]);
  if (changedSlot === 'shoes') return unique([coreId, ...itemsFor('bottoms')]);
  return unique([...itemsFor('tops'), ...itemsFor('bottoms'), ...itemsFor('shoes')]);
}

function changedSelection(input: PaletteEvaluationInput) {
  return input.selections.find((entry) => {
    if (entry.slot !== input.changedSlot) return false;
    return sourceItemForSelection(input.sourceSelections, entry.slot, entry.index) !== entry.itemId;
  }) || input.selections.find((entry) => entry.slot === input.changedSlot) || null;
}

function sourceRelationsForChangedItem(input: PaletteEvaluationInput, changedItem: PaletteSelection) {
  const sourceItemId = sourceItemForSelection(input.sourceSelections, changedItem.slot, changedItem.index);
  if (!sourceItemId) return [] as OutfitRelation[];
  if (sourceItemId === input.sourceCase.anchorItemId) {
    return input.sourceCase.relations.filter((relation) => relation.anchorItemId === input.sourceCase.anchorItemId && paletteRelation(relation));
  }
  return input.sourceCase.relations.filter((relation) => relation.supportItemId === sourceItemId && relation.anchorItemId === input.sourceCase.anchorItemId && paletteRelation(relation));
}

function sourceDistanceScale(input: PaletteEvaluationInput) {
  const ids = baseItemIds(input.sourceSelections);
  const distances = ids.flatMap((left, index) => ids.slice(index + 1).flatMap((right) => {
    const pair = pairMetrics(input.colors, left, right);
    return pair ? [pair.distance] : [];
  })).sort((left, right) => left - right);
  if (!distances.length) return 12;
  return distances[Math.floor(distances.length / 2)];
}

function preservesPeerConnection(input: PaletteEvaluationInput, changedItem: PaletteSelection, peerId: string) {
  const sourceItemId = sourceItemForSelection(input.sourceSelections, changedItem.slot, changedItem.index);
  if (!sourceItemId || sourceItemId === peerId) return true;
  const before = pairMetrics(input.colors, sourceItemId, peerId);
  const after = pairMetrics(input.colors, changedItem.itemId, peerId);
  if (!before || !after) return false;
  const adaptiveAllowance = Math.max(4, sourceDistanceScale(input) * 0.38, before.distance * 0.26);
  return after.distance <= before.distance + adaptiveAllowance;
}

function buildRejected(input: PaletteEvaluationInput, completeBase: boolean, reason: string, affectedSlots: PaletteSlot[], evidenceIds: string[] = []): PaletteAssessment {
  return {
    ruleVersion: PALETTE_RULE_VERSION,
    status: 'rejected',
    sourceMatchId: input.sourceCase.matchId,
    sourceAnchorItemId: input.sourceCase.anchorItemId,
    completeBase,
    summary: '这套颜色结构没有通过完整校验。',
    rejectionReason: reason,
    evidenceIds: unique(evidenceIds),
    structuralEvidenceIds: unique(input.structuralEvidenceIds),
    supportEdgeCount: 0,
    affectedSlots,
  };
}

export function evaluateOutfitPalette(input: PaletteEvaluationInput): PaletteAssessment {
  const completeBase = hasCompleteBase(input.selections);
  const changed = changedSelection(input);
  const affectedSlots = unique([input.changedSlot, ...(input.changedSlot === 'tops' ? ['bottoms', 'shoes'] : input.changedSlot === 'bottoms' ? ['tops', 'shoes'] : input.changedSlot === 'shoes' ? ['tops', 'bottoms'] : ['tops', 'bottoms', 'shoes'])]) as PaletteSlot[];
  if (!changed) return buildRejected(input, completeBase, '没有找到本次要验证的替换位置。', affectedSlots);
  if (!completeBase) return buildRejected(input, false, '严格推荐需要外层、内搭、下装和鞋都完整出现。', affectedSlots);

  const missingColorItemIds = baseItemIds(input.selections).filter((itemId) => !confirmedColors(input.colors, itemId).length);
  if (missingColorItemIds.length) return buildRejected(input, true, '基础部件缺少已确认颜色，不能把未确认信息当作严格推荐依据。', affectedSlots);
  if (input.changedSlot === 'accessories' && input.selections.filter((entry) => entry.slot === 'accessories').length > 1) {
    return buildRejected(input, true, '配饰超过一个，无法保证它只是点睛而不抢走主色。', affectedSlots);
  }
  if (isNeutral(input.colors, changed.itemId) && !input.structuralEvidenceIds.length) {
    return buildRejected(input, true, '中性色只能承接整体，仍需要结构或比例依据才可以成立。', affectedSlots, confirmedColors(input.colors, changed.itemId).map(colorEvidenceId));
  }

  const coreId = activeCoreId(input.sourceCase, input.selections);
  const relations = sourceRelationsForChangedItem(input, changed);
  const evidenceIds: string[] = [];
  const passed: Array<{ relation: PaletteRelation; relationRecord: OutfitRelation }> = [];
  const failed: Array<{ relation: PaletteRelation; relationRecord: OutfitRelation }> = [];

  for (const relationRecord of relations) {
    const relation = paletteRelation(relationRecord);
    if (!relation) continue;
    const sourceSupportId = relationRecord.supportItemId;
    const candidateSupportId = sourceSupportId === input.sourceCase.anchorItemId ? coreId : (sourceSupportId === sourceItemForSelection(input.sourceSelections, changed.slot, changed.index) ? changed.itemId : sourceSupportId);
    const sourcePair = pairMetrics(input.colors, input.sourceCase.anchorItemId, sourceSupportId);
    const candidatePair = pairMetrics(input.colors, coreId, candidateSupportId);
    if (!sourcePair || !candidatePair) continue;
    evidenceIds.push(...relationRecord.evidenceIds, colorEvidenceId(candidatePair.left), colorEvidenceId(candidatePair.right));
    if (relationMatches(relation, sourcePair, candidatePair)) passed.push({ relation, relationRecord });
    else failed.push({ relation, relationRecord });
  }

  if (!relations.length && input.changedSlot === 'accessories') {
    const peers = relationshipPeers(input.selections, input.changedSlot, coreId);
    const connected = peers.some((peerId) => {
      const pair = pairMetrics(input.colors, changed.itemId, peerId);
      return pair && pair.distance <= sourceDistanceScale(input) * 0.9;
    });
    if (connected && !isNeutral(input.colors, changed.itemId)) {
      const colorsForAccessory = confirmedColors(input.colors, changed.itemId);
      evidenceIds.push(...colorsForAccessory.map(colorEvidenceId));
      passed.push({ relation: 'accent_link', relationRecord: { evidenceIds: [] } as OutfitRelation });
    }
  }

  const peers = relationshipPeers(input.selections, input.changedSlot, coreId).filter((itemId) => itemId !== changed.itemId);
  const disconnectedPeers = peers.filter((peerId) => {
    if (peerId === coreId && passed.length) return false;
    if (isNeutral(input.colors, changed.itemId) || isNeutral(input.colors, peerId)) return false;
    return !preservesPeerConnection(input, changed, peerId);
  });
  if (disconnectedPeers.length) {
    return buildRejected(input, true, input.changedSlot === 'bottoms' ? '新下装没有和鞋履形成承接，整套下半身出现颜色冲突。' : '换入单品与受影响的基础部件失去颜色连接，整套配色不成立。', affectedSlots, evidenceIds);
  }

  if (!input.structuralEvidenceIds.length) {
    return buildRejected(input, true, '颜色关系需要至少一条结构、比例或视觉重量依据共同成立。', affectedSlots, evidenceIds);
  }

  if (!passed.length && failed.length === 1) {
    const variable = failed[0];
    return {
      ruleVersion: PALETTE_RULE_VERSION,
      status: 'exploration',
      sourceMatchId: input.sourceCase.matchId,
      sourceAnchorItemId: input.sourceCase.anchorItemId,
      completeBase: true,
      relation: variable.relation,
      summary: relationSummary(variable.relation, input.changedSlot),
      newVariable: `本次新变量：${input.changedSlot === 'bottoms' ? '下装' : input.changedSlot === 'shoes' ? '鞋履' : input.changedSlot === 'tops' ? '上装层次' : '点缀色'}偏离了一条已记录的颜色关系，需要你的实际反馈。`,
      evidenceIds: unique(evidenceIds),
      structuralEvidenceIds: unique(input.structuralEvidenceIds),
      supportEdgeCount: peers.length,
      affectedSlots,
    };
  }
  if (!passed.length) {
    return buildRejected(input, true, '换入后没有保留来源搭配的颜色关系，也没有命中已验证的配色语法。', affectedSlots, evidenceIds);
  }

  const primary = passed[0];
  if (!failed.length) {
    return {
      ruleVersion: PALETTE_RULE_VERSION,
      status: 'strict',
      sourceMatchId: input.sourceCase.matchId,
      sourceAnchorItemId: input.sourceCase.anchorItemId,
      completeBase: true,
      relation: primary.relation,
      summary: relationSummary(primary.relation, input.changedSlot),
      evidenceIds: unique(evidenceIds),
      structuralEvidenceIds: unique(input.structuralEvidenceIds),
      supportEdgeCount: passed.length + peers.length,
      affectedSlots,
    };
  }

  if (failed.length === 1) {
    return {
      ruleVersion: PALETTE_RULE_VERSION,
      status: 'exploration',
      sourceMatchId: input.sourceCase.matchId,
      sourceAnchorItemId: input.sourceCase.anchorItemId,
      completeBase: true,
      relation: primary.relation,
      summary: relationSummary(primary.relation, input.changedSlot),
      newVariable: `本次新变量：${input.changedSlot === 'bottoms' ? '下装' : input.changedSlot === 'shoes' ? '鞋履' : input.changedSlot === 'tops' ? '上装层次' : '点缀色'}偏离了一条已记录的颜色关系，需要你的实际反馈。`,
      evidenceIds: unique(evidenceIds),
      structuralEvidenceIds: unique(input.structuralEvidenceIds),
      supportEdgeCount: passed.length + peers.length,
      affectedSlots,
    };
  }
  return buildRejected(input, true, '换入后偏离了多条来源配色关系，不能作为受控探索展示。', affectedSlots, evidenceIds);
}
