import type { BestMatch, WardrobeItem } from "../types";
import {
  colorFamily,
  type AnalysisRun,
  type PerceptualColor,
  type AestheticPrinciple,
} from "./aestheticAnalysisV3";
import {
  buildPersonalStyleModel,
  STYLE_SLOT_LABELS,
  type PersonalPattern,
} from "./personalStyleModel";
import type { VisionAnalysis } from "./aestheticVision";

export function currentJournalAnalyses(
  analyses: VisionAnalysis[],
  items: WardrobeItem[],
) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const latest = new Map<string, VisionAnalysis>();
  for (const analysis of [...analyses].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  )) {
    const item = itemMap.get(analysis.itemId);
    if (!item || latest.has(item.id)) continue;
    if (analysis.sourceImageUrl && analysis.sourceImageUrl !== item.imageUrl)
      continue;
    latest.set(item.id, analysis);
  }
  return [...latest.values()];
}

export type ColorRoleFilter = "all" | PerceptualColor["role"];
export const COLOR_ROLE_LABELS = {
  all: "全部颜色",
  dominant: "主色",
  secondary: "辅色",
  accent: "点缀色",
};

/** A family is a browsing aid; the swatch always retains a real garment's RGB. */
export function journalColorGroups(
  colors: PerceptualColor[],
  items: WardrobeItem[],
  role: ColorRoleFilter = "all",
) {
  const itemIds = new Set(items.map((item) => item.id));
  const grouped = new Map<string, PerceptualColor[]>();
  for (const color of colors) {
    if (
      color.evidenceStatus !== "confirmed" ||
      !itemIds.has(color.itemId) ||
      (role !== "all" && color.role !== role)
    )
      continue;
    const family = colorFamily(color);
    const values = grouped.get(family) || [];
    if (
      !values.some(
        (entry) =>
          entry.itemId === color.itemId &&
          entry.hex === color.hex &&
          entry.role === color.role,
      )
    )
      values.push(color);
    grouped.set(family, values);
  }
  return [...grouped]
    .map(([family, samples]) => {
      const ids = [...new Set(samples.map((entry) => entry.itemId))];
      // Pick the most represented real shade, never average unrelated garments.
      const shades = [...new Set(samples.map((entry) => entry.hex))];
      const count = (hex: string) =>
        new Set(
          samples
            .filter((entry) => entry.hex === hex)
            .map((entry) => entry.itemId),
        ).size;
      shades.sort((a, b) => count(b) - count(a) || a.localeCompare(b));
      return {
        family,
        samples,
        itemIds: ids,
        color: samples.find((entry) => entry.hex === shades[0])!,
      };
    })
    .sort(
      (a, b) =>
        b.itemIds.length - a.itemIds.length ||
        a.family.localeCompare(b.family, "zh-CN"),
    );
}

export function principleMaturity(
  principle: AestheticPrinciple,
  caseCount: number,
) {
  if (
    principle.reconnectionStatus === "review" ||
    principle.unresolvedQuestionIds.length ||
    principle.counterexampleMatchIds.length
  )
    return "还有例外，待确认";
  if (principle.kind === "self_aware") return "你曾明确写下";
  if (
    principle.kind === "enacted" &&
    caseCount >= 3 &&
    principle.holdoutSupport
  )
    return "多套搭配中的倾向";
  return caseCount > 1 ? "正在形成的倾向" : "一套搭配中的观察";
}

export function journalStories(
  run: AnalysisRun,
  matches: BestMatch[],
  items: WardrobeItem[],
) {
  const itemIds = new Set(items.map((item) => item.id));
  const matchMap = new Map(matches.map((match) => [match.id, match]));
  return run.principles.flatMap((principle) => {
    const cases = [
      ...new Set([
        ...principle.representativeMatchIds,
        ...principle.supportMatchIds,
      ]),
    ]
      .map((id) => run.outfitCases.find((entry) => entry.matchId === id))
      .filter(
        (entry) =>
          entry &&
          matchMap.has(entry.matchId) &&
          entry.primaryItems.every(
            (part) =>
              itemIds.has(part.itemId) &&
              matchMap
                .get(entry.matchId)!
                .items[part.slot].some((slot) => slot.primary === part.itemId),
          ),
      );
    if (!cases.length) return [];
    return [
      {
        principle,
        cases,
        maturity:
          principle.kind === "self_aware" ? "你曾明确写下" : "从搭配记录中观察",
        pattern: undefined as PersonalPattern | undefined,
      },
    ];
  });
}

