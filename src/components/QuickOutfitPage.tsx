import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, RotateCcw, Shirt, ThumbsDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useBestMatches } from '../contexts/BestMatchContext';
import { useWardrobe } from '../contexts/WardrobeContext';
import {
  buildLiveAestheticRun,
  liveAestheticSnapshot,
  saveQuickWearRecord,
  saveRecommendationRejection,
  type QuickOutfitOption,
} from '../lib/aestheticProduct';
import { buildOutfitRecommendations, type OutfitRecommendation } from '../lib/aestheticRecommendation';
import type { AnalysisRun } from '../lib/aestheticAnalysisV3';
import { listVisionAnalyses, type VisionAnalysis } from '../lib/aestheticVision';
import { recordRecommendationEvent } from '../lib/recommendationApi';
import { resolveMediaUrl } from '../lib/media';
import { loadSyncedAestheticRun } from '../lib/aestheticRunSync';

const SLOT_LABELS = { tops: '上装', bottoms: '下装', shoes: '鞋', accessories: '配饰' } as const;

function toQuickOption(recommendation: OutfitRecommendation, matches: ReturnType<typeof useBestMatches>['matches'], items: ReturnType<typeof useWardrobe>['items']): QuickOutfitOption | null {
  const sourceMatch = matches.find((match) => match.id === recommendation.sourceMatchId);
  const anchorItem = items.find((item) => item.id === recommendation.anchorItemId);
  if (!sourceMatch || !anchorItem) return null;
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const selections = recommendation.selections.flatMap((selection) => {
    const item = itemMap.get(selection.itemId);
    if (!item) return [];
    return [{ slot: selection.slot, index: selection.index, item, replacedItem: selection.itemId === recommendation.candidateItemId && recommendation.replacedItemId ? itemMap.get(recommendation.replacedItemId) : undefined }];
  });
  return {
    id: recommendation.id,
    sourceMatch,
    anchorItem,
    kind: recommendation.kind === 'new' ? 'suggested_candidate' : recommendation.changedSlot ? 'confirmed_variant' : 'confirmed_match',
    selections,
    replacedSlot: recommendation.changedSlot,
    replacedItem: recommendation.replacedItemId ? itemMap.get(recommendation.replacedItemId) : undefined,
    candidateItem: recommendation.candidateItemId ? itemMap.get(recommendation.candidateItemId) : undefined,
    opportunityId: recommendation.opportunityId,
  };
}

