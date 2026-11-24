import { supabase } from "./supabase";
import { validateAIInsights, STYLE_INSIGHT_TIMEOUT_MS, type StyleEvidence } from "./styleInsights";

export async function requestStyleInsights(evidence: StyleEvidence[], signal?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(
    new DOMException("分析时间较长，请稍后重试。", "TimeoutError"),
  ), STYLE_INSIGHT_TIMEOUT_MS + 10_000);
  try {
    let token = "";
    if (!import.meta.env.DEV) {
      const session = await supabase?.auth.getSession();
      token = session?.data.session?.access_token || "";
      if (!token) throw new Error("请重新登录后分析");
    }
    if (controller.signal.aborted)
      throw controller.signal.reason || new DOMException("请求已取消", "AbortError");
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
        signal: controller.signal,
      },
    );
    const body = await response.json().catch((error) => {
      if (controller.signal.aborted) throw controller.signal.reason || error;
      return {};
    });
    if (controller.signal.aborted)
      throw controller.signal.reason || new DOMException("请求已取消", "AbortError");
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
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
