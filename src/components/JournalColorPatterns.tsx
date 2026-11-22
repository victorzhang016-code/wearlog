import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { BestMatch } from "../types";
import type { PerceptualColor } from "../lib/aestheticAnalysisV3";
import { COLOR_ROLE_LABELS } from "../lib/styleJournalView";
import {
  journalPaletteAnalysis,
  type JournalPaletteCase,
  type PaletteSample,
} from "../lib/journalPaletteAnalysis";
import { ColorSwatchCard } from "./ColorSwatchCard";

export const swatchRGB = (color: PerceptualColor) => ({
  r: color.rgb[0],
  g: color.rgb[1],
  b: color.rgb[2],
});

function PaletteSamples({ samples }: { samples: PaletteSample[] }) {
  const unique = [
    ...new Map(
      samples.map((sample) => [
        `${sample.slot}:${sample.color.hex}:${sample.color.role}`,
        sample,
      ]),
    ).values(),
  ];
  return (
    <div className="sj-palette-comparison" aria-label="搭配色卡">
      {unique.map((sample) => (
        <ColorSwatchCard
          key={`${sample.slot}:${sample.color.hex}:${sample.color.role}`}
          color={swatchRGB(sample.color)}
          code={sample.color.hex}
          role={`${sample.slot} · ${COLOR_ROLE_LABELS[sample.color.role]}`}
        />
      ))}
    </div>
  );
}

function PaletteCase({ entry }: { entry: JournalPaletteCase }) {
  const isMainGarment = (sample: PaletteSample) =>
    sample.color.role === "dominant" && sample.slot !== "配饰";
  const details = entry.samples.filter((s) => !isMainGarment(s));
  return (
    <div className="sj-palette-case">
      <div className="sj-palette-case-heading">
        <h4>{entry.match.name || "我的搭配"}</h4>
        <Link to={`/best-match/${entry.match.id}`}>
          查看搭配 <ArrowRight size={16} />
        </Link>
      </div>
      <PaletteSamples samples={entry.samples.filter(isMainGarment)} />
      {!!details.length && (
        <details className="sj-palette-detail">
          <summary>
            查看配饰、辅色与点缀色 <ChevronDown size={16} />
          </summary>
          <PaletteSamples samples={details} />
        </details>
      )}
      {entry.confirmedItems < entry.totalItems && (
        <p className="sj-caption">
          已确认 {entry.confirmedItems} / {entry.totalItems}{" "}
          件单品的颜色，其余未计入色卡。
        </p>
      )}
    </div>
  );
}