export function learnedJournalStories(
  run: AnalysisRun,
  matches: BestMatch[],
  items: WardrobeItem[],
) {
  const model = buildPersonalStyleModel(run, items, matches);
  const selected: PersonalPattern[] = [];
  for (const pattern of model.patterns) {
    // Show distinct visual questions, not six synonyms for the same set of outfits.
    if (
      selected.some(
        (entry) =>
          entry.slot === pattern.slot &&
          (entry.condition.key === pattern.condition.key ||
            entry.supportMatchIds.filter((id) =>
              pattern.supportMatchIds.includes(id),
            ).length /
              Math.max(entry.support, pattern.support) >
              0.8),
      )
    )
      continue;
    selected.push(pattern);
    if (selected.length === 6) break;
  }
  return selected.flatMap((pattern) => {
    const cases = pattern.supportMatchIds
      .map((id) => run.outfitCases.find((entry) => entry.matchId === id))
      .filter(Boolean);
    if (!cases.length) return [];
    const outcomeName = /裤|裙|鞋|靴|衬衫|内搭|卫衣|毛衣/.test(
      pattern.outcome.label,
    )
      ? pattern.outcome.label
      : `${pattern.outcome.label}${STYLE_SLOT_LABELS[pattern.slot]}`;
    const title = `${pattern.condition.label}上装 × ${outcomeName}`;
    const principle: AestheticPrinciple = {
      id: pattern.id,
      title,
      statement: "",
      condition: `上装带有「${pattern.condition.label}」特征时`,
      mechanism: `搭配这类上装时，可以先看看你已有的${outcomeName}`,
      effect: `在 ${pattern.eligible} 套这样的搭配中，你有 ${pattern.support} 套选了${outcomeName}。`,
      kind: "emerging",
      supportMatchIds: pattern.supportMatchIds,
      representativeMatchIds: pattern.supportMatchIds,
      evidenceIds: pattern.evidenceIds,
      counterexampleMatchIds: pattern.exceptionMatchIds,
      unresolvedQuestionIds: [],
      confirmedCoverage: 1,
      holdoutSupport: false,
      supportNote: "这是已保存搭配中的关联观察，不是实穿效果或因果结论。",
      decisionMechanismIds: [],
      reconnectedEvidenceIds: pattern.evidenceIds,
      reconnectionCoverage: 1,
      reconnectionStatus: "reconnected",
      ruleValidation: {
        scope: "not_applicable",
        slots: [pattern.slot],
        cases: 0,
        engineTop3: 0,
        baselineTop3: 0,
        passed: false,
        note: "关联观察尚不作为预测规则。",
      },
    };
    return [{ principle, cases, maturity: "你的搭配中出现的联系", pattern }];
  });
}

/** Revalidate old contracts against current slots; a saved variant is contextual. */
export function journalSubstitutions(
  run: AnalysisRun,
  matches: BestMatch[],
  items: WardrobeItem[],
) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return run.substitutions.flatMap((contract) => {
    const from = itemMap.get(contract.fromItemId);
    const to = itemMap.get(contract.toItemId);
    if (!from || !to || from.id === to.id || from.category !== to.category)
      return [];
    if (
      from.category === "配饰" &&
      (!from.accessoryType || from.accessoryType !== to.accessoryType)
    )
      return [];
    const contexts = matches.filter(
      (match) =>
        contract.contextMatchIds.includes(match.id) &&
        match.items[contract.slot]?.some(
          (slot) => slot.primary === from.id && slot.variants?.includes(to.id),
        ),
    );
    return contexts.length ? [{ contract, from, to, contexts }] : [];
  });
}
