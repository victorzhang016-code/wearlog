import type { BestMatch, BestMatchItems, WardrobeItem } from "../types";
import { colorFamily, type AnalysisRun } from "./aestheticAnalysisV3";

export const PERSONAL_STYLE_MODEL_VERSION = "wearlog-personal-context-v1";
type Slot = keyof BestMatchItems;
type Feature = {
  key: string;
  dimension: string;
  label: string;
  evidenceIds: string[];
};
type Observation = {
  matchId: string;
  anchorId: string;
  slot: Slot;
  index: number;
  primaryId: string;
  acceptedIds: string[];
  context: Feature[];
  outcome: Feature[];
};
export type PersonalPattern = {
  id: string;
  condition: Feature;
  outcome: Feature;
  slot: Slot;
  supportMatchIds: string[];
  exceptionMatchIds: string[];
  anchorIds: string[];
  support: number;
  eligible: number;
  baselineSupport: number;
  baselineTotal: number;
  rate: number;
  baselineRate: number;
  posterior: number;
  lift: number;
  evidenceIds: string[];
};
export type PersonalStyleModel = ReturnType<typeof buildPersonalStyleModel>;
export const STYLE_SLOT_LABELS: Record<Slot, string> = {
  tops: "内搭",
  bottoms: "下装",
  shoes: "鞋子",
  accessories: "配饰",
};
const unique = <T>(values: T[]) => [...new Set(values)];

/** Only observed garment facts enter learning. Stories, ratings and IDs aren't features. */
export function personalFeatures(
  run: Pick<AnalysisRun, "atoms" | "colors">,
  items: WardrobeItem[],
) {
  const result = new Map<string, Feature[]>();
  for (const item of items) {
    const features: Feature[] = [];
    for (const color of run.colors.filter(
      (entry) =>
        entry.itemId === item.id &&
        entry.evidenceStatus === "confirmed" &&
        entry.role === "dominant",
    )) {
      const family = colorFamily(color);
      features.push({
        key: `color:${family}`,
        dimension: "color",
        label: `${family}色`,
        evidenceIds: [
          `e:color:${item.id}:${color.role}:${color.rgb.join("-")}`,
        ],
      });
    }
    for (const atom of run.atoms.filter(
      (entry) =>
        entry.itemId === item.id &&
        entry.evidenceStatus === "confirmed" &&
        ["silhouette", "material", "style", "pattern"].includes(entry.field),
    )) {
      // No model-written synonyms or new personal claims: preserve the confirmed phrase.
      const value = atom.normalized || atom.value;
      if (
        !value ||
        value.length > 18 ||
        ["纯色", "基础", "日常", "常规"].includes(value)
      )
        continue;
      features.push({
        key: `${atom.field}:${value}`,
        dimension: atom.field,
        label: atom.value,
        evidenceIds: [`e:${atom.id}`],
      });
    }
    result.set(
      item.id,
      features.filter(
        (entry, index) =>
          features.findIndex((other) => other.key === entry.key) === index,
      ),
    );
  }
  return result;
}

function observations(
  matches: BestMatch[],
  features: Map<string, Feature[]>,
  items: WardrobeItem[],
): Observation[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return matches.flatMap((match) => {
    const anchorId = match.items.tops[0]?.primary;
    if (!anchorId || !itemMap.has(anchorId)) return [];
    return (
      Object.entries(match.items) as [Slot, BestMatchItems[Slot]][]
    ).flatMap(([slot, entries]) =>
      entries.flatMap((entry, index) => {
        if (entry.primary === anchorId || !itemMap.has(entry.primary))
          return [];
        const primary = itemMap.get(entry.primary)!;
        const acceptedIds = unique([
          entry.primary,
          ...(entry.variants || []),
        ]).filter((id) => {
          const candidate = itemMap.get(id);
          return (
            candidate &&
            candidate.category === primary.category &&
            (slot !== "accessories" ||
              Boolean(
                primary.accessoryType &&
                candidate.accessoryType === primary.accessoryType,
              ))
          );
        });
        return [
          {
            matchId: match.id,
            anchorId,
            slot,
            index,
            primaryId: entry.primary,
            acceptedIds,
            context: features.get(anchorId) || [],
            outcome: features.get(entry.primary) || [],
          },
        ];
      }),
    );
  });
}

