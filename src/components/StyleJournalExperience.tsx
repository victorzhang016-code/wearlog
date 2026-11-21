import { useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  ChevronDown,
  Shirt,
} from "lucide-react";
import type { BestMatch, WardrobeItem } from "../types";
import type { AnalysisRun, PerceptualColor } from "../lib/aestheticAnalysisV3";
import {
  COLOR_ROLE_LABELS,
  journalColorGroups,
  journalSubstitutions,
  type ColorRoleFilter,
} from "../lib/styleJournalView";
import {
  buildStyleInsights,
  styleEvidence,
  type StyleInsight,
} from "../lib/styleInsights";
import { requestStyleInsights } from "../lib/requestStyleInsights";
import { getTagTheme } from "../lib/tagThemes";
import { resolveMediaUrl } from "../lib/media";
import { ColorSwatchCard, ColorSwatchFan } from "./ColorSwatchCard";
import "./StyleJournalExperience.css";

type Props = {
  items: WardrobeItem[];
  matches: BestMatch[];
  run: AnalysisRun;
  colors: PerceptualColor[];
};
const rgb = (color: PerceptualColor) => ({
  r: color.rgb[0],
  g: color.rgb[1],
  b: color.rgb[2],
});

function GarmentImage({ item }: { item: WardrobeItem }) {
  const [failed, setFailed] = useState(false);
  const src = resolveMediaUrl(item.imageUrl);
  return src && !failed ? (
    <img
      src={src}
      alt={item.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="sj-photo-missing">
      <Shirt size={28} strokeWidth={1} />
      <span>{item.name}</span>
    </span>
  );
}

function journalTagStyle(id: string): CSSProperties {
  const theme = getTagTheme(id);
  return {
    "--sj-paper": theme.bgColor,
    "--sj-paper-ink": theme.textPrimary,
    "--sj-paper-muted": theme.textSecondary,
    "--sj-paper-edge": theme.borderEdge,
    "--sj-paper-hole": theme.holeColor,
    "--sj-paper-texture": theme.texture,
  } as CSSProperties;
}

function ItemCard({
  item,
  samples = [],
}: {
  item: WardrobeItem;
  samples?: PerceptualColor[];
}) {
  return (
    <Link
      to={`/item/${item.id}`}
      className="sj-item"
      style={journalTagStyle(item.id)}
    >
      <div className="sj-item-photo">
        <span className="sj-tag-meta">
          {item.category}
          <i className="sj-tag-eyelet" aria-hidden="true" />
        </span>
        <GarmentImage key={item.imageUrl} item={item} />
      </div>
      <div className="sj-item-caption">
        <p>{item.name}</p>
        <span>{item.brand || item.category}</span>
        {!!samples.length && (
          <div className="sj-mini-colors">
            {samples.map((color, index) => (
              <i
                key={index}
                style={{ background: color.hex }}
                title={`${COLOR_ROLE_LABELS[color.role]} ${color.hex}`}
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function OutfitBoard({
  match,
  items,
  replace,
}: {
  match: BestMatch;
  items: WardrobeItem[];
  replace?: { from: string; to: WardrobeItem };
}) {
  const map = new Map(items.map((item) => [item.id, item]));
  const parts = Object.entries(match.items)
    .flatMap(([slot, entries]) =>
      entries.map((entry) => ({
        slot,
        item:
          replace && entry.primary === replace.from
            ? replace.to
            : map.get(entry.primary),
      })),
    )
    .filter((entry) => entry.item);
  return (
    <div
      className={`sj-outfit-board ${parts.length <= 4 ? "sj-outfit-board--compact" : ""}`}
      style={
        {
          "--sj-rows": Math.max(
            2,
            parts.length <= 4
              ? Math.ceil(parts.length / 2)
              : Math.ceil((parts.length + 1) / 3),
          ),
          "--sj-mobile-rows": Math.ceil(parts.length / 2),
        } as CSSProperties
      }
    >
      {parts.map(({ item, slot }, index) => (
        <div
          className={`sj-board-piece sj-board-piece--${slot}`}
          key={`${slot}:${index}`}
          style={journalTagStyle(item!.id)}
        >
          <div className="sj-tag-meta">
            {item!.category}
            <i className="sj-tag-eyelet" aria-hidden="true" />
          </div>
          <GarmentImage key={item!.imageUrl} item={item!} />
          <span>{item!.name}</span>
        </div>
      ))}
      {!parts.length && <p>这套搭配的单品暂时不可用</p>}
    </div>
  );
}

function PaletteChapter({
  items,
  matches,
  colors,
}: Pick<Props, "items" | "matches" | "colors">) {
  const [params, setParams] = useSearchParams();
  const role = (
    ["all", "dominant", "secondary", "accent"].includes(
      params.get("role") || "",
    )
      ? params.get("role")
      : "dominant"
  ) as ColorRoleFilter;
  const groups = useMemo(
    () => journalColorGroups(colors, items, role),
    [colors, items, role],
  );
  const selected =
    groups.find((group) => group.family === params.get("color")) || groups[0];
  const [visible, setVisible] = useState(8);
  const [allPairs, setAllPairs] = useState(false);
  const confirmedIds = new Set(
    colors
      .filter(
        (color) =>
          color.evidenceStatus === "confirmed" &&
          items.some((item) => item.id === color.itemId),
      )
      .map((color) => color.itemId),
  );
  const selectedItems = selected
    ? items
        .filter((item) => selected.itemIds.includes(item.id))
        .sort(
          (a, b) =>
            Number(
              selected.samples.some(
                (c) => c.itemId === b.id && c.role === "dominant",
              ),
            ) -
            Number(
              selected.samples.some(
                (c) => c.itemId === a.id && c.role === "dominant",
              ),
            ),
        )
    : [];
  const paired = selected
    ? matches.filter((match) =>
        Object.values(match.items).some((slots) =>
          slots.some((slot) => selected.itemIds.includes(slot.primary)),
        ),
      )
    : [];
  const choose = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "role") next.delete("color");
    setParams(next, { replace: true });
    setVisible(8);
    setAllPairs(false);
  };
  if (!groups.length)
    return (
      <div className="sj-empty">
        <h2>先确认衣物颜色</h2>
        <p>
          {role === "all"
            ? "在单品详情里确认颜色后，你的色卡会在这里按色系整理。"
            : `还没有确认过的${COLOR_ROLE_LABELS[role]}。可以先看看其他颜色。`}
        </p>
        {role !== "all" ? (
          <button className="back-link" onClick={() => choose("role", "all")}>
            查看全部颜色
          </button>
        ) : (
          <Link to="/" className="sj-button">
            去衣柜确认颜色 <ArrowRight size={16} />
          </Link>
        )}
      </div>
    );
  return (
    <div className="sj-chapter">
      <section className="sj-palette-intro">
        <div>
          <p className="sj-eyebrow">Color archive / 01</p>
          <h2>
            {groups
              .slice(0, 2)
              .map((group) => `${group.family}色`)
              .join("与")}
            ，<br />
            是衣柜里最多的颜色。
          </h2>
          <p>按色系整理衣物，查看已有的配色。</p>
          <span className="sj-caption">
            已整理 {confirmedIds.size} / {items.length} 件衣物 ·
            色卡来自已确认的颜色
          </span>
        </div>
        <div className="sj-palette-fan" aria-label="衣柜代表色">
          <ColorSwatchFan
            colors={groups.slice(0, 5).map((group) => ({
              color: rgb(group.color),
              role: `${group.family}色 · ${group.itemIds.length} 件`,
            }))}
            size="lg"
            spread={15}
          />
        </div>
      </section>
      <section aria-labelledby="sj-colors-title">
        <div className="sj-section-heading">
          <div>
            <h2 id="sj-colors-title">我的色卡</h2>
            <p>选一个色系，查看衣物和搭配。</p>
          </div>
          <div className="sj-filters" aria-label="按颜色角色筛选">
            {Object.entries(COLOR_ROLE_LABELS).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={role === value}
                onClick={() => choose("role", value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="sj-swatch-shelf">
          {groups.map((group) => (
            <button
              key={group.family}
              className="sj-swatch-choice"
              aria-pressed={selected.family === group.family}
              aria-label={`${group.family}色，${group.itemIds.length} 件衣物`}
              onClick={() => choose("color", group.family)}
            >
              <ColorSwatchCard
                color={rgb(group.color)}
                code={`${group.itemIds.length} 件衣物`}
                role={`${group.family}色系`}
              />
              <span className="sj-swatch-marker" />
            </button>
          ))}
        </div>
        <div className="sj-color-selection">
          <div>
            <h3>
              {selected.family}色，藏在这 {selectedItems.length} 件里
            </h3>
            <p>同一件衣服可以有多个颜色。点开单品，查看或调整它的色卡。</p>
          </div>
          <span className="sj-caption">按色系归类，保留每件的原色</span>
        </div>
        <div className="sj-item-grid">
          {selectedItems.slice(0, visible).map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              samples={selected.samples.filter(
                (entry) => entry.itemId === item.id,
              )}
            />
          ))}
        </div>
        {visible < selectedItems.length && (
          <button
            className="sj-more"
            onClick={() => setVisible((value) => value + 8)}
          >
            再看 {Math.min(8, selectedItems.length - visible)} 件{" "}
            <ChevronDown size={16} />
          </button>
        )}
      </section>
      {!!paired.length && (
        <section className="sj-pairings">
          <div className="sj-section-heading">
            <div>
              <h2>这个颜色，你这样搭过</h2>
              <p>把单件的颜色放回整套搭配里看。</p>
            </div>
            <span className="sj-caption">{paired.length} 套 Best Match</span>
          </div>
          <div className="sj-look-grid">
            {paired.slice(0, allPairs ? paired.length : 3).map((match) => {
              const ids = Object.values(match.items).flatMap((slots) =>
                slots.map((slot) => slot.primary),
              );
              const palette = colors.filter(
                (color) =>
                  color.evidenceStatus === "confirmed" &&
                  ids.includes(color.itemId) &&
                  color.role === "dominant",
              );
              return (
                <Link
                  to={`/best-match/${match.id}`}
                  className="sj-look"
                  key={match.id}
                >
                  <OutfitBoard match={match} items={items} />
                  <div className="sj-look-caption">
                    <h3>{match.name || "我的搭配"}</h3>
                    <ArrowRight size={16} />
                  </div>
                  <div className="sj-palette-strip">
                    {palette.map((color, index) => (
                      <span
                        key={index}
                        style={{ background: color.hex }}
                        title={color.hex}
                      />
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
          {paired.length > 3 && (
            <button
              className="sj-more"
              onClick={() => setAllPairs((value) => !value)}
            >
              {allPairs ? "收起搭配" : `查看其余 ${paired.length - 3} 套`}{" "}
              <ChevronDown size={16} />
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function SwapChapter({ items, matches, run }: Omit<Props, "colors">) {
  const substitutions = useMemo(
    () => journalSubstitutions(run, matches, items),
    [run, matches, items],
  );
  const [category, setCategory] = useState("全部");
  const [selection, setSelection] = useState("");
  const [contextId, setContextId] = useState("");
  const options = substitutions.filter(
    (entry) => category === "全部" || entry.from.category === category,
  );
  const selected =
    options.find((entry) => entry.contract.id === selection) || options[0];
  const context =
    selected?.contexts.find((match) => match.id === contextId) ||
    selected?.contexts[0];
  const [after, setAfter] = useState(true);
  return (
    <section className="sj-swap-section" aria-labelledby="sj-swap-title">
      <div className="sj-section-heading">
        <div>
          <p className="sj-eyebrow">Variations / 03</p>
          <h2 id="sj-swap-title">同类替换</h2>
          <p>对照你保存过的替换，看看换一件后的整套效果。</p>
        </div>
      </div>
      <div className="sj-filters" aria-label="替换品类">
        {["全部", "上装", "下装", "鞋子", "配饰"].map((value) => (
          <button
            key={value}
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
              setSelection("");
              setContextId("");
            }}
          >
            {value}
          </button>
        ))}
      </div>
      {selected && context ? (
        <div className="sj-swap-layout">
          <div className="sj-swap-preview">
            <div className="sj-swap-preview-heading">
              <span>{context.name || "我的搭配"}</span>
              <div className="sj-filters">
                <button aria-pressed={!after} onClick={() => setAfter(false)}>
                  原搭配
                </button>
                <button aria-pressed={after} onClick={() => setAfter(true)}>
                  换一件
                </button>
              </div>
            </div>
            <OutfitBoard
              match={context}
              items={items}
              replace={
                after ? { from: selected.from.id, to: selected.to } : undefined
              }
            />
            <p className="sj-caption">
              {after
                ? `已换入「${selected.to.name}」`
                : `原搭配使用「${selected.from.name}」`}
            </p>
          </div>
          <div className="sj-swap-detail">
            <label className="sj-select-label">
              选一组同类替换
              <select
                value={selected.contract.id}
                onChange={(event) => {
                  setSelection(event.target.value);
                  setContextId("");
                  setAfter(true);
                }}
              >
                {options.map((entry) => (
                  <option key={entry.contract.id} value={entry.contract.id}>
                    {entry.from.name} → {entry.to.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sj-swap-pair">
              <ItemCard item={selected.from} />
              <ArrowLeftRight size={22} strokeWidth={1} />
              <ItemCard item={selected.to} />
            </div>
            <div className="sj-swap-explanation">
              <h3>你保存过的替换</h3>
              <p>
                在 {selected.contexts.length} 套搭配里，你把这两件
                {selected.from.category === "鞋子"
                  ? "鞋"
                  : selected.from.category}
                设为同一位置的备选。
              </p>
              <p className="sj-caption">
                保留其余单品，对照颜色、轮廓和细节的变化。
              </p>
            </div>
            {selected.contexts.length > 1 && (
              <label className="sj-select-label">
                放在哪套搭配里看
                <select
                  value={context.id}
                  onChange={(event) => setContextId(event.target.value)}
                >
                  {selected.contexts.map((match) => (
                    <option key={match.id} value={match.id}>
                      {match.name || "我的搭配"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Link to={`/best-match/${context.id}`} className="sj-button">
              打开这套搭配 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="sj-empty sj-empty--small">
          <h3>还没有{category === "全部" ? "" : category}替换记录</h3>
          <p>在 Best Match 中为某件衣服添加同类变体，这里就能并排比较。</p>
          <Link to="/best-match" className="back-link">
            去看看我的搭配 <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}

type InsightSession = { fingerprint: string; insights: StyleInsight[] };
function OutfitChapter({
  items,
  matches,
  run,
  colors,
  generated,
  onGenerated,
}: Props & {
  generated?: InsightSession;
  onGenerated: (value: InsightSession) => void;
}) {
  const evidence = useMemo(
    () => styleEvidence(run, matches, items),
    [run, matches, items],
  );
  const fingerprint = JSON.stringify(evidence);
  const observed = useMemo(
    () => buildStyleInsights(run, matches, items),
    [run, matches, items],
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const stories =
    generated?.fingerprint === fingerprint && generated.insights.length
      ? [
          ...generated.insights,
          ...observed.filter((s) => s.source === "computed"),
        ]
      : observed;
  const selected =
    stories.find((story) => story.id === selectedId) || stories[0];
  const ids = selected?.matchIds || [];
  const match = matches.find(
    (entry) => entry.id === ids[exampleIndex % ids.length],
  );
  const currentQuote = selected?.quotes.find((q) => q.matchId === match?.id);
  const primaryIds = match
    ? Object.values(match.items).flatMap((parts) => parts.map((p) => p.primary))
    : [];
  async function analyze() {
    setBusy(true);
    setNotice("");
    try {
      const result = await requestStyleInsights(evidence);
      onGenerated({ fingerprint, insights: result.insights });
      setSelectedId("");
      setExampleIndex(0);
      if (!result.insights.length)
        setNotice("暂时没有找到有充分记录支持的新结论，已有观察仍保留。");
    } catch (error) {
      setNotice(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "分析时间较长，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sj-chapter">
      <section>
        <div className="sj-section-heading sj-style-heading">
          <div>
            <p className="sj-eyebrow">Personal notes / 02</p>
            <h2>你的穿衣偏好</h2>
            <p>比例怎么调，细节怎么选。看看你反复在意的事。</p>
          </div>
          <div className="sj-analyze-action">
            <button
              className="sj-button"
              disabled={
                busy || evidence.filter((e) => e.story.trim()).length < 2
              }
              onClick={analyze}
            >
              {busy ? "正在分析…" : generated ? "重新分析" : "分析穿搭偏好"}
              <ArrowRight size={15} />
            </button>
            <span>AI 结合搭配说明归纳，附原文出处</span>
          </div>
        </div>
        {notice && (
          <p className="sj-analysis-notice" role="status">
            {notice}
          </p>
        )}
        {selected && match ? (
          <>
            <div className="sj-story-tabs" aria-label="选择穿搭脉络">
              {stories.map((story, index) => (
                <button
                  key={story.id}
                  aria-pressed={selected.id === story.id}
                  onClick={(event) => {
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                      behavior: "auto",
                    });
                    setSelectedId(story.id);
                    setExampleIndex(0);
                  }}
                >
                  <span className="sj-tab-meta">
                    {String(index + 1).padStart(2, "0")} / {story.category}
                  </span>
                  {story.title}
                </button>
              ))}
            </div>
            <article className="sj-story-spread">
              <div className="sj-story-visual">
                <div className="sj-board-heading">
                  <span>BEST MATCH</span>
                  <span>
                    {String((exampleIndex % ids.length) + 1).padStart(2, "0")} /{" "}
                    {String(ids.length).padStart(2, "0")}
                  </span>
                </div>
                <Link
                  to={`/best-match/${match.id}`}
                  aria-label={`查看搭配：${match.name || "我的搭配"}`}
                >
                  <OutfitBoard match={match} items={items} />
                </Link>
                <div className="sj-example-caption">
                  <Link to={`/best-match/${match.id}`}>
                    {match.name || "我的搭配"}
                    <ArrowRight size={15} />
                  </Link>
                  <button
                    aria-label="看下一套代表搭配"
                    disabled={ids.length < 2}
                    onClick={() => setExampleIndex((v) => v + 1)}
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>
              <div className="sj-story-copy">
                <span className="sj-paper-eyelet" aria-hidden="true" />
                <span className="sj-caption">
                  {selected.source === "ai"
                    ? "AI 解读 · 待你判断"
                    : selected.source === "computed"
                      ? "搭配中的观察"
                      : "你写过的想法"}{" "}
                  · {ids.length} 套
                </span>
                <h3>{selected.title}</h3>
                <p className="sj-story-conclusion">{selected.summary}</p>
                {currentQuote && (
                  <blockquote className="sj-source-quote">
                    <p>“{currentQuote.text}”</p>
                    <cite>你在「{match.name || "这套搭配"}」中写道</cite>
                  </blockquote>
                )}
                {selected.observation && (
                  <div className="sj-structure-observation">
                    <div className="sj-observation-number">
                      <strong>{selected.observation.support}</strong>
                      <span> / {selected.observation.total} 套</span>
                    </div>
                    <p>{selected.observation.label}</p>
                    <div className="sj-observation-bar">
                      <span
                        style={{
                          width: `${(100 * selected.observation.support) / selected.observation.total}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="sj-note">
                  <span>下次可以试试</span>
                  <p>{selected.suggestion}</p>
                </div>
                <div className="sj-story-colors">
                  {colors
                    .filter(
                      (c) =>
                        c.evidenceStatus === "confirmed" &&
                        c.role === "dominant" &&
                        primaryIds.includes(c.itemId),
                    )
                    .slice(0, 3)
                    .map((color, index) => (
                      <ColorSwatchCard
                        key={index}
                        color={rgb(color)}
                        role={
                          items.find((i) => i.id === color.itemId)?.name ||
                          "主色"
                        }
                        code={color.hex}
                        size="sm"
                      />
                    ))}
                </div>
                <details className="sj-evidence" key={selected.id}>
                  <summary>
                    为什么这样说 <ChevronDown size={15} />
                  </summary>
                  {selected.source === "computed" ? (
                    <p>
                      只统计上下装宽窄均已确认、且各有一件主件的搭配；未知信息和多层搭配未计入。衣服的宽窄不等于实际体态效果。
                    </p>
                  ) : (
                    <p>
                      {selected.source === "ai"
                        ? "这是根据你的原话作出的解读，引用可核对，结论仍可能有偏差。"
                        : "按你当前的搭配说明整理，具体感受以原话为准。"}
                    </p>
                  )}
                  {selected.quotes.map((q) => (
                    <blockquote key={q.matchId}>
                      “{q.text}”{" "}
                      <Link to={`/best-match/${q.matchId}`}>
                        {matches.find((m) => m.id === q.matchId)?.name ||
                          "查看记录"}
                        <ArrowRight size={12} />
                      </Link>
                    </blockquote>
                  ))}
                  <Link to={`/best-match/${match.id}`}>
                    查看这套搭配的原始记录 <ArrowRight size={14} />
                  </Link>
                </details>
              </div>
            </article>
          </>
        ) : (
          <div className="sj-empty">
            <h3>{matches.length ? "还需要一些穿搭说明" : "先保存一套搭配"}</h3>
            <p>记录为什么这样穿、试过哪些调整，才能进一步分析你的偏好。</p>
            {matches.length ? (
              <div className="sj-look-grid">
                {matches.slice(0, 3).map((entry) => (
                  <Link
                    className="sj-look"
                    key={entry.id}
                    to={`/best-match/${entry.id}`}
                  >
                    <OutfitBoard match={entry} items={items} />
                    <h3>{entry.name || "我的搭配"}</h3>
                  </Link>
                ))}
              </div>
            ) : (
              <Link
                className="sj-button"
                to={items.length >= 3 ? "/best-match/new" : "/"}
              >
                记录搭配 <ArrowRight size={16} />
              </Link>
            )}
          </div>
        )}
      </section>
      <SwapChapter items={items} matches={matches} run={run} />
    </div>
  );
}

export function StyleJournalExperience(props: Props) {
  const [generated, setGenerated] = useState<InsightSession>();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "outfits" ? "outfits" : "colors";
  return (
    <main className="style-journal">
      <header className="sj-header">
        <Link to="/" className="back-link">
          <ArrowLeft size={16} />
          返回衣柜
        </Link>
        <div className="sj-title-row">
          <div>
            <p className="sj-eyebrow">Style Journal</p>
            <h1>我的风格志</h1>
          </div>
          <p>
            衣柜配色，
            <br />
            穿搭偏好。
          </p>
        </div>
        <nav className="sj-main-tabs" aria-label="风格志章节">
          {[
            { id: "colors", label: "我的色卡", en: "Colors" },
            { id: "outfits", label: "我的穿搭", en: "Outfits" },
          ].map((entry) => (
            <button
              key={entry.id}
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("view", entry.id);
                setParams(next, { replace: true });
              }}
            >
              {entry.label}
              <span>{entry.en}</span>
            </button>
          ))}
        </nav>
      </header>
      {!props.items.length ? (
        <div className="sj-empty">
          <Shirt size={42} strokeWidth={1} />
          <h2>把第一件喜欢的衣服留下来</h2>
          <p>它的添加衣物、保存搭配后，在这里查看配色和穿搭分析。</p>
          <Link className="sj-button" to="/">
            开始记录衣柜 <ArrowRight size={16} />
          </Link>
        </div>
      ) : tab === "colors" ? (
        <PaletteChapter {...props} />
      ) : (
        <OutfitChapter
          {...props}
          generated={generated}
          onGenerated={setGenerated}
        />
      )}
      <footer className="sj-footer">
        <span>WEARLOG · PERSONAL STYLE JOURNAL</span>
        <span>只属于你的衣柜记录</span>
      </footer>
    </main>
  );
}
