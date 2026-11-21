import assert from "node:assert/strict";
import test from "node:test";
import type { WardrobeItem, BestMatch } from "../src/types";
import type {
  AnalysisRun,
  SemanticAtom,
  PerceptualColor,
} from "../src/lib/aestheticAnalysisV3";
import {
  buildPersonalStyleModel,
  evaluatePersonalStyleModel,
  personalFeatures,
} from "../src/lib/personalStyleModel";
import {
  currentJournalAnalyses,
  journalColorGroups,
  journalSubstitutions,
} from "../src/lib/styleJournalView";
import type { VisionAnalysis } from "../src/lib/aestheticVision";

function wardrobe(id: string, category = "上装"): WardrobeItem {
  return {
    id,
    name: id,
    category,
    rating: 7,
    story: "",
    season: "四季",
    userId: "test",
  } as WardrobeItem;
}
function atom(
  itemId: string,
  value: string,
  status = "confirmed",
): SemanticAtom {
  return {
    id: `${itemId}:${value}`,
    itemId,
    field: "style",
    value,
    normalized: value,
    evidenceStatus: status,
    weight: 1,
  } as SemanticAtom;
}
function outfit(id: string, anchor: string, bottom: string): BestMatch {
  return {
    id,
    items: {
      tops: [{ primary: anchor }],
      bottoms: [{ primary: bottom }],
      shoes: [],
      accessories: [],
    },
    allItemIds: [anchor, bottom],
  } as BestMatch;
}
function fixture(reverse = false) {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => wardrobe(`top${i}`)),
    ...Array.from({ length: 5 }, (_, i) => wardrobe(`bottom${i}`, "下装")),
  ];
  const atoms = [
    ...items
      .filter((i) => i.category === "上装")
      .map((i, n) => atom(i.id, n < 4 ? "机能" : "正式")),
    ...items
      .filter((i) => i.category === "下装")
      .map((i, n) => atom(i.id, n === 0 ? "工装" : "西装")),
  ];
  const matches = Array.from({ length: 8 }, (_, i) =>
    outfit(`match${i}`, `top${i}`, i < 4 !== reverse ? "bottom0" : "bottom1"),
  );
  return {
    items,
    matches,
    run: { atoms, colors: [] } as Pick<AnalysisRun, "atoms" | "colors">,
  };
}

