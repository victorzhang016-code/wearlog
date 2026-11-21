import { supabase } from "./supabase";
import { validateAIInsights, STYLE_INSIGHT_TIMEOUT_MS, type StyleEvidence } from "./styleInsights";

export async function requestStyleInsights(evidence: StyleEvidence[]) {
  let token = "";
  if (!import.meta.env.DEV) {
    const session = await supabase?.auth.getSession();
    token = session?.data.session?.access_token || "";
    if (!token) throw new Error("请重新登录后分析");
  }
  const response = await fetch(
    import.meta.env.DEV
      ? "/api/local/aesthetic/style-insights"
      : "/api/ai-import",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ task: "style_insights", evidence }),
      signal: AbortSignal.timeout(STYLE_INSIGHT_TIMEOUT_MS + 10_000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "分析暂时不可用，请稍后重试",
    );
  return {
    insights: validateAIInsights(body, evidence),
    modelVersion: String(body.modelVersion || ""),
  };
}
