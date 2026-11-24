import assert from "node:assert/strict";
import test from "node:test";
import { analyzeStyleEvidence } from "../api/_lib/styleInsightService";

const evidence = [
  { matchId: "first", name: "第一套", story: "我会把上衣下摆收短。", pieces: [] },
  { matchId: "second", name: "第二套", story: "穿长裤时调整腰线。", pieces: [] },
];
const insight = {
  title: "调整上下比例",
  category: "比例",
  summary: "两套记录都提到了长度或腰线的调整。",
  suggestion: "对比调整前后的效果。",
  quotes: [
    { matchId: "first", text: "把上衣下摆收短。" },
    { matchId: "second", text: "穿长裤时调整腰线。" },
  ],
};
const content = JSON.stringify({ insights: [insight] });
const env = { KIMI_API_KEY: "synthetic-key-never-sent" };

async function withResponse<T>(body: unknown, run: (request: () => Record<string, unknown>, diagnostics: () => unknown[][]) => Promise<T>, status = 200) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const diagnostics: unknown[][] = [];
  console.warn = (...args: unknown[]) => { diagnostics.push(args); };
  let request: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(body), { status });
  };
  try {
    return await run(() => request, () => diagnostics);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

function envelope(text: string, finishReason = "stop") {
  return { choices: [{ finish_reason: finishReason, message: { content: text } }] };
}

test("the service accepts complete JSON and complete fences with surrounding whitespace", async () => {
  for (const text of [content, ` \n${content}\n `, `\n  \`\`\`json\n${content}\n\`\`\`\n `, `\`\`\`JSON\r\n${content}\r\n\`\`\``]) {
    await withResponse(envelope(text), async () => {
      const result = await analyzeStyleEvidence(evidence, env);
      assert.equal(result.insights.length, 1);
      assert.deepEqual(result.insights[0].quotes, insight.quotes);
    });
  }
});

test("the service rejects incomplete fences and surrounding prose instead of extracting a fragment", async () => {
  for (const text of [`\`\`\`json\n${content}`, `${content}\n\`\`\``, `说明：${content}`, `\`\`\`json\n${content}\n\`\`\`\n附加说明`]) {
    await withResponse(envelope(text), async () => {
      await assert.rejects(analyzeStyleEvidence(evidence, env), /这次分析未完成/);
    });
  }
});

test("truncated and reasoning-only completions cannot become successful empty analyses", async () => {
  for (const body of [
    envelope('{"insights":[{"title":"unfinished', "length"),
    { choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "synthetic reasoning" } }] },
  ]) {
    await withResponse(body, async () => {
      await assert.rejects(analyzeStyleEvidence(evidence, env), /这次分析未完成/);
    });
  }
});

test("successfully parsed output still requires two exact current-source quotes", async () => {
  const changed = { insights: [{ ...insight, quotes: [insight.quotes[0], { matchId: "second", text: "用户没有写过的原因。" }] }] };
  await withResponse(envelope(JSON.stringify(changed)), async () => {
    assert.deepEqual((await analyzeStyleEvidence(evidence, env)).insights, []);
  });
  await withResponse(envelope('{"insights":[]}'), async () => {
    assert.deepEqual((await analyzeStyleEvidence(evidence, env)).insights, []);
  });
});

test("upstream HTTP failures retain a distinct error from malformed output", async () => {
  await withResponse({ error: "synthetic upstream failure" }, async () => {
    await assert.rejects(analyzeStyleEvidence(evidence, env), /分析服务暂时不可用（429）/);
  }, 429);
});

test("parse diagnostics contain only bounded metadata, never source or generated text", async () => {
  const body = {
    id: "private-response-id",
    choices: [{ finish_reason: "length", message: { content: "私人输出不应进入日志", reasoning_content: "私人思考也不应进入日志" } }],
    usage: { prompt_tokens: 100, completion_tokens: 2400, completion_tokens_details: { reasoning_tokens: 2300 }, extra: "private-usage-value" },
  };
  await withResponse(body, async (_request, diagnostics) => {
    await assert.rejects(analyzeStyleEvidence(evidence, env), /这次分析未完成/);
    assert.deepEqual(diagnostics(), [["style_insight_invalid_json", {
      provider: "kimi", model: "kimi-for-coding", finishReason: "length", contentType: "string",
      contentLength: body.choices[0].message.content.length,
      reasoningLength: body.choices[0].message.reasoning_content.length,
      promptTokens: 100, completionTokens: 2400, reasoningTokens: 2300,
    }]]);
    assert.ok(!JSON.stringify(diagnostics()).includes("私人"));
    assert.ok(!JSON.stringify(diagnostics()).includes("private-"));
  });
});
