import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStyleInsights,
  styleEvidence,
  validateAIInsights,
} from "../src/lib/styleInsights";
import { aiFetch, aiProvider } from "../api/_lib/aiProvider";
import type { AnalysisRun, SemanticAtom } from "../src/lib/aestheticAnalysisV3";
import type { BestMatch, WardrobeItem } from "../src/types";

function fixtures() {
  const items = ["t1", "t2", "t3", "b1"].map(
    (id) => ({ id, name: id }) as WardrobeItem,
  );
  const matches = ["t1", "t2", "t3"].map(
    (id, i) =>
      ({
        id: `m${i}`,
        story: "需要垫一层内胆让上身显得短宽利落。",
        items: {
          tops: [{ primary: id }],
          bottoms: [{ primary: "b1" }],
          shoes: [],
          accessories: [],
        },
      }) as BestMatch,
  );
  const atoms = items.map(
    (i) =>
      ({
        id: i.id,
        itemId: i.id,
        field: "silhouette",
        value: "宽松",
        evidenceStatus: "confirmed",
      }) as SemanticAtom,
  );
  return { items, matches, run: { atoms } as AnalysisRun };
}
test("insights use current story and confirmed structural observations", () => {
  const { items, matches, run } = fixtures();
  const result = buildStyleInsights(run, matches, items);
  assert.equal(
    result.find((i) => i.id === "record:proportion")?.quotes.length,
    3,
  );
  assert.deepEqual(result.find((i) => i.source === "computed")?.observation, {
    support: 3,
    total: 3,
    label: "上下装宽窄均已确认的搭配",
  });
  matches.forEach((m) => (m.story = "今天穿了这一套。"));
  assert.equal(
    buildStyleInsights(run, matches, items).some((i) => i.source === "record"),
    false,
  );
});
test("unknown, conflicting or unconfirmed widths and layered outfits do not inflate counts", () => {
  const { items, matches, run } = fixtures();
  run.atoms[0].evidenceStatus = "proposed";
  assert.equal(
    buildStyleInsights(run, matches, items).some(
      (i) => i.source === "computed",
    ),
    false,
  );
  run.atoms[0].evidenceStatus = "confirmed";
  run.atoms[0].value = "宽松但修身";
  assert.equal(
    buildStyleInsights(run, matches, items).some(
      (i) => i.source === "computed",
    ),
    false,
  );
  run.atoms[0].value = "宽松";
  matches[0].items.tops.push({ primary: "t2" });
  assert.equal(
    buildStyleInsights(run, matches, items).some(
      (i) => i.source === "computed",
    ),
    false,
  );
});
test("removed garments and stale generated quotes cannot support current insights", () => {
  const { items, matches, run } = fixtures();
  const evidence = styleEvidence(run, matches, items);
  const row = {
    title: "调整比例",
    summary: "调整上身长度",
    suggestion: "试试调整内搭",
    category: "比例",
    quotes: [
      { matchId: "m0", text: "让上身显得短宽利落" },
      { matchId: "m1", text: "让上身显得短宽利落" },
    ],
  };
  assert.equal(validateAIInsights({ insights: [row] }, evidence).length, 1);
  assert.equal(
    validateAIInsights(
      { insights: [{ ...row, quotes: [row.quotes[0], row.quotes[0]] }] },
      evidence,
    ).length,
    0,
  );
  assert.equal(
    validateAIInsights(
      {
        insights: [
          {
            ...row,
            quotes: [
              { matchId: "m0", text: "你的身材高挑显瘦" },
              row.quotes[1],
            ],
          },
        ],
      },
      evidence,
    ).length,
    0,
  );
  assert.equal(
    validateAIInsights(
      { insights: [row] },
      styleEvidence(
        run,
        matches,
        items.filter((i) => i.id !== "t1"),
      ),
    ).length,
    0,
  );
  matches[0].story = "更新过的记录";
  assert.equal(
    validateAIInsights({ insights: [row] }, styleEvidence(run, matches, items))
      .length,
    0,
  );
});
test("provider selection is explicit, separates model tasks and never borrows another provider key", () => {
  assert.equal(aiProvider({ KIMI_API_KEY: "test" }).model, "kimi-for-coding");
  assert.equal(
    aiProvider({ AI_PROVIDER: "deepseek", KIMI_API_KEY: "test" }).key,
    "",
  );
  const env = {
    AI_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "test",
    DEEPSEEK_TEXT_MODEL: "deepseek-v4-pro",
  };
  assert.equal(aiProvider(env).model, "deepseek-v4-pro");
  assert.equal(aiProvider(env, "vision").model, "deepseek-flash");
  assert.throws(() =>
    aiProvider({ ...env, DEEPSEEK_VISION_MODEL: "deepseek-v4-pro" }, "vision"),
  );
  assert.throws(() => aiProvider({ AI_PROVIDER: "typo" }));
});
test("DeepSeek uses OpenAI image blocks with thinking disabled; network response remains intact", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.messages[0].content[0].type, "image_url");
      assert.ok(init?.signal);
      return new Response("{}", { status: 429 });
    };
    const response = await aiFetch(
      aiProvider(
        { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test" },
        "vision",
      ),
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,AA==" },
              },
            ],
          },
        ],
      },
    );
    assert.equal(response.status, 429);
  } finally {
    globalThis.fetch = original;
  }
});
import { readFileSync } from 'node:fs';
import { STYLE_INSIGHT_TIMEOUT_MS } from '../src/lib/styleInsights';

test('the hosted function can finish a long insight request before the client deadline', async () => {
  const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(STYLE_INSIGHT_TIMEOUT_MS > 60_000);
  assert.ok(vercel.functions['api/ai-import.ts'].maxDuration * 1000 > STYLE_INSIGHT_TIMEOUT_MS + 10_000);
  const originalFetch=globalThis.fetch, originalTimeout=AbortSignal.timeout;
  let requestedTimeout=0;
  try {
    AbortSignal.timeout=(ms)=>{ requestedTimeout=ms;return new AbortController().signal; };
    globalThis.fetch=async()=>new Response('{}');
    await aiFetch(aiProvider({KIMI_API_KEY:'test'}),{messages:[]},STYLE_INSIGHT_TIMEOUT_MS);
    assert.equal(requestedTimeout,STYLE_INSIGHT_TIMEOUT_MS);
  } finally { globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout; }
});
