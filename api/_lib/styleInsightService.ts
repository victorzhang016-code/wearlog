import { aiFetch, aiProvider } from "./aiProvider.js";
import {
  STYLE_INSIGHT_PROMPT,
  STYLE_INSIGHT_TIMEOUT_MS,
  validateAIInsights,
  type StyleEvidence,
} from "../../src/lib/styleInsights.js";

export async function analyzeStyleEvidence(
  input: unknown,
  env: Record<string, string | undefined>,
) {
  if (
    !Array.isArray(input) ||
    input.length > 100 ||
    JSON.stringify(input).length > 160_000
  )
    throw new Error("搭配记录过多，请分批分析");
  const evidence: StyleEvidence[] = input
    .filter(
      (e) => e && typeof e.matchId === "string" && typeof e.story === "string",
    )
    .map((e) => ({
      matchId: e.matchId.slice(0, 120),
      name: String(e.name || "").slice(0, 100),
      story: e.story.slice(0, 1600),
      pieces: (Array.isArray(e.pieces) ? e.pieces : [])
        .slice(0, 13)
        .map((p: Record<string, unknown>) => ({
          slot: String(p?.slot || "").slice(0, 20),
          name: String(p?.name || "").slice(0, 80),
          facts: (Array.isArray(p?.facts) ? p.facts : [])
            .slice(0, 18)
            .map((f) => String(f).slice(0, 80)),
        })),
    }));
  if (evidence.filter((e) => e.story.trim()).length < 2)
    throw new Error("至少需要两套带有穿搭说明的记录");
  const config = aiProvider(env);
  const response = await aiFetch(config, {
    max_tokens: 2400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: STYLE_INSIGHT_PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          evidence.map((entry) => ({
            matchId: entry.matchId,
            name: entry.name,
            story: entry.story,
            garments: entry.pieces
              .map(
                (piece) =>
                  `${piece.slot}: ${piece.name}（${piece.facts.slice(0, 2).join("、")}）`,
              )
              .join("；"),
          })),
        ),
      },
    ],
  }, STYLE_INSIGHT_TIMEOUT_MS).catch((error: Error) => {
    throw new Error(
      error.name === "TimeoutError"
        ? "分析时间较长，请稍后重试"
        : "分析服务连接失败，请稍后重试",
    );
  });
  if (!response.ok)
    throw new Error(`分析服务暂时不可用（${response.status}），请稍后重试`);
  const envelope = await response.json().catch(() => {
    throw new Error("分析结果未完整返回，请重试");
  });
  const content = String(envelope.choices?.[0]?.message?.content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("这次分析未完成，请重试");
  }
  const insights = validateAIInsights(raw, evidence);
  return { insights, modelVersion: config.model };
}
