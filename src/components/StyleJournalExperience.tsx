import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  Shirt,
} from "lucide-react";
import type { BestMatch, WardrobeItem } from "../types";
import type { AnalysisRun, PerceptualColor } from "../lib/aestheticAnalysisV3";
import {
  buildStyleInsights,
  styleEvidence,
  type StyleInsight,
} from "../lib/styleInsights";
import { requestStyleInsights } from "../lib/requestStyleInsights";
import { ColorSwatchFan } from "./ColorSwatchCard";
import { JournalLink as Link, JournalOutfitLink, useJournalReadingPosition } from "./JournalControls";
import { JournalInspiration } from "./JournalInspiration";
import { JournalInsightFolio } from "./JournalInsightFolio";
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

function PaletteChapter({
  items,
  matches,
  colors,
}: Pick<Props, "items" | "matches" | "colors">) {
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
  if (!paletteAnalysis.families.length)
    return (
      <div className="sj-empty">
        <h2>先确认衣物颜色</h2>
        <p>在单品详情里确认颜色后，你的色卡会在这里按色系整理。</p>
        <Link to="/" className="sj-button">去衣柜确认颜色</Link>
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
    </div>
  );
}

type InsightSession = { fingerprint: string; insights: StyleInsight[] };
// Retain the current analysis when visiting a source record, only in this tab.
let currentInsightSession: InsightSession | undefined;
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
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  const activeRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    latestParams.current = params;
  }, [params]);
  useEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);
  const selectedId = params.get("insight");
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
  const examples = ids.flatMap((id) => {
    const match = matches.find((entry) => entry.id === id);
    return match ? [match] : [];
  }).slice(0, 2);
  function chooseInsight(id: string) {
    const next = new URLSearchParams(latestParams.current);
    next.set("insight", id);
    next.delete("idea");
    setParams(next, { replace: true });
  }
  async function analyze() {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    // Page exit animations briefly keep the old route mounted. Check the
    // browser URL as well so a result cannot pull a departing reader back.
    const isCurrent = () => activeRequest.current === controller
      && !controller.signal.aborted
      && window.location.pathname === "/aesthetic"
      && new URLSearchParams(window.location.search).get("view") === "outfits";
    setBusy(true);
    setNotice("");
    try {
      const result = await requestStyleInsights(evidence, controller.signal);
      if (!isCurrent()) return;
      onGenerated({ fingerprint, insights: result.insights });
      chooseInsight("");
      if (!result.insights.length)
        setNotice("暂时没有找到有充分记录支持的新结论，已有观察仍保留。");
    } catch (error) {
      if (!isCurrent()) return;
      setNotice(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "分析时间较长，请稍后重试。",
      );
    } finally {
      const current = isCurrent();
      if (activeRequest.current === controller) activeRequest.current = null;
      if (current) setBusy(false);
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
        {selected && examples.length ? (
          <JournalInsightFolio
            selected={selected}
            stories={stories}
            examples={examples}
            items={items}
            onChoose={chooseInsight}
          />
        ) : (
          <div className="sj-empty">
            <h3>{matches.length ? "还需要一些穿搭说明" : "先保存一套搭配"}</h3>
            <p>记录为什么这样穿、试过哪些调整，才能进一步分析你的偏好。</p>
            {matches.length ? (
              <div className="sj-empty-outfits">
                {matches.slice(0, 2).map((entry) => <JournalOutfitLink key={entry.id} match={entry} items={items} />)}
              </div>
            ) : (
              <Link
                className="sj-button"
                to={items.length >= 3 ? "/best-match/new" : "/"}
              >
                记录搭配
              </Link>
            )}
          </div>
        )}
      </section>
      {matches.length > 0 && <JournalInspiration items={items} matches={matches} run={run} preferredMatchId={examples[0]?.id} />}
    </div>
  );
}

export function StyleJournalExperience(props: Props) {
  useJournalReadingPosition();
  const [generated, setGenerated] = useState<InsightSession | undefined>(currentInsightSession);
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
            添加衣物
          </Link>
        </div>
      ) : tab === "colors" ? (
        <PaletteChapter {...props} />
      ) : (
        <OutfitChapter
          {...props}
          generated={generated}
          onGenerated={(session) => { currentInsightSession = session; setGenerated(session); }}
        />
      )}
    </main>
  );
}
