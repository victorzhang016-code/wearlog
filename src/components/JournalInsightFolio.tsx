import { useMemo } from 'react';
import type { BestMatch, WardrobeItem } from '../types';
import type { StyleInsight } from '../lib/styleInsights';
import { bundleEntriesFromMatch } from '../contexts/BestMatchContext';
import { JournalLink } from './JournalControls';
import { TagBundle } from './TagBundle';
import './JournalInsightFolio.css';

function OutfitEvidence({ match, items, quote }: {
  match: BestMatch; items: WardrobeItem[]; quote?: string;
}) {
  const entries = useMemo(() => bundleEntriesFromMatch(match, new Map(items.map(item => [item.id, item]))), [match, items]);
  // A cover for the saved outfit, not a second inventory. The full outfit is
  // one click away; the caption explicitly states how much of it is shown.
  const upper = entries.find(entry => entry.item.id === match.items.tops[0]?.primary);
  const lower = entries.find(entry => entry.item.id === match.items.bottoms[0]?.primary);
  const cover = upper && lower ? [upper, lower] : entries.slice(0, 2);
  return <div className="sj-folio-outfit"><JournalLink className="sj-folio-cover" to={`/best-match/${match.id}`} aria-label={`查看搭配：${match.name || '我的搭配'}`}>
    <div className="sj-folio-portrait" data-pieces={cover.length}>
      {cover.map((entry, index) => <div className={`sj-folio-piece sj-folio-piece--${index === 0 ? 'upper' : 'lower'}`} key={entry.item.id}>
        {index === 0 && <div className="sj-folio-piece-large"><TagBundle entries={[entry]} size="detail" variant="stacked" /></div>}
        <div className="sj-folio-piece-small"><TagBundle entries={[entry]} size="mini" variant="stacked" /></div>
      </div>)}
    </div>
    <div className="sj-folio-outfit-caption">
      <h4>{match.name || '我的搭配'}</h4>
      <p className="sj-folio-inventory">{upper && lower ? '上装与下装' : `${cover.length} 件单品`}{entries.length > cover.length ? ` · 全套共 ${entries.length} 件` : ''}</p>
    </div>
  </JournalLink>{quote && <blockquote>“{quote}”</blockquote>}</div>;
}

/** One observation and its source outfits form a single open archive spread. */
export function JournalInsightFolio({ selected, stories, examples, items, onChoose }: {
  selected: StyleInsight; stories: StyleInsight[]; examples: BestMatch[];
  items: WardrobeItem[]; onChoose: (id: string) => void;
}) {
  return <article className="sj-insight-folio">
    <div className="sj-folio-page">
      {stories.length > 1 && <label className="sj-select-label sj-folio-selector">
        穿搭观察
        <select value={selected.id} onChange={event => onChoose(event.target.value)}>
          {stories.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}
        </select>
      </label>}
      <div className="sj-folio-reading">
        <h3>{selected.title}</h3>
        <p className="sj-folio-conclusion">{selected.summary}</p>
        {selected.observation && <p className="sj-structure-observation">
          {selected.observation.total} 套{selected.observation.label}中，{selected.observation.support} 套采用这一组合。
        </p>}
        {selected.source === 'ai' && <p className="sj-ai-suggestion">{selected.suggestion}</p>}
      </div>
      <div className="sj-folio-colophon">
        <p>{selected.source === 'ai' ? 'AI 解读' : selected.source === 'computed' ? '搭配统计' : '记录整理'} · {selected.matchIds.length} 套搭配</p>
        {selected.source === 'computed' && <p>只比较上下装宽窄已确认、且各有一件主件的记录。实穿比例仍需试穿判断。</p>}
        <p>点选吊牌，查看完整搭配。</p>
      </div>
    </div>
    <div className="sj-folio-evidence">
      <p className="sj-folio-evidence-heading">你留下的搭配记录{examples.length > 1 && <span className="sj-folio-swipe"> · 左右滑动比较</span>}</p>
      <div className="sj-folio-outfits" data-count={examples.length} data-journal-scroll="insight-examples" tabIndex={0} role="region" aria-label="支持这条观察的搭配记录">
        {examples.map(match => <OutfitEvidence key={match.id} match={match} items={items} quote={selected.quotes.find(quote => quote.matchId === match.id)?.text} />)}
      </div>
    </div>
  </article>;
}
