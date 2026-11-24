import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { BestMatch, WardrobeItem } from '../types';
import type { AnalysisRun } from '../lib/aestheticAnalysisV3';
import { buildJournalInspiration } from '../lib/journalInspiration';
import { JournalLink, JournalOutfitLink, JournalSelect } from './JournalControls';
import { WardrobeItemCard } from './WardrobeItemCard';
import './JournalInspiration.css';

type Props = { items: WardrobeItem[]; matches: BestMatch[]; run: AnalysisRun; preferredMatchId?: string };

export function JournalInspiration({ items, matches, run, preferredMatchId }: Props) {
  const [params, setParams] = useSearchParams();
  const ideas = useMemo(() => buildJournalInspiration(items, matches, run, preferredMatchId), [items, matches, run, preferredMatchId]);
  const selected = ideas.find((entry) => entry.id === params.get('idea')) || ideas[0];
  const showingOriginal = params.get('compare') === 'original';
  const choose = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === 'idea') next.delete('compare');
    setParams(next, { replace: true });
  };
  if (!selected) return (
    <section className="sj-inspiration" aria-labelledby="sj-inspiration-title">
      <h2 id="sj-inspiration-title">换一件试试</h2>
      <p className="sj-inspiration-empty">暂无可比较的替换。可以先给搭配添加备选。</p>
    </section>
  );
  return (
    <section className="sj-inspiration" aria-labelledby="sj-inspiration-title">
      <div className="sj-section-heading">
        <div>
          <h2 id="sj-inspiration-title">换一件试试</h2>
        </div>
        {ideas.length > 1 && <JournalSelect label="选择替换" name="对比单品" value={selected.id} options={ideas.map(entry => ({ value: entry.id, label: `${entry.match.name || '我的搭配'} · 换上${entry.to.name}` }))} onChange={value => choose('idea', value)} />}
      </div>
      <div className="sj-inspiration-context">
        <h3>「{selected.match.name || '我的搭配'}」换上「{selected.to.name}」</h3>
        <p>{selected.description}</p>
      </div>
      <div className="sj-inspiration-toggle sj-filters" aria-label="对比替换前后">
        <button aria-pressed={showingOriginal} onClick={() => choose('compare', 'original')}>原单品</button>
        <button aria-pressed={!showingOriginal} onClick={() => choose('compare', 'replacement')}>{selected.kind === 'new' ? '换成这件' : '已存备选'}</button>
      </div>
      <div className={`sj-inspiration-grid masonry-grid ${showingOriginal ? 'is-original' : 'is-replacement'}`}>
        {[{ item: selected.from, label: '原单品', side: 'original' }, { item: selected.to, label: selected.kind === 'new' ? '换成这件' : '已存备选', side: 'replacement' }].map(({ item, label, side }) => (
          <figure className={`sj-inspiration-garment sj-inspiration-${side}`} key={side}>
            <figcaption>{label}</figcaption>
            <JournalLink className="sj-item-link" to={`/item/${item.id}`} aria-label={`查看单品：${item.name}`}>
              <WardrobeItemCard item={item} index={0} eager={false} onCardClick={() => {}} />
            </JournalLink>
          </figure>
        ))}
        <aside className="sj-inspiration-source">
          <p>原搭配</p>
          <JournalOutfitLink match={selected.match} items={items} />
        </aside>
      </div>
    </section>
  );
}