export function QuickOutfitPage() {
  const { itemId = '' } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { items, loading: itemLoading } = useWardrobe();
  const { matches, loading: matchLoading } = useBestMatches();
  const [analyses, setAnalyses] = useState<VisionAnalysis[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<OutfitRecommendation | null>(null);
  const [rejecting, setRejecting] = useState<OutfitRecommendation | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newIndex, setNewIndex] = useState(0);
  const [syncedRun, setSyncedRun] = useState<AnalysisRun | null>(null);
  const [syncLoading, setSyncLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listVisionAnalyses().then((next) => { if (alive) setAnalyses(next); }).catch(() => {
      if (alive) setError('搭配说明暂时没能读取；已确认搭配仍然可以使用。');
    }).finally(() => { if (alive) setAnalysisLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    loadSyncedAestheticRun().then((next) => { if (alive) setSyncedRun(next); }).catch(() => {
      // Fall back to the live deterministic run if the optional snapshot is unavailable.
    }).finally(() => { if (alive) setSyncLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setNewIndex(0);
    setSelected(null);
    setRejecting(null);
    setRejectReason('');
  }, [itemId]);

  const anchor = items.find((item) => item.id === itemId);
  const generatedRun = useMemo(() => {
    if (!items.length && !matches.length) return null;
    return buildLiveAestheticRun(liveAestheticSnapshot(items, matches, analyses));
  }, [items, matches, analyses]);
  const run = syncedRun || generatedRun;
  const recommendations = useMemo(
    () => buildOutfitRecommendations(itemId, matches, items, run || { opportunities: [] }),
    [itemId, matches, items, run],
  );
  const newRecommendations = recommendations.filter((recommendation) => recommendation.kind === 'new');
  const historyRecommendations = recommendations.filter((recommendation) => recommendation.kind === 'history');
  const primaryRecommendation = newRecommendations[newIndex] || historyRecommendations[0] || null;

  const persistEvent = async (recommendation: OutfitRecommendation, event: Parameters<typeof recordRecommendationEvent>[1], reason?: string) => {
    try {
      await recordRecommendationEvent(recommendation, event, reason);
    } catch {
      setActionError('这次反馈已经记在本机，但线上同步暂时失败；稍后重新登录后可以再试。');
    }
  };

  const choose = (recommendation: OutfitRecommendation) => {
    const record = {
      id: `quick:${Date.now()}:${recommendation.id}`,
      optionId: recommendation.id,
      anchorItemId: itemId,
      matchId: recommendation.sourceMatchId,
      selectedAt: new Date().toISOString(),
      state: 'selected' as const,
      opportunityId: recommendation.opportunityId,
    };
    saveQuickWearRecord(record);
    setSelected(recommendation);
    setActionError('');
    void persistEvent(recommendation, 'selected_for_wear');
  };

  const skip = (recommendation: OutfitRecommendation) => {
    setActionError('');
    void persistEvent(recommendation, 'skipped');
    setNewIndex((index) => Math.min(index + 1, Math.max(newRecommendations.length - 1, 0)));
  };

  const submitRejection = () => {
    if (!rejecting || !rejectReason.trim()) return;
    if (rejecting.opportunityId) saveRecommendationRejection(rejecting.opportunityId, rejectReason);
    setActionError('');
    void persistEvent(rejecting, 'rejected', rejectReason);
    setRejecting(null);
    setRejectReason('');
    setNewIndex((index) => Math.min(index + 1, Math.max(newRecommendations.length - 1, 0)));
  };

  const loading = itemLoading || matchLoading || analysisLoading || syncLoading;
  if (loading) return <div className="grid min-h-[55vh] place-items-center"><div className="text-center text-sm text-graphite/65"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />正在为你找一套值得试的搭配…</div></div>;

  if (!anchor) return <div className="mx-auto max-w-xl py-20 text-center"><h1 className="font-story text-3xl font-semibold">没有找到这件衣服</h1><button type="button" onClick={() => navigate('/')} className="mt-6 min-h-11 bg-ink px-5 text-sm text-white">返回衣柜</button></div>;

  const renderCard = (recommendation: OutfitRecommendation, emphasis = false) => {
    const option = toQuickOption(recommendation, matches, items);
    if (!option) return null;
    const outfit = run?.outfitCases.find((entry) => entry.matchId === recommendation.sourceMatchId);
    const explanations = recommendation.kind === 'new'
      ? recommendation.reasons
      : (outfit?.decisionMechanisms.filter((entry) => entry.role !== 'structural' && entry.status !== 'pending').slice(0, 2).map((entry) => ({ text: `${entry.action}：${entry.effect}`, evidenceIds: entry.evidenceIds })) || []);
    const isSelected = selected?.id === recommendation.id;
    const isRejecting = rejecting?.id === recommendation.id;
    return <article key={recommendation.id} className={`flex min-w-0 flex-col border bg-tag/75 ${isSelected ? 'border-ink' : emphasis ? 'border-stamp/50' : 'border-graphite/20'}`}>
      <div className="grid grid-cols-4 gap-px bg-graphite/10 p-px">
        {option.selections.slice(0, 8).map((selection) => <button type="button" onClick={() => navigate(`/item/${selection.item.id}`)} key={`${selection.slot}:${selection.index}`} className="relative aspect-[3/4] overflow-hidden bg-kraft" title={selection.item.name}>
          {selection.item.imageUrl ? <img src={resolveMediaUrl(selection.item.imageUrl)} alt={selection.item.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center px-1 text-center text-[10px] text-graphite/50">{selection.item.name}</span>}
          {selection.item.id === anchor.id && <span className="absolute bottom-1 left-1 bg-stamp px-1.5 py-0.5 text-[9px] text-white">当前单品</span>}
        </button>)}
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div><span className={`inline-block border px-2 py-1 text-[10px] ${recommendation.kind === 'new' ? 'border-stamp/45 bg-stamp/5 text-stamp' : 'border-ink/35 bg-ink/5 text-ink'}`}>{recommendation.kind === 'new' ? '今天值得试' : '以前这样穿过'}</span><h2 className="mt-2 font-story text-xl font-semibold">{option.sourceMatch.name || '未命名 Best Match'}</h2></div><span className="text-[10px] text-graphite/50">{option.selections.length} 件</span></div>
        <p className="mt-2 text-sm leading-6 text-graphite/75">{recommendation.kind === 'new' ? `沿用「${option.sourceMatch.name || '这套搭配'}」的结构，把${option.replacedItem?.name || '原单品'}换成「${option.candidateItem?.name || '备选单品'}」。这是根据你已经确认过的搭配方式整理出的待尝试组合。` : `来自你的 Best Match。${recommendation.changedSlot && option.replacedItem ? `当前单品在这套搭配中替换「${option.replacedItem.name}」。` : '这件单品本来就在这套搭配里。'}`}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 hairline-t hairline-b py-3 text-xs">
          {option.selections.map((selection) => <div key={`${selection.slot}:${selection.index}`} className="contents"><dt className="text-graphite/50">{SLOT_LABELS[selection.slot]}</dt><dd className="truncate text-right">{selection.item.name}</dd></div>)}
        </dl>
        {explanations.length > 0 && <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-graphite underline decoration-graphite/25 underline-offset-4">为什么这样搭</summary>
          <div className="mt-3 space-y-2">{explanations.map((entry, index) => <div key={`${entry.text}:${index}`} className="border-l-2 border-stamp/40 pl-3"><p className="leading-6 text-graphite/75">{entry.text}</p></div>)}</div>
        </details>}
        {isRejecting && <div className="mt-4 border-t border-graphite/15 pt-4"><label className="text-xs text-graphite/65" htmlFor={`reject-${recommendation.id}`}>哪里不合适？这条只会影响当前这组搭配。</label><textarea id={`reject-${recommendation.id}`} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} className="mt-2 w-full border border-graphite/25 bg-white/50 p-2 text-sm outline-none focus:border-ink" placeholder="例如：下装的量感压住了上装…" /><div className="mt-2 flex gap-2"><button type="button" onClick={submitRejection} disabled={!rejectReason.trim()} className="min-h-10 bg-ink px-3 text-sm text-white disabled:bg-graphite">记下不合适</button><button type="button" onClick={() => { setRejecting(null); setRejectReason(''); }} className="min-h-10 border border-graphite/25 px-3 text-sm">取消</button></div></div>}
        {!isRejecting && <div className="mt-auto flex flex-wrap gap-2 pt-5"><button type="button" disabled={isSelected} onClick={() => choose(recommendation)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 bg-ink px-4 text-sm text-white disabled:bg-graphite"><Check className="h-4 w-4" />{isSelected ? '已记下' : '今天穿这套'}</button>{recommendation.kind === 'new' && <button type="button" onClick={() => setRejecting(recommendation)} className="inline-flex min-h-11 items-center justify-center gap-2 border border-graphite/25 px-3 text-sm"><ThumbsDown className="h-4 w-4" />不太合适</button>}</div>}
      </div>
    </article>;
  };

  return (
    <section className="mx-auto max-w-6xl pb-12">
      <button type="button" onClick={() => navigate(`/item/${anchor.id}`)} className="back-link"><ArrowLeft className="h-4 w-4" />返回单品</button>

      <header className="mt-3 grid gap-5 hairline-b pb-6 md:grid-cols-[112px_minmax(0,1fr)] md:items-end">
        <div className="aspect-[3/4] overflow-hidden border border-graphite/15 bg-tag">
          {anchor.imageUrl ? <img src={resolveMediaUrl(anchor.imageUrl)} alt={anchor.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Shirt className="h-6 w-6 text-graphite/35" /></div>}
        </div>
        <div>
          <p className="font-tag text-[10px] uppercase tracking-[0.24em] text-stamp">Quick outfit</p>
          <h1 className="mt-2 font-story text-3xl font-semibold leading-tight sm:text-4xl">先看一套值得试的</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-graphite/70">从「{anchor.name}」出发，保留你已经建立的搭配骨架，只换一个位置，给你一个有依据的新方向。</p>
        </div>
      </header>

      {error && <p className="mt-5 border-l-2 border-stamp pl-3 text-sm leading-6 text-stamp">{error}</p>}
      {actionError && <p className="mt-5 border-l-2 border-stamp pl-3 text-sm leading-6 text-stamp">{actionError}</p>}

      {selected && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-ink/25 bg-tag p-4 text-ink"><div><p className="font-medium">已经记下：今天穿「{matches.find((match) => match.id === selected.sourceMatchId)?.name || '这套搭配'}」</p><p className="mt-1 text-sm">之后可以在风格志里补充实际效果，它会帮助校准这套搭配。</p></div><button type="button" onClick={() => setSelected(null)} className="inline-flex min-h-10 items-center gap-2 border border-graphite/30 px-3 text-sm"><RotateCcw className="h-4 w-4" />继续看</button></div>}

      {primaryRecommendation ? <>
        <div className="mt-6 flex items-end justify-between gap-4"><div><p className="font-tag text-[10px] uppercase tracking-[0.2em] text-stamp">{primaryRecommendation.kind === 'new' ? 'A suggestion for today' : 'A reference from your wardrobe'}</p><h2 className="mt-1 font-story text-2xl font-semibold">{primaryRecommendation.kind === 'new' ? '这套搭配，值得试一次' : '先从你穿过的搭配开始'}</h2></div>{primaryRecommendation.kind === 'new' && newIndex < newRecommendations.length - 1 && <button type="button" onClick={() => skip(primaryRecommendation)} className="inline-flex min-h-10 items-center gap-2 border border-graphite/25 px-3 text-sm"><RotateCcw className="h-4 w-4" />换一套</button>}</div>
        <div className="mt-4 max-w-3xl">{renderCard(primaryRecommendation, true)}</div>
      </> : <div className="mt-8 border border-graphite/20 bg-tag/55 px-5 py-10 text-center"><h2 className="font-story text-2xl font-semibold">这件衣服还没有足够的搭配依据</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-graphite/70">先记录一套 Best Match，之后系统才能从你的真实选择里找到值得尝试的方向。</p><button type="button" onClick={() => navigate('/best-match/new')} className="mt-5 min-h-11 bg-ink px-5 text-sm text-white">建立 Best Match</button></div>}

      {historyRecommendations.length > 0 && <section className="mt-10"><div className="hairline-b pb-3"><p className="font-tag text-[10px] uppercase tracking-[0.2em] text-graphite/50">Your references</p><h2 className="mt-1 font-story text-2xl font-semibold">以前这样穿过</h2><p className="mt-1 text-sm text-graphite/65">这些是你已经保存过的稳妥参考。</p></div><div className="mt-4 grid gap-4 lg:grid-cols-3">{historyRecommendations.map((recommendation) => renderCard(recommendation))}</div></section>}
    </section>
  );
}
