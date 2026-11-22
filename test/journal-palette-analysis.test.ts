import test from "node:test";
import assert from "node:assert/strict";
import { journalPaletteAnalysis } from "../src/lib/journalPaletteAnalysis";
import type { PerceptualColor } from "../src/lib/aestheticAnalysisV3";
import type { BestMatch, WardrobeItem } from "../src/types";

const shades = {
  blue: { rgb: [0, 80, 170], hex: "#0050aa", oklch: [0.45, 0.15, 250] },
  blue2: { rgb: [20, 100, 180], hex: "#1464b4", oklch: [0.5, 0.13, 250] },
  black: { rgb: [0, 0, 0], hex: "#000000", oklch: [0, 0, 0] },
  white: { rgb: [255, 255, 255], hex: "#ffffff", oklch: [1, 0, 0] },
  red: { rgb: [200, 10, 20], hex: "#c80a14", oklch: [0.5, 0.2, 15] },
};
const item = (id: string, category = "上装") =>
  ({ id, name: id, category }) as WardrobeItem;
const color = (
  id: string,
  shade: keyof typeof shades,
  role: PerceptualColor["role"] = "dominant",
  evidenceStatus: "confirmed" | "proposed" = "confirmed",
) =>
  ({
    itemId: id,
    ...shades[shade],
    role,
    evidenceStatus,
    lab: [0, 0, 0],
    areaRatio: 0.5,
    source: "user",
  }) as PerceptualColor;
const match = (id: string, top: string, bottom: string, accessory?: string) =>
  ({
    id,
    name: id,
    items: {
      tops: [{ primary: top, variants: [] }],
      bottoms: [{ primary: bottom, variants: [] }],
      shoes: [],
      accessories: accessory ? [{ primary: accessory, variants: [] }] : [],
    },
  }) as BestMatch;
const fixture = () => ({
  items: [
    item("t1"),
    item("t2"),
    item("t3"),
    item("b", "下装"),
    item("w", "下装"),
    item("bag", "配饰"),
  ],
  colors: [
    color("t1", "blue"),
    color("t2", "blue2"),
    color("t3", "blue"),
    color("b", "black"),
    color("w", "white"),
    color("bag", "red"),
  ],
  matches: [
    match("m1", "t1", "b", "bag"),
    match("m2", "t2", "b", "bag"),
    match("m3", "t3", "w", "bag"),
  ],
});

test("colour choices exclude neutrals from the headline and count each item/role once", () => {
  const f = fixture();
  f.colors.push(
    color("t1", "blue"),
    color("t1", "blue", "accent"),
    color("deleted", "red"),
    color("t2", "red", "accent", "proposed"),
  );
  const result = journalPaletteAnalysis(f.colors, f.items, f.matches);
  assert.equal(result.choices[0].family, "蓝");
  assert.equal(result.choices[0].itemIds.length, 3);
  assert.equal(result.choices[0].dominant, 3);
  assert.equal(result.choices[0].accent, 1);
  assert.equal(result.confirmedItems, 6);
  assert.equal(
    result.choices.find((c) => c.family === "红")!.itemIds.length,
    1,
  );
});

test("directed pair counts have a real denominator and ignore duplicate cases and variants", () => {
  const f = fixture();
  f.matches[0].items.bottoms.push({ primary: "b", variants: ["w"] });
  f.matches.push(f.matches[0]);
  const result = journalPaletteAnalysis(f.colors, f.items, f.matches);
  const pair = result.pairings.find((p) => p.from === "蓝" && p.to === "黑")!;
  assert.equal(pair.count, 2);
  assert.equal(pair.total, 3);
  assert.deepEqual(pair.matchIds, ["m1", "m2"]);
  assert.equal(
    result.pairings.some((p) => p.from === "红" || p.to === "红"),
    false,
  );
  assert.equal(result.totalMatches, 3);
});

test("groups keep colour positions, merge neutral bases, and retain actual shades for comparison", () => {
  const f = fixture();
  const result = journalPaletteAnalysis(f.colors, f.items, f.matches);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].title, "蓝色上装");
  assert.equal(result.groups[0].cases.length, 3);
  assert.equal(result.groups[0].cases[1].samples[0].color.hex, "#1464b4");
  assert.ok(
    result.groups[0].cases[0].samples.some(
      (s) => s.slot === "配饰" && s.color.hex === "#c80a14",
    ),
  );
  f.items.push(item("nt"), item("bb", "下装"));
  f.colors.push(color("nt", "black"), color("bb", "blue"));
  f.matches.push(match("neutral", "nt", "w"), match("blue-bottom", "nt", "bb"));
  const next = journalPaletteAnalysis(f.colors, f.items, f.matches);
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups.at(-1)!.neutralOnly, true);
  assert.ok(next.groups.some((g) => g.title === "蓝色下装"));
});

test("unknown, proposed and deleted garment colours cannot masquerade as a neutral base", () => {
  const f = fixture();
  f.colors = f.colors.filter((c) => c.itemId !== "t1");
  f.colors.find((c) => c.itemId === "t2")!.evidenceStatus = "proposed";
  f.items = f.items.filter((i) => i.id !== "t3");
  const result = journalPaletteAnalysis(f.colors, f.items, f.matches);
  assert.equal(result.cases.length, 0);
  assert.equal(result.groups.length, 0);
  assert.equal(result.pairings.length, 0);
  assert.equal(result.totalMatches, 3);
});

test("a repeated single top cannot create a cross-case pairing insight", () => {
  const f = fixture();
  f.matches = [match("one", "t1", "b"), match("two", "t1", "b")];
  assert.equal(
    journalPaletteAnalysis(f.colors, f.items, f.matches).pairings.length,
    0,
  );
});

test("missing accessory colours remain explicit without blocking comparable garment colours", () => {
  const f = fixture();
  f.colors = f.colors.filter((c) => c.itemId !== "bag");
  const result = journalPaletteAnalysis(f.colors, f.items, f.matches);
  assert.equal(result.cases.length, 3);
  assert.equal(result.cases[0].confirmedItems, 2);
  assert.equal(result.cases[0].totalItems, 3);
  assert.equal(result.cases[0].samples.length, 2);
});
