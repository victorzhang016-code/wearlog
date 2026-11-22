import type { BestMatch, WardrobeItem } from "../types";
import { colorFamily, type PerceptualColor } from "./aestheticAnalysisV3";
import { journalColorGroups } from "./styleJournalView";

const neutral = new Set(["黑", "白", "灰"]);
const slotNames = {
  tops: "上装",
  bottoms: "下装",
  shoes: "鞋",
  accessories: "配饰",
} as const;
type Slot = keyof typeof slotNames;
const mainSlots = ["tops", "bottoms", "shoes"] as const;
const sorted = (values: string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN"));
const familyLabel = (families: string[]) =>
  families.map((f) => `${f}色`).join("、");

export type PaletteSample = {
  color: PerceptualColor;
  slot: string;
  itemName: string;
};
export type JournalPaletteCase = {
  match: BestMatch;
  samples: PaletteSample[];
  confirmedItems: number;
  totalItems: number;
};

/** Read-only colour choices, not a compatibility score or a learned principle.
 * Group by confirmed main-colour families at the same garment positions.
 * No RGB-distance thresholds, variant expansion, accessory co-occurrence inflation,
 * or inferred whole-outfit area/weight. One current Best Match is one case.
 */
export function journalPaletteAnalysis(
  colors: PerceptualColor[],
  items: WardrobeItem[],
  matches: BestMatch[],
) {
  const families = journalColorGroups(colors, items);
  const choices = families
    .filter((g) => !neutral.has(g.family))
    .map((group) => {
      const countRole = (role: PerceptualColor["role"]) =>
        new Set(
          group.samples.filter((c) => c.role === role).map((c) => c.itemId),
        ).size;
      const categories = [...new Set(items.map((i) => i.category))]
        .map((category) => ({
          name: category,
          count: items.filter(
            (i) => i.category === category && group.itemIds.includes(i.id),
          ).length,
        }))
        .filter((c) => c.count)
        .sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"),
        );
      return {
        ...group,
        dominant: countRole("dominant"),
        secondary: countRole("secondary"),
        accent: countRole("accent"),
        categories,
      };
    });
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const byItem = new Map<string, PerceptualColor[]>();
  for (const group of families)
    for (const color of group.samples) {
      const bucket = byItem.get(color.itemId) || [];
      bucket.push(color);
      byItem.set(color.itemId, bucket);
    }
  const main = (id: string) =>
    (byItem.get(id) || []).filter((c) => c.role === "dominant");
  type Group = {
    id: string;
    title: string;
    neutralOnly: boolean;
    cases: JournalPaletteCase[];
  };
  const groups = new Map<string, Group>();
  type Pair = {
    id: string;
    from: string;
    to: string;
    slot: "bottoms" | "shoes";
    fromColor: PerceptualColor;
    toColor: PerceptualColor;
    matchIds: Set<string>;
    coreIds: Set<string>;
  };
  const pairs = new Map<string, Pair>();
  const eligible = new Map<string, Set<string>>();
  const cases: JournalPaletteCase[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (seen.has(match.id)) continue;
    seen.add(match.id);
    const slots = Object.fromEntries(
      Object.keys(slotNames).map((slot) => [
        slot,
        (match.items[slot as Slot] || []).map((s) => s.primary),
      ]),
    ) as Record<Slot, string[]>;
    const core = slots.tops[0];
    if (!core || !slots.bottoms.length) continue;
    // Do not turn a missing/deleted/unknown colour into a neutral base.
    const required = mainSlots.flatMap((slot) => slots[slot]);
    if (required.some((id) => !itemMap.has(id) || !main(id).length)) continue;
    const allIds = [...new Set(Object.values(slots).flat())];
    const samples: PaletteSample[] = [];
    for (const [slot, ids] of Object.entries(slots)) {
      const sampleKeys = new Set<string>();
      for (const id of new Set(ids))
        for (const color of byItem.get(id) || []) {
          const key = `${id}:${color.role}:${color.hex}`;
          if (sampleKeys.has(key)) continue;
          sampleKeys.add(key);
          samples.push({
            color,
            slot: slotNames[slot as Slot],
            itemName: itemMap.get(id)!.name,
          });
        }
    }
    samples.sort(
      (a, b) =>
        ["dominant", "secondary", "accent"].indexOf(a.color.role) -
        ["dominant", "secondary", "accent"].indexOf(b.color.role),
    );
    const entry: JournalPaletteCase = {
      match,
      samples,
      totalItems: allIds.length,
      confirmedItems: allIds.filter((id) => byItem.has(id)).length,
    };
    cases.push(entry);
    const signature = mainSlots.map((slot) => ({
      slot,
      families: sorted(
        slots[slot]
          .flatMap((id) => main(id).map(colorFamily))
          .filter((f) => !neutral.has(f)),
      ),
    }));
    const id = JSON.stringify(
      signature.map((s) => [s.slot, s.families, slots[s.slot].length > 0]),
    );
    const coloured = signature.filter((s) => s.families.length);
    const title = coloured.length
      ? coloured
          .map((s) => `${familyLabel(s.families)}${slotNames[s.slot]}`)
          .join(" · ")
      : "上装、下装和鞋以黑白灰为主";
    const group = groups.get(id) || {
      id,
      title,
      neutralOnly: !coloured.length,
      cases: [],
    };
    group.cases.push(entry);
    groups.set(id, group);

    // Directed outer/core-top -> bottoms/shoes. Bags, watches and variants do
    // not create pair counts. Multi-colour garments retain all confirmed mains.
    for (const fromColor of main(core))
      for (const slot of ["bottoms", "shoes"] as const) {
        const from = colorFamily(fromColor);
        const targets = slots[slot].filter((id) => id !== core);
        if (!targets.length) continue;
        const denominatorKey = `${from}:${slot}`;
        const ids = eligible.get(denominatorKey) || new Set<string>();
        ids.add(match.id);
        eligible.set(denominatorKey, ids);
        for (const target of targets)
          for (const toColor of main(target)) {
            const to = colorFamily(toColor);
            if (neutral.has(from) && neutral.has(to)) continue;
            const key = `${from}:${slot}:${to}`;
            const pair = pairs.get(key) || {
              id: key,
              from,
              to,
              slot,
              fromColor,
              toColor,
              matchIds: new Set(),
              coreIds: new Set(),
            };
            pair.matchIds.add(match.id);
            pair.coreIds.add(core);
            pairs.set(key, pair);
          }
      }
  }
  const pairings = [...pairs.values()]
    .map((pair) => ({
      ...pair,
      matchIds: [...pair.matchIds],
      coreIds: [...pair.coreIds],
      total: eligible.get(`${pair.from}:${pair.slot}`)!.size,
      count: pair.matchIds.size,
    }))
    .filter((pair) => pair.count >= 2 && pair.coreIds.length >= 2)
    .sort(
      (a, b) =>
        Number(neutral.has(a.from)) - Number(neutral.has(b.from)) ||
        b.count - a.count ||
        a.id.localeCompare(b.id),
    );
  // Keep the visible statements distinct; remaining evidence stays in cases.
  const distinctPairs = pairings.filter(
    (pair, i) =>
      pairings.findIndex(
        (p) => p.from === pair.from && p.slot === pair.slot,
      ) === i,
  );
  return {
    families,
    choices,
    cases,
    pairings: distinctPairs,
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(a.neutralOnly) - Number(b.neutralOnly) ||
        b.cases.length - a.cases.length ||
        a.title.localeCompare(b.title, "zh-CN"),
    ),
    confirmedItems: byItem.size,
    totalMatches: seen.size,
  };
}
