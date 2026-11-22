import { useMemo, useState } from "react";
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
import { ColorSwatchCard, ColorSwatchFan } from "./ColorSwatchCard";
import { WardrobeItemCard } from "./WardrobeItemCard";
import { JournalColorPatterns } from "./JournalColorPatterns";
import { journalPaletteAnalysis } from "../lib/journalPaletteAnalysis";
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

function ItemCard({ item }: { item: WardrobeItem }) {
  return (
    <Link
      to={`/item/${item.id}`}
      className="sj-item-link"
      aria-label={`查看单品：${item.name}`}
    >
      <WardrobeItemCard
        item={item}
        index={0}
        eager={false}
        onCardClick={() => {}}
      />
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
    <div className="sj-outfit-board masonry-grid">
      {parts.map(({ item, slot }, index) => (
        <ItemCard key={`${slot}:${index}`} item={item!} />
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
  const paletteAnalysis = useMemo(
    () => journalPaletteAnalysis(colors, items, matches),
    [colors, items, matches],
  );
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
  const choose = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "role") next.delete("color");
    setParams(next, { replace: true });
    setVisible(8);
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
          <h2>
            {paletteAnalysis.choices.length
              ? `黑白灰之外，${paletteAnalysis.choices[0].family}色最多`
              : "已确认的颜色以黑白灰为主"}
          </h2>
          <p>
            已确认 {confirmedIds.size} 件衣物的颜色，共 {items.length} 件。
          </p>
          <span className="sj-caption">
            按已保存的衣物整理 · 同一件可以属于多个色系
          </span>
        </div>
        <div className="sj-palette-fan" aria-label="衣柜代表色">
          <ColorSwatchFan
            colors={paletteAnalysis.families.slice(0, 5).map((group) => ({
              color: rgb(group.color),
              role: `${group.family}色 · ${group.itemIds.length} 件`,
            }))}
            size="lg"
            spread={15}
          />
        </div>
      </section>
      <JournalColorPatterns analysis={paletteAnalysis} matches={matches} />
      <section aria-labelledby="sj-colors-title">
        <div className="sj-section-heading">
          <div>
            <h2 id="sj-colors-title">查看全部色卡</h2>
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
              <i style={{ background: group.color.hex }} aria-hidden="true" />
              <span>{group.family}色</span>
              <span className="sj-color-count">{group.itemIds.length}</span>
            </button>
          ))}
        </div>
        <div className="sj-color-selection">
          <div>
            <h3>
              {selected.family}色 · {selectedItems.length} 件
            </h3>
          </div>
          <details className="sj-color-samples" open>
            <summary>
              查看原色色卡 <ChevronDown size={16} />
            </summary>
            <div className="sj-sample-list">
              {[
                ...new Map(
                  selected.samples.map((color) => [color.hex, color]),
                ).values(),
              ].map((color) => (
                <ColorSwatchCard
                  key={color.hex}
                  color={rgb(color)}
                  role={`${new Set(selected.samples.filter((sample) => sample.hex === color.hex).map((sample) => sample.itemId)).size} 件衣物`}
                  code={color.hex}
                />
              ))}
            </div>
          </details>
        </div>
        <details
          className="sj-palette-detail sj-garment-source"
          key={`${selected.family}:${role}`}
        >
          <summary>
            查看{selected.family}色的 {selectedItems.length} 件衣物{" "}
            <ChevronDown size={16} />
          </summary>
          <div className="sj-item-grid masonry-grid">
            {selectedItems.slice(0, visible).map((item) => (
              <ItemCard key={item.id} item={item} />
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
        </details>
      </section>
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
          <h2 id="sj-swap-title">同类替换</h2>
          <p>对比已保存的备选单品。</p>
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
                  替换前
                </button>
                <button aria-pressed={after} onClick={() => setAfter(true)}>
                  替换后
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
              替换单品
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
            <div className="sj-swap-pair masonry-grid">
              <ItemCard item={selected.from} />
              <ArrowLeftRight size={22} strokeWidth={1} />
              <ItemCard item={selected.to} />
            </div>
            <div className="sj-swap-explanation">
              <p>这两件单品在 {selected.contexts.length} 套搭配中互为备选。</p>
            </div>
            {selected.contexts.length > 1 && (
              <label className="sj-select-label">
                对比搭配
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
              查看搭配 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="sj-empty sj-empty--small">
          <h3>还没有{category === "全部" ? "" : category}替换记录</h3>
          <p>在 Best Match 中为某件衣服添加同类变体，这里就能并排比较。</p>
          <Link to="/best-match" className="back-link">
            去 Best Match 添加备选 <ArrowRight size={16} />
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
            <h2>穿搭偏好</h2>
            <p>从你的搭配和记录中，整理比例、细节与穿衣习惯。</p>
          </div>
          <div className="sj-analyze-action">
            <button
              className="sj-button sj-button--primary header-action-button"
              disabled={
                busy || evidence.filter((e) => e.story.trim()).length < 2
              }
              onClick={analyze}
            >
              {busy ? "正在分析…" : generated ? "重新分析" : "分析穿搭偏好"}
              <ArrowRight size={15} />
            </button>
            {evidence.filter((e) => e.story.trim()).length < 2 && (
              <span>至少为两套搭配添加说明后可分析</span>
            )}
            {busy && <span role="status">正在阅读搭配记录，请稍候</span>}
          </div>
        </div>
        {notice && (
          <p className="sj-analysis-notice" role="status">
            {notice}
          </p>
        )}
        {selected && match ? (
          <>
            <label className="sj-select-label sj-story-select">
              查看分析
              <select
                value={selected.id}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setExampleIndex(0);
                }}
              >
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="sj-story-tabs" aria-label="选择穿搭分析">
              {stories.map((story) => (
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
                  {story.title}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
            <article className="sj-story-spread">
              <div className="sj-story-visual">
                <div className="sj-board-heading">
                  <span>相关搭配</span>
                  <span>
                    {(exampleIndex % ids.length) + 1} / {ids.length}
                  </span>
                </div>
                <div className="sj-example-caption">
                  <Link to={`/best-match/${match.id}`}>
                    {match.name || "我的搭配"}
                    <ArrowRight size={15} />
                  </Link>
                  <button
                    className="sj-button"
                    aria-label="下一套相关搭配"
                    disabled={ids.length < 2}
                    onClick={() => setExampleIndex((v) => v + 1)}
                  >
                    下一套 <ArrowRight size={16} />
                  </button>
                </div>
                <OutfitBoard match={match} items={items} />
              </div>
              <div className="sj-story-copy">
                <span className="sj-paper-eyelet" aria-hidden="true" />
                <span className="sj-caption">
                  {selected.source === "ai"
                    ? "AI 分析"
                    : selected.source === "computed"
                      ? "搭配统计"
                      : "记录整理"}{" "}
                  · 基于 {ids.length} 套搭配
                </span>
                <h3>{selected.title}</h3>
                <p className="sj-story-conclusion">{selected.summary}</p>
                {currentQuote && (
                  <blockquote className="sj-source-quote">
                    <p>“{currentQuote.text}”</p>
                    <cite>摘自「{match.name || "这套搭配"}」</cite>
                  </blockquote>
                )}
                {selected.observation && (
                  <div className="sj-structure-observation">
                    <p>
                      {selected.observation.total} 套
                      {selected.observation.label}中，
                      {selected.observation.support} 套采用这一组合。
                    </p>
                  </div>
                )}
                <div className="sj-note">
                  <h4>搭配建议</h4>
                  <p>{selected.suggestion}</p>
                </div>
                <details className="sj-evidence" key={selected.id}>
                  <summary>
                    查看分析依据 <ChevronDown size={16} />
                  </summary>
                  {selected.source === "computed" ? (
                    <p>
                      只统计上下装宽窄均已确认、且各有一件主件的搭配；未知信息和多层搭配未计入。衣服的宽窄不等于实际体态效果。
                    </p>
                  ) : (
                    <p>
                      {selected.source === "ai"
                        ? "AI 根据以下搭配记录归纳，结论可能有偏差。"
                        : "根据以下搭配记录整理。"}
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
                  <div className="sj-look" key={entry.id}>
                    <OutfitBoard match={entry} items={items} />
                    <Link className="sj-button" to={`/best-match/${entry.id}`}>
                      {entry.name || "查看搭配"} <ArrowRight size={16} />
                    </Link>
                  </div>
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
            <h1>我的风格志</h1>
          </div>
        </div>
        <nav className="sj-main-tabs" aria-label="风格志章节">
          {[
            { id: "colors", label: "我的色卡", english: "My Colors" },
            { id: "outfits", label: "我的穿搭", english: "My Outfits" },
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
              <span>{entry.label}</span>
              <span className="sj-tab-english" lang="en">{entry.english}</span>
            </button>
          ))}
        </nav>
      </header>
      {!props.items.length ? (
        <div className="sj-empty">
          <Shirt size={42} strokeWidth={1} />
          <h2>还没有衣物记录</h2>
          <p>添加衣物、保存搭配后，在这里查看配色和穿搭分析。</p>
          <Link className="sj-button" to="/">
            添加衣物 <ArrowRight size={16} />
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
    </main>
  );
}