test("personal patterns change when actual pairings change, without changing prose", () => {
  const a = fixture();
  const b = fixture(true);
  const first = buildPersonalStyleModel(a.run, a.items, a.matches);
  const second = buildPersonalStyleModel(b.run, b.items, b.matches);
  assert(
    first.patterns.some(
      (p) => p.condition.label === "机能" && p.outcome.label === "工装",
    ),
  );
  assert(
    !second.patterns.some(
      (p) => p.condition.label === "机能" && p.outcome.label === "工装",
    ),
  );
  assert(
    second.patterns.some(
      (p) => p.condition.label === "机能" && p.outcome.label === "西装",
    ),
  );
});
test("candidate visual tags never become personal features or patterns", () => {
  const data = fixture();
  data.run.atoms.forEach((a) => (a.evidenceStatus = "proposed"));
  assert.equal(
    buildPersonalStyleModel(data.run, data.items, data.matches).patterns.length,
    0,
  );
  assert.equal(
    [...personalFeatures(data.run, data.items).values()].flat().length,
    0,
  );
});
test("unknown dimensions are not counted as negative examples", () => {
  const data = fixture();
  data.items.push(wardrobe("unknown", "下装"));
  data.matches.push(outfit("missing", "top0", "unknown"));
  const pattern = buildPersonalStyleModel(
    data.run,
    data.items,
    data.matches,
  ).patterns.find(
    (p) => p.condition.label === "机能" && p.outcome.label === "工装",
  )!;
  assert.equal(pattern.eligible, 4);
  assert.equal(pattern.baselineTotal, 8);
});
test("one core repeated many times cannot establish a personal pattern", () => {
  const data = fixture();
  data.matches.slice(0, 4).forEach((m) => (m.items.tops[0].primary = "top0"));
  assert(
    !buildPersonalStyleModel(data.run, data.items, data.matches).patterns.some(
      (p) => p.condition.label === "机能",
    ),
  );
});
test("leave-core-out excludes the complete core family and its variants", () => {
  const data = fixture();
  data.matches.push({
    ...outfit("same-core", "top0", "bottom0"),
    items: {
      ...outfit("x", "top0", "bottom0").items,
      bottoms: [{ primary: "bottom0", variants: ["bottom4"] }],
    },
  });
  const model = buildPersonalStyleModel(data.run, data.items, data.matches);
  const evaluation = evaluatePersonalStyleModel(model, data.items);
  const fold = evaluation.folds.find((f) => f.anchorId === "top0")!;
  assert(
    fold.heldMatchIds.includes("match0") &&
      fold.heldMatchIds.includes("same-core"),
  );
  assert(
    !fold.trainingMatchIds.includes("match0") &&
      !fold.trainingMatchIds.includes("same-core"),
  );
  assert(evaluation.total > 0);
});
test("a universal attribute is not a contextual preference", () => {
  const data = fixture();
  data.run.atoms
    .filter((a) => a.itemId.startsWith("bottom"))
    .forEach((a) => {
      a.value = "百搭";
      a.normalized = "百搭";
    });
  assert.equal(
    buildPersonalStyleModel(data.run, data.items, data.matches).patterns.length,
    0,
  );
});
test("color families count distinct live garments and exclude unconfirmed and deleted records", () => {
  const color = {
    itemId: "a",
    hex: "#000000",
    rgb: [0, 0, 0],
    oklch: [0, 0, 0],
    role: "dominant",
    evidenceStatus: "confirmed",
  } as PerceptualColor;
  const groups = journalColorGroups(
    [
      color,
      color,
      { ...color, itemId: "missing" },
      { ...color, itemId: "b", evidenceStatus: "proposed" },
    ],
    [wardrobe("a"), wardrobe("b")],
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].itemIds.length, 1);
  assert.equal(groups[0].samples.length, 1);
});
test("old substitution contracts cannot survive removed slots or different accessory functions", () => {
  const run = {
    substitutions: [
      {
        id: "s",
        fromItemId: "a",
        toItemId: "b",
        slot: "accessories",
        contextMatchIds: ["m"],
      },
    ],
  } as AnalysisRun;
  const items = [
    { ...wardrobe("a", "配饰"), accessoryType: "手表" },
    { ...wardrobe("b", "配饰"), accessoryType: "包包" },
  ] as WardrobeItem[];
  const match = outfit("m", "coat", "pants");
  match.items.accessories = [{ primary: "a", variants: ["b"] }];
  assert.equal(journalSubstitutions(run, [match], items).length, 0);
  items[1].accessoryType = "手表";
  assert.equal(journalSubstitutions(run, [match], items).length, 1);
  match.items.accessories[0].variants = [];
  assert.equal(journalSubstitutions(run, [match], items).length, 0);
});

test("changed photos and superseded analysis versions do not supply current colors", () => {
  const item = { ...wardrobe("a"), imageUrl: "new-photo" };
  const old = {
    id: "old",
    itemId: "a",
    sourceImageUrl: "old-photo",
    status: "confirmed",
    updatedAt: "2026-01-01",
  } as VisionAnalysis;
  const current = {
    ...old,
    id: "current",
    sourceImageUrl: "new-photo",
    status: "proposed",
    updatedAt: "2026-02-01",
  } as VisionAnalysis;
  const result = currentJournalAnalyses(
    [
      old,
      current,
      {
        ...current,
        id: "older-current",
        status: "confirmed",
        updatedAt: "2026-01-15",
      },
    ],
    [item],
  );
  assert.deepEqual(
    result.map((entry) => entry.id),
    ["current"],
  );
  assert.equal(result[0].status, "proposed");
  assert.equal(currentJournalAnalyses([old], [item]).length, 0);
});