export function JournalColorPatterns({
  analysis,
  matches,
}: {
  analysis: ReturnType<typeof journalPaletteAnalysis>;
  matches: BestMatch[];
}) {
  const [allGroups, setAllGroups] = useState(false);
  const repeated = analysis.groups
    .filter((group) => !group.neutralOnly && group.cases.length >= 2)
    .slice(0, 3);
  const featured = repeated.length ? repeated : analysis.groups.slice(0, 3);
  const displayed = allGroups ? analysis.groups : featured;
  return (
    <>
      <section aria-labelledby="sj-choice-title">
        <div className="sj-section-heading">
          <div>
            <h2 id="sj-choice-title">黑白灰之外的选择</h2>
            <p>看看你把哪些颜色留在了衣柜里。</p>
          </div>
        </div>
        {analysis.choices.length ? (
          <div className="sj-color-preferences">
            {analysis.choices.slice(0, 3).map((choice) => (
              <figure key={choice.family}>
                <ColorSwatchCard
                  color={swatchRGB(choice.color)}
                  role={`${choice.family}色`}
                  code={`${choice.itemIds.length} 件衣物`}
                />
                <figcaption>
                  <h3>
                    {choice.family}色
                    {choice.dominant > Math.max(choice.secondary, choice.accent)
                      ? "更多作主色"
                      : choice.accent >
                          Math.max(choice.dominant, choice.secondary)
                        ? "更多作点缀"
                        : choice.secondary >
                            Math.max(choice.dominant, choice.accent)
                          ? "更多作辅色"
                          : "的使用"}
                  </h3>
                  <p>
                    {[
                      choice.dominant && `${choice.dominant} 件用作主色`,
                      choice.secondary && `${choice.secondary} 件带有辅色`,
                      choice.accent && `${choice.accent} 件用作点缀`,
                    ]
                      .filter(Boolean)
                      .join("，")}
                    。
                  </p>
                  <span className="sj-caption">
                    {choice.categories
                      .map((c) => `${c.name} ${c.count} 件`)
                      .join(" · ")}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="sj-caption">
            已确认的衣物颜色以黑白灰为主。更多颜色确认后会补充在这里。
          </p>
        )}
        {!!analysis.choices.length && (
          <p className="sj-color-method">
            颜色角色按单品记录统计，同一件可以包含多个角色。
          </p>
        )}
      </section>

      {!!analysis.pairings.length && (
        <section aria-labelledby="sj-pair-title">
          <div className="sj-section-heading">
            <div>
              <h2 id="sj-pair-title">你搭在一起的颜色</h2>
              <p>从已保存的搭配中，查看上装与下装、鞋的主色关系。</p>
            </div>
          </div>
          <div className="sj-color-relations">
            {analysis.pairings.slice(0, 3).map((pair) => (
              <article key={pair.id}>
                <div className="sj-color-duet">
                  <ColorSwatchCard
                    color={swatchRGB(pair.fromColor)}
                    role={`${pair.from}色上装`}
                    code={pair.fromColor.hex}
                  />
                  <span aria-hidden="true">＋</span>
                  <ColorSwatchCard
                    color={swatchRGB(pair.toColor)}
                    role={`${pair.to}色${pair.slot === "bottoms" ? "下装" : "鞋"}`}
                    code={pair.toColor.hex}
                  />
                </div>
                <div>
                  <h3>
                    {pair.from}色上装配{pair.to}色
                    {pair.slot === "bottoms" ? "下装" : "鞋"}
                  </h3>
                  <p>
                    {pair.total} 套可比较的{pair.from}色上装搭配中，{pair.count}{" "}
                    套这样选。
                  </p>
                  <details className="sj-palette-detail">
                    <summary>
                      查看 {pair.count} 套记录 <ChevronDown size={16} />
                    </summary>
                    <div className="sj-case-links">
                      {pair.matchIds.map((id) => (
                        <Link key={id} to={`/best-match/${id}`}>
                          {matches.find((m) => m.id === id)?.name || "我的搭配"}
                          <ArrowRight size={14} />
                        </Link>
                      ))}
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="sj-group-title">
        <div className="sj-section-heading">
          <div>
            <h2 id="sj-group-title">相似配色，放在一起看</h2>
            <p>按上装、下装和鞋的主色归类，黑白灰合为基础色。</p>
          </div>
          <span className="sj-caption">
            {analysis.cases.length} / {analysis.totalMatches} 套颜色可比较
          </span>
        </div>
        {analysis.groups.length ? (
          <div className="sj-palette-groups">
            {displayed.map((group) => (
              <article className="sj-palette-group" key={group.id}>
                <div className="sj-palette-group-heading">
                  <h3>{group.title}</h3>
                  <span>{group.cases.length} 套</span>
                </div>
                <PaletteCase entry={group.cases[0]} />
                {group.cases.length > 1 && (
                  <details className="sj-palette-detail sj-group-compare">
                    <summary>
                      对比同组其余 {group.cases.length - 1} 套色卡{" "}
                      <ChevronDown size={16} />
                    </summary>
                    {group.cases.slice(1).map((entry) => (
                      <PaletteCase key={entry.match.id} entry={entry} />
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="sj-caption">
            确认搭配中上装、下装和鞋的主色后，就能按配色归类。
          </p>
        )}
        {analysis.groups.length > featured.length && (
          <button className="sj-more" onClick={() => setAllGroups((v) => !v)}>
            {allGroups
              ? "收起配色分组"
              : `查看其他 ${analysis.groups.length - featured.length} 组配色`}
            <ChevronDown size={16} />
          </button>
        )}
        <details className="sj-palette-detail sj-counting-note">
          <summary>
            这些统计怎么计算 <ChevronDown size={16} />
          </summary>
          <p>
            只使用当前衣物已确认的颜色。每套搭配计一次，不展开备选单品；主件缺失或上装、下装、鞋的主色未确认时，不计入可比较的搭配。
          </p>
          <p>
            配色关系以每套第一件上装对照下装或鞋，同一条关系在一套里最多计一次。配饰不参与关系计数；相似分组只比较衣物和鞋的主色位置，辅色、点缀色和配饰保留在每套色卡中。
          </p>
          <p>
            这里呈现保存记录中的选择，不代表实际穿着频率或搭配效果。单品颜色角色不代表整套穿搭的颜色面积。色卡保留原始颜色，同色系不代表颜色完全相同。
          </p>
        </details>
      </section>
    </>
  );
}
