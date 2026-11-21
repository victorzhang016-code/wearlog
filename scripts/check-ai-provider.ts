/** Read-only smoke test. Never logs keys or writes wardrobe data. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { parse } from "dotenv";
import { aiProvider, aiFetch } from "../api/_lib/aiProvider";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const env = {
  ...parse(readFileSync(option("--env") || ".env.local")),
  AI_PROVIDER: option("--provider") || "kimi",
};
const config = aiProvider(env);
if (!config.key) throw new Error(`${config.provider}: 请先在本地配置密钥`);
const output = resolve(
  option("--output") || `.local-data/ai-evaluation/${config.provider}.json`,
);
const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  provider: config.provider,
  textModel: config.model,
};

function testImage() {
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4),
      tail = Buffer.alloc(4),
      body = Buffer.concat([Buffer.from(type), data]);
    head.writeUInt32BE(data.length);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256);
  header.writeUInt32BE(128, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(128 * (1 + 256 * 3));
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++)
      pixels[y * 769 + 1 + x * 3 + (x < 128 ? 0 : 2)] = 255;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
async function probe(task: "text" | "vision", content: unknown) {
  const started = Date.now();
  try {
    const response = await aiFetch(aiProvider(env, task), {
      max_tokens: 1200,
      messages: [
        { role: "system", content: "Only return valid JSON." },
        { role: "user", content },
      ],
    });
    const data = await response.json().catch(() => ({}));
    // The model output is safe to retain locally; upstream error bodies may contain secrets.
    const responseContent = response.ok
      ? data.choices?.[0]?.message?.content
      : undefined;
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(
        String(responseContent || "")
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, ""),
      );
    } catch {}
    const result = {
      status: response.status,
      ms: Date.now() - started,
      model: data.model,
      content: responseContent,
      parsed,
      jsonValid: !!parsed,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
      errorCode: data.error?.code,
    };
    console.log(JSON.stringify({ task, status: result.status, ms: result.ms }));
    return result;
  } catch (error) {
    return {
      status: "failed",
      ms: Date.now() - started,
      error: error instanceof Error ? error.name : "Error",
    };
  }
}
if (config.provider === "deepseek") {
  const response = await fetch("https://api.deepseek.com/models", {
    headers: { authorization: `Bearer ${config.key}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  report.models = {
    status: response.status,
    ids: body.data?.map((m: { id: string }) => m.id),
  };
}
report.text = await probe(
  "text",
  '把“黑色衬衫一件，运动鞋一双”整理成 JSON {"items":[{"name":"","category":"上装|下装|鞋子|配饰"}]}。不添加品牌。',
);
report.vision = await probe("vision", [
  {
    type: "text",
    text: 'Return JSON {"left":"color in English","right":"color in English"} for this image.',
  },
  { type: "image_url", image_url: { url: testImage() } },
]);
const snapshotFile = option("--snapshot");
if (snapshotFile) {
  const raw = JSON.parse(readFileSync(snapshotFile, "utf8"));
  const wardrobe = raw.wardrobeItems || raw.items || [];
  const samples: unknown[] = [];
  for (const category of ["上装", "下装", "鞋子", "配饰"].filter(
    (c) => !option("--category") || c === option("--category"),
  )) {
    const item = wardrobe.find(
      (i: { category: string; imageUrl?: string }) =>
        i.category === category && i.imageUrl,
    );
    if (!item) continue;
    let image = item.imageUrl;
    if (!image.startsWith("data:")) {
      const asset = await fetch(image, { signal: AbortSignal.timeout(20_000) });
      if (!asset.ok) {
        samples.push({
          itemId: item.id,
          error: "image_fetch_failed",
          status: asset.status,
        });
        continue;
      }
      const bytes = Buffer.from(await asset.arrayBuffer());
      if (bytes.length > 4_000_000) {
        samples.push({ itemId: item.id, error: "image_too_large" });
        continue;
      }
      image = `data:${asset.headers.get("content-type") || "image/jpeg"};base64,${bytes.toString("base64")}`;
    }
    const response = await probe("vision", [
      {
        type: "text",
        text: `当前要记录的单品：${item.name}。只分析这个目标，无法看清时用空数组，不要改为分析旁边的衣服。返回 JSON {"category":"上装|下装|鞋子|配饰","colors":["可见颜色"],"silhouette":["可见轮廓"],"details":["可见细节"]}。不要猜测品牌、材质成分或人体特征。`,
      },
      { type: "image_url", image_url: { url: image } },
    ]);
    samples.push({
      itemId: item.id,
      expectedCategory: category,
      categoryMatches:
        "parsed" in response && response.parsed?.category === category,
      ...response,
    });
  }
  report.samples = samples;
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(
  `Saved ${output}. Connectivity and samples only; not a quality-equivalence verdict.`,
);
