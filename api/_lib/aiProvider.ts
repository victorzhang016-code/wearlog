/** Server-only configuration. Selecting a provider never falls back to another key. */
export function aiProvider(
  env: Record<string, string | undefined>,
  task: "text" | "vision" = "text",
) {
  const provider = env.AI_PROVIDER?.trim() || "kimi";
  if (!["kimi", "deepseek"].includes(provider))
    throw new Error("AI_PROVIDER must be kimi or deepseek");
  const deepseek = provider === "deepseek";
  const key =
    (deepseek ? env.DEEPSEEK_API_KEY : env.KIMI_API_KEY)?.trim() || "";
  const endpoint = deepseek
    ? "https://api.deepseek.com/chat/completions"
    : env.KIMI_API_ENDPOINT?.trim() ||
      "https://api.kimi.com/coding/v1/chat/completions";
  const model = deepseek
    ? (task === "vision"
        ? env.DEEPSEEK_VISION_MODEL
        : env.DEEPSEEK_TEXT_MODEL
      )?.trim() || "deepseek-flash"
    : (task === "text" ? env.KIMI_DECISION_MODEL : undefined)?.trim() ||
      env.KIMI_MODEL?.trim() ||
      "kimi-for-coding";
  if (
    deepseek &&
    task === "vision" &&
    ![
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ].includes(model)
  ) {
    throw new Error("当前 DeepSeek 图片接口请使用 deepseek-flash");
  }
  return {
    provider,
    key,
    endpoint,
    model,
    options: deepseek ? { thinking: { type: "disabled" } } : {},
  };
}

export async function aiFetch(
  config: ReturnType<typeof aiProvider>,
  body: Record<string, unknown>,
  timeoutMs = 55_000,
) {
  if (!config.key) throw new Error("AI 服务尚未配置密钥");
  return fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...body, model: config.model, ...config.options }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
