import { useSearchParams } from "react-router";
import type { BestMatch } from "../types";
import type { PerceptualColor } from "../lib/aestheticAnalysisV3";
import {
  journalPaletteAnalysis,
  type JournalPaletteCase,
  type PaletteSample,
} from "../lib/journalPaletteAnalysis";
import { JournalLink } from "./JournalControls";
import { ColorSwatchCard } from "./ColorSwatchCard";
import "./JournalColorPatterns.css";

export const swatchRGB = (color: PerceptualColor) => ({
  r: color.rgb[0],
  g: color.rgb[1],
  b: color.rgb[2],
});

function PaletteSamples({ samples }: { samples: PaletteSample[] }) {
  return (
    <div className="jcp-samples" aria-label="上装、下装和鞋的主色色卡">
      {["上装", "下装", "鞋"].map((slot) => {
        // A slot is one comparison column. Repeated HEX values share a sample,
        // but retain every garment source; no averaging or area inference.
        const colors = new Map<string, { color: PerceptualColor; sources: Set<string> }>();
        samples.filter((sample) => sample.slot === slot).forEach((sample) => {
          const key = sample.color.hex.toUpperCase();
          const entry = colors.get(key) || { color: sample.color, sources: new Set<string>() };
          entry.sources.add(`${sample.itemName} · ${sample.color.hex}`);
          colors.set(key, entry);
        });
        const columns = Math.ceil(Math.sqrt(colors.size || 1));
        return (
          <div key={slot} className="jcp-slot-card">
            <div className="jcp-slot-face" aria-label={`${slot}：${colors.size ? `${colors.size} 种主色` : "未搭配"}`}>
              {colors.size ? [...colors.entries()].map(([hex, entry]) => (
                <span
                  key={hex}
                  className="jcp-color-sample"
                  style={{
                    backgroundColor: `rgb(${entry.color.rgb.join(",")})`,
                    flexBasis: `calc((100% - ${(columns - 1) * 3}px) / ${columns})`,
                  }}
                  title={[...entry.sources].join("\n")}
                  aria-label={[...entry.sources].join("；")}
                />
              )) : <span className="jcp-empty-slot">未搭配{slot}</span>}
            </div>
            <div className="jcp-slot-caption">
              <span>{slot}</span>
              {!!colors.size && <span>{colors.size} 色</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaletteCase({ entry }: { entry: JournalPaletteCase }) {
  const samples = entry.samples.filter((sample) =>
    sample.color.role === "dominant" && sample.slot !== "配饰",
  );
  return (
    <JournalLink
      className="jcp-palette-look"
      to={`/best-match/${entry.match.id}`}
      aria-label={`查看搭配：${entry.match.name || "我的搭配"}`}
      title={`查看搭配：${entry.match.name || "我的搭配"}`}
    >
      <h3>{entry.match.name || "我的搭配"}</h3>
      <PaletteSamples samples={samples} />
      {entry.confirmedItems < entry.totalItems && (
        <p className="jcp-coverage">
          {entry.totalItems - entry.confirmedItems} 件配饰的颜色尚未确认。
        </p>
      )}
    </JournalLink>
  );
}

type PaletteChoice = ReturnType<typeof journalPaletteAnalysis>["choices"][number];

function choiceDescription(choice: PaletteChoice) {
  const roles = [
    { label: "主色", count: choice.dominant },
    { label: "辅色", count: choice.secondary },
    { label: "点缀", count: choice.accent },
  ].sort((a, b) => b.count - a.count);
  const leading = roles[0];
  if (leading.count > roles[1].count) {
    return {
      title: `${choice.family}色多用作${leading.label}`,
      description: `其中 ${leading.count} 件用作${leading.label}。`,
    };
  }
  const category = choice.categories[0];
  return {
    title: `${choice.family}色有 ${choice.itemIds.length} 件`,
    description: category
      ? `其中 ${category.count} 件是${category.name}。`
      : "按已确认的单品颜色统计。",
  };
}

export function JournalColorPatterns({
  analysis,
}: {
  analysis: ReturnType<typeof journalPaletteAnalysis>;
  matches: BestMatch[];
}) {
  const [params, setParams] = useSearchParams();
  const defaultGroup = analysis.groups.find((group) => !group.neutralOnly && group.cases.length >= 2)
    || analysis.groups.find((group) => !group.neutralOnly)
    || analysis.groups[0];
  const selectedGroup = analysis.groups.find((group) => group.id === params.get("paletteGroup"))
    || defaultGroup;
  const excludedCount = analysis.totalMatches - analysis.cases.length;

  return (
    <>
      <section className="jcp-section" aria-labelledby="sj-choice-title">
        <div className="sj-section-heading">
          <h2 id="sj-choice-title">黑白灰之外的选择</h2>
        </div>
        {analysis.choices.length ? (
          <div className="jcp-choices">
            {analysis.choices.slice(0, 3).map((choice, index) => {
              const copy = choiceDescription(choice);
              return (
                <figure key={choice.family} className={index === 0 ? "jcp-choice-main" : "jcp-choice-support"}>
                  <ColorSwatchCard
                    className="jcp-swatch"
                    color={swatchRGB(choice.color)}
                    role={`${choice.family}色衣物`}
                    code={`${choice.itemIds.length} 件`}
                  />
                  <figcaption>
                    <h3>{copy.title}</h3>
                    <p>{copy.description}</p>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : (
          <p className="jcp-note">目前已确认的颜色以黑白灰为主。</p>
        )}
      </section>

      {!!analysis.pairings.length && (
        <section className="jcp-section" aria-labelledby="sj-pair-title">
          <div className="sj-section-heading">
            <h2 id="sj-pair-title">你搭在一起的颜色</h2>
          </div>
          <div className="jcp-pairings">
            {analysis.pairings.slice(0, 3).map((pair, index) => (
              <article key={pair.id}>
                <div className="jcp-duet">
                  <ColorSwatchCard className="jcp-swatch" color={swatchRGB(pair.fromColor)} role="上装" code={`${pair.from}色`} />
                  <ColorSwatchCard className="jcp-swatch" color={swatchRGB(pair.toColor)} role={pair.slot === "bottoms" ? "下装" : "鞋"} code={`${pair.to}色`} />
                </div>
                <div className="jcp-pair-copy">
                  {index === 0 && <h3>{pair.from}色上装配{pair.to}色{pair.slot === "bottoms" ? "下装" : "鞋"}</h3>}
                  <p>{pair.total} 套{pair.from}色上装搭配中，{pair.count} 套配{pair.to}色{pair.slot === "bottoms" ? "下装" : "鞋"}。</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="jcp-section" aria-labelledby="sj-group-title">
        <div className="sj-section-heading">
          <div>
            <h2 id="sj-group-title">相似配色，放在一起看</h2>
            <p>按主色的位置归类，保留实际色差。点选色卡查看搭配。</p>
          </div>
        </div>
        {selectedGroup ? (
          <>
            <div className="jcp-group-control">
              <label htmlFor="journal-palette-group">配色分组</label>
              <select
                id="journal-palette-group"
                value={selectedGroup.id}
                onChange={(event) => {
                  const next = new URLSearchParams(params);
                  next.set("paletteGroup", event.target.value);
                  setParams(next, { replace: true });
                }}
              >
                {analysis.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.title} · {group.cases.length} 套</option>
                ))}
              </select>
            </div>
            <div className="jcp-palette-grid" aria-label={`${selectedGroup.title}，${selectedGroup.cases.length} 套搭配`}>
              {selectedGroup.cases.map((entry) => <PaletteCase key={entry.match.id} entry={entry} />)}
            </div>
          </>
        ) : (
          <p className="jcp-note">确认上装、下装和鞋的主色后，搭配就会出现在这里。</p>
        )}
        <div className="jcp-method">
          <p>
            {analysis.totalMatches} 套已保存搭配中，{analysis.cases.length} 套的主件和主色完整，可作比较。
            {excludedCount > 0 && `另有 ${excludedCount} 套因主件缺失或主色未确认，暂未计入。`}
          </p>
          <p>配对统计以第一件上装对照下装或鞋，每套计一次；色卡保留所有上装、下装和鞋的主色，同一位置的相同颜色合并，黑白灰合为基础色归类。方形色样等大拼合，不表示颜色面积。这里不包含备选、配饰、辅色和点缀色，也不代表实际穿着频率。</p>
        </div>
      </section>
    </>
  );
}