function fitPatterns(rows: Observation[]): PersonalPattern[] {
  const patterns: PersonalPattern[] = [];
  for (const slot of ["tops", "bottoms", "shoes"] as Slot[]) {
    const subset = rows.filter((row) => row.slot === slot);
    const conditions = new Map(
      subset.flatMap((row) =>
        row.context.map((feature) => [feature.key, feature] as const),
      ),
    );
    const outcomes = new Map(
      subset.flatMap((row) =>
        row.outcome.map((feature) => [feature.key, feature] as const),
      ),
    );
    for (const condition of conditions.values())
      for (const outcome of outcomes.values()) {
        // Missing target dimensions are unknown, not negative examples.
        const eligible = subset.filter((row) =>
          row.outcome.some(
            (feature) => feature.dimension === outcome.dimension,
          ),
        );
        const contextual = eligible.filter((row) =>
          row.context.some((feature) => feature.key === condition.key),
        );
        const support = contextual.filter((row) =>
          row.outcome.some((feature) => feature.key === outcome.key),
        );
        const eligibleIds = unique(contextual.map((row) => row.matchId));
        const supportIds = unique(support.map((row) => row.matchId));
        const allIds = unique(eligible.map((row) => row.matchId));
        const baseIds = unique(
          eligible
            .filter((row) =>
              row.outcome.some((feature) => feature.key === outcome.key),
            )
            .map((row) => row.matchId),
        );
        const anchorIds = unique(support.map((row) => row.anchorId));
        if (supportIds.length < 3 || anchorIds.length < 2 || !allIds.length)
          continue;
        const baselineRate = baseIds.length / allIds.length;
        // Empirical-Bayes shrinkage toward this person's slot baseline (4 pseudo-cases).
        const posterior =
          (supportIds.length + 4 * baselineRate) / (eligibleIds.length + 4);
        const lift = posterior - baselineRate;
        if (lift < 0.08 || baselineRate > 0.9) continue;
        patterns.push({
          id: `${slot}|${condition.key}|${outcome.key}`,
          condition,
          outcome,
          slot,
          supportMatchIds: supportIds,
          exceptionMatchIds: eligibleIds.filter(
            (id) => !supportIds.includes(id),
          ),
          anchorIds,
          support: supportIds.length,
          eligible: eligibleIds.length,
          baselineSupport: baseIds.length,
          baselineTotal: allIds.length,
          rate: supportIds.length / eligibleIds.length,
          baselineRate,
          posterior,
          lift,
          evidenceIds: unique(
            support.flatMap((row) =>
              [
                ...row.context.filter((f) => f.key === condition.key),
                ...row.outcome.filter((f) => f.key === outcome.key),
              ].flatMap((f) => f.evidenceIds),
            ),
          ),
        });
      }
  }
  return patterns.sort(
    (a, b) =>
      b.lift - a.lift || b.support - a.support || a.id.localeCompare(b.id),
  );
}

function rankCandidates(
  anchorId: string,
  candidates: WardrobeItem[],
  slot: Slot,
  patterns: PersonalPattern[],
  features: Map<string, Feature[]>,
  training: Observation[],
) {
  const context = features.get(anchorId) || [];
  const applicable = patterns.filter(
    (pattern) =>
      pattern.slot === slot &&
      context.some((f) => f.key === pattern.condition.key),
  );
  const popularity = new Map<string, number>();
  // Each outfit is one observation; variants don't multiply the outfit's weight.
  training
    .filter((row) => row.slot === slot)
    .forEach((row) =>
      popularity.set(row.primaryId, (popularity.get(row.primaryId) || 0) + 1),
    );
  const scored = candidates.map((item) => {
    const candidateFeatures = features.get(item.id) || [];
    const terms = new Map<string, number>();
    for (const pattern of applicable) {
      if (
        !candidateFeatures.some(
          (feature) => feature.dimension === pattern.outcome.dimension,
        )
      )
        continue;
      const present = candidateFeatures.some(
        (feature) => feature.key === pattern.outcome.key,
      );
      const term = present
        ? Math.log(pattern.posterior / pattern.baselineRate)
        : Math.log((1 - pattern.posterior) / (1 - pattern.baselineRate));
      const dimension = pattern.outcome.dimension;
      if (
        !terms.has(dimension) ||
        Math.abs(term) > Math.abs(terms.get(dimension)!)
      )
        terms.set(dimension, term);
    }
    return {
      id: item.id,
      contextScore: [...terms.values()].reduce((sum, value) => sum + value, 0),
      popularity: popularity.get(item.id) || 0,
    };
  });
  return {
    learned: [...scored]
      .sort(
        (a, b) =>
          b.contextScore - a.contextScore ||
          b.popularity - a.popularity ||
          a.id.localeCompare(b.id),
      )
      .map((entry) => entry.id),
    baseline: [...scored]
      .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))
      .map((entry) => entry.id),
    applied: applicable.length > 0,
  };
}

export function buildPersonalStyleModel(
  run: Pick<AnalysisRun, "atoms" | "colors">,
  items: WardrobeItem[],
  matches: BestMatch[],
) {
  const features = personalFeatures(run, items);
  const rows = observations(matches, features, items);
  const patterns = fitPatterns(rows);
  return {
    version: PERSONAL_STYLE_MODEL_VERSION,
    patterns,
    observedMatches: unique(rows.map((row) => row.matchId)).length,
    features,
    rows,
  };
}

