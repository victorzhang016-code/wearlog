import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { normalizeAestheticSnapshot } from "../src/lib/aestheticContracts";
import { buildAestheticAnalysisV4 } from "../src/lib/aestheticAnalysisV3";
import {
  buildPersonalStyleModel,
  evaluatePersonalStyleModel,
} from "../src/lib/personalStyleModel";
import type { BestMatch, WardrobeItem } from "../src/types";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const source = option("--snapshot");
if (!source)
  throw new Error(
    "Usage: npx tsx scripts/evaluate-personal-style.ts --snapshot <snapshot.json> [--output <local-result.json>]",
  );
const output = resolve(
  option("--output") ||
    ".local-data/aesthetic/evaluations/personal-style-v1.json",
);
if (resolve(source) === output)
  throw new Error("The result must not overwrite the source snapshot.");
const bytes = readFileSync(source);
const snapshot = normalizeAestheticSnapshot(JSON.parse(bytes.toString("utf8")));
const items = snapshot.wardrobeItems as unknown as WardrobeItem[];
const matches = snapshot.bestMatches.map((match) => ({
  ...match,
  items: { tops: [], bottoms: [], shoes: [], accessories: [], ...match.items },
})) as unknown as BestMatch[];
const run = buildAestheticAnalysisV4(snapshot);
const model = buildPersonalStyleModel(run, items, matches);
const validation = evaluatePersonalStyleModel(model, items);
const report = {
  version: model.version,
  featureEngineVersion: run.engineVersion,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  sourceExportedAt: snapshot.exportedAt,
  generatedAt: new Date().toISOString(),
  itemCount: items.length,
  matchCount: matches.length,
  patterns: model.patterns,
  validation,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      output,
      patterns: model.patterns.length,
      evaluation: { ...validation, folds: undefined },
    },
    null,
    2,
  ),
);