/** Offline only: remove ALL outfits sharing the held core before mining any rules. */
export function evaluatePersonalStyleModel(
  model: PersonalStyleModel,
  items: WardrobeItem[],
) {
  const folds: Array<{
    anchorId: string;
    trainingMatchIds: string[];
    heldMatchIds: string[];
    count: number;
    learnedHits: number;
    baselineHits: number;
    neighborHits: number;
    learnedExact: number;
    baselineExact: number;
    neighborExact: number;
    applied: number;
  }> = [];
  for (const anchorId of unique(model.rows.map((row) => row.anchorId))) {
    const training = model.rows.filter((row) => row.anchorId !== anchorId);
    const held = model.rows.filter(
      (row) =>
        row.anchorId === anchorId && ["bottoms", "shoes"].includes(row.slot),
    );
    const patterns = fitPatterns(training);
    let count = 0,
      learnedHits = 0,
      baselineHits = 0,
      neighborHits = 0,
      learnedExact = 0,
      baselineExact = 0,
      neighborExact = 0,
      applied = 0;
    for (const row of held) {
      const target = items.find((item) => item.id === row.primaryId)!;
      const candidates = items.filter(
        (item) =>
          item.category === target.category &&
          (target.category !== "下装" ||
            !target.length ||
            item.length === target.length),
      );
      if (candidates.length <= 3) continue;
      const ranked = rankCandidates(
        anchorId,
        candidates,
        row.slot,
        patterns,
        model.features,
        training,
      );
      // Case-based alternative: IDF-weighted Jaccard of confirmed core features,
      // with support-item votes only from training outfits. No held variants used.
      const trainAnchors = unique(training.map((entry) => entry.anchorId));
      const queryKeys = new Set(
        (model.features.get(anchorId) || []).map((f) => f.key),
      );
      const weight = (key: string) =>
        Math.log(
          1 +
            trainAnchors.length /
              (1 +
                trainAnchors.filter((id) =>
                  model.features.get(id)?.some((f) => f.key === key),
                ).length),
        );
      const votes = new Map<string, number>();
      for (const past of training.filter((entry) => entry.slot === row.slot)) {
        const pastKeys = new Set(
          (model.features.get(past.anchorId) || []).map((f) => f.key),
        );
        const union = unique([...queryKeys, ...pastKeys]);
        const denominator = union.reduce((sum, key) => sum + weight(key), 0);
        const similarity = denominator
          ? union
              .filter((key) => queryKeys.has(key) && pastKeys.has(key))
              .reduce((sum, key) => sum + weight(key), 0) / denominator
          : 0;
        for (const id of past.acceptedIds)
          votes.set(
            id,
            (votes.get(id) || 0) +
              similarity / Math.max(1, past.acceptedIds.length),
          );
      }
      const neighbors = [...candidates]
        .sort(
          (a, b) =>
            (votes.get(b.id) || 0) - (votes.get(a.id) || 0) ||
            ranked.baseline.indexOf(a.id) - ranked.baseline.indexOf(b.id),
        )
        .map((entry) => entry.id);
      count++;
      if (ranked.applied) applied++;
      if (ranked.learned.slice(0, 3).some((id) => row.acceptedIds.includes(id)))
        learnedHits++;
      if (
        ranked.baseline.slice(0, 3).some((id) => row.acceptedIds.includes(id))
      )
        baselineHits++;
      if (neighbors.slice(0, 3).some((id) => row.acceptedIds.includes(id)))
        neighborHits++;
      if (ranked.learned.slice(0, 3).includes(row.primaryId)) learnedExact++;
      if (ranked.baseline.slice(0, 3).includes(row.primaryId)) baselineExact++;
      if (neighbors.slice(0, 3).includes(row.primaryId)) neighborExact++;
    }
    folds.push({
      anchorId,
      trainingMatchIds: unique(training.map((row) => row.matchId)),
      heldMatchIds: unique(held.map((row) => row.matchId)),
      count,
      learnedHits,
      baselineHits,
      neighborHits,
      learnedExact,
      baselineExact,
      neighborExact,
      applied,
    });
  }
  const total = folds.reduce((sum, fold) => sum + fold.count, 0);
  const learnedHits = folds.reduce((sum, fold) => sum + fold.learnedHits, 0);
  const baselineHits = folds.reduce((sum, fold) => sum + fold.baselineHits, 0);
  const sum = (
    key: "neighborHits" | "learnedExact" | "baselineExact" | "neighborExact",
  ) => folds.reduce((total, fold) => total + fold[key], 0);
  return {
    protocol:
      "leave-core-out; train-only rules; same full category pool; primary-or-saved-variant@3",
    total,
    learnedHits,
    baselineHits,
    neighborHits: sum("neighborHits"),
    learnedExact: sum("learnedExact"),
    baselineExact: sum("baselineExact"),
    neighborExact: sum("neighborExact"),
    learnedRate: total ? learnedHits / total : 0,
    baselineRate: total ? baselineHits / total : 0,
    beatsBaseline: total > 0 && learnedHits > baselineHits,
    folds,
  };
}
