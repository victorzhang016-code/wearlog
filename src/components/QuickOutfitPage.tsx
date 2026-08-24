import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, RotateCcw, Shirt, ThumbsDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useBestMatches } from '../contexts/BestMatchContext';
import { useWardrobe } from '../contexts/WardrobeContext';
import {
  buildLiveAestheticRun,
  liveAestheticSnapshot,
  listRecommendationFeedback,
  saveQuickWearRecord,
  saveRecommendationFeedback,
  type QuickOutfitOption,
} from '../lib/aestheticProduct';
import { buildOutfitRecommendations, isPaletteRecommendationRunCurrent, type OutfitRecommendation } from '../lib/aestheticRecommendation';
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
  const [fitFeedback, setFitFeedback] = useState<'suitable' | 'unsuitable' | null>(null);
  const [feedbackVersion, setFeedbackVersion] = useState(0);
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
    setFitFeedback(null);
  }, [itemId]);

  const anchor = items.find((item) => item.id === itemId);
  const feedback = useMemo(() => listRecommendationFeedback(), [feedbackVersion]);
  const resolvedFeedbackKeys = useMemo(() => new Set(feedback.filter((entry) => entry.targetType === 'opportunity').map((entry) => entry.targetId)), [feedback]);
  const generatedRun = useMemo(() => {
    if (!items.length && !matches.length) return null;
    return buildLiveAestheticRun(liveAestheticSnapshot(items, matches, analyses));
  }, [items, matches, analyses, feedbackVersion]);
  // A stored analysis can be useful only when it describes this exact wardrobe
  // snapshot and carries the current source-bound palette contract. Otherwise we
  // deterministically rebuild from the user's confirmed data on this device.
  const run = useMemo(() => (
    syncedRun && generatedRun && isPaletteRecommendationRunCurrent(syncedRun, generatedRun.inputSnapshotHash)
      ? syncedRun
      : generatedRun
  ), [syncedRun, generatedRun]);
  const recommendations = useMemo(
    () => buildOutfitRecommendations(itemId, matches, items, run || { opportunities: [] }, { resolvedKeys: resolvedFeedbackKeys }),
    [itemId, matches, items, run, resolvedFeedbackKeys],
  );
  const newRecommendations = recommendations.filter((recommendation) => recommendation.kind === 'new');
  const historyRecommendations = recommendations.filter((recommendation) => recommendation.kind === 'history');
  const primaryRecommendation = newRecommendations[newIndex] || null;

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

  const markSuitable = (recommendation: OutfitRecommendation) => {
    const targetId = recommendation.opportunityId || recommendation.recommendationKey;
    saveRecommendationFeedback(targetId, '接受');
    setFitFeedback('suitable');
    setActionError('');
    void persistEvent(recommendation, 'marked_suitable');
  };

  const skip = (recommendation: OutfitRecommendation) => {
    setActionError('');
    void persistEvent(recommendation, 'skipped');
    setNewIndex((index) => Math.min(index + 1, Math.max(newRecommendations.length - 1, 0)));
  };

  const submitRejection = () => {
    if (!rejecting || !rejectReason.trim()) return;
    saveRecommendationFeedback(rejecting.opportunityId || rejecting.recommendationKey, '拒绝', rejectReason);
    setActionError('');
    setFitFeedback('unsuitable');
    void persistEvent(rejecting, 'marked_unsuitable', rejectReason);
    setRejecting(null);
    setRejectReason('');
    setFeedbackVersion((version) => version + 1);
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
    const reason = explanations[0]?.text || (recommendation.kind === 'new' ? '这套组合还在等待你的实际反馈。' : '这是你已经保存过的搭配。');
    const compactSelections = option.selections.filter((selection, index, selections) => selection.slot !== 'accessories' || selections.findIndex((entry) => entry.slot === 'accessories') === index).slice(0, 5);
    const isSelected = selected?.id === recommendation.id;
    const isRejecting = rejecting?.id === recommendation.id;
    const isSuitable = recommendation.id === primaryRecommendation?.id && fitFeedback === 'suitable';
    const originLabel = recommendation.origin === 'direct' ? '单品直搭' : recommendation.origin === 'replacement' ? '单槽位替换' : '以前这样穿过';
    const recommendationLabel = recommendation.tier === 'exploration' ? '探索方向' : '稳妥新建议';
    return <article key={recommendation.id} className={`flex min-w-0 flex-col border bg-tag/75 ${isSelected || isSuitable ? 'border-ink' : emphasis ? 'border-stamp/50' : 'border-graphite/20'}`}>
      <div className={`grid gap-px bg-graphite/10 p-px ${compactSelections.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {compactSelections.map((selection) => <button type="button" onClick={() => navigate(`/item/${selection.item.id}`)} key={`${selection.slot}:${selection.index}`} className="relative aspect-[3/4] overflow-hidden bg-kraft" title={selection.item.name}>
          {selection.item.imageUrl ? <img src={resolveMediaUrl(selection.item.imageUrl)} alt={selection.item.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center px-1 text-center text-[10px] text-graphite/50">{selection.item.name}</span>}
          {selection.item.id === anchor.id && <span className="absolute bottom-1 left-1 bg-stamp px-1.5 py-0.5 text-[9px] text-white">当前单品</span>}
        </button>)}
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div><span className={`inline-block border px-2 py-1 text-[10px] ${recommendation.kind === 'new' ? recommendation.tier === 'exploration' ? 'border-orange-600/55 bg-orange-50 text-orange-700' : 'border-stamp/45 bg-stamp/5 text-stamp' : 'border-ink/35 bg-ink/5 text-ink'}`}>{recommendation.kind === 'new' ? `${recommendationLabel} · ${originLabel}` : originLabel}</span><h2 className="mt-2 font-story text-xl font-semibold">{anchor.name}</h2></div><span className="text-[10px] text-graphite/50">{compactSelections.length} 个主要部件</span></div>
        <div className="mt-4 grid gap-2 border-y border-graphite/15 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4"><span className="text-graphite/50">来源</span><strong className="font-medium">{option.sourceMatch.name || '未命名 Best Match'}{recommendation.origin === 'direct' ? ' · 作为直搭骨架' : ''}</strong><span className="text-graphite/50">替换位置</span><strong className="font-medium">{recommendation.changedSlot === 'accessories' && !option.replacedItem ? '配饰 · 点睛加入' : recommendation.changedSlot ? `${SLOT_LABELS[recommendation.changedSlot]} · ${option.replacedItem?.name || '原单品'}` : '完整保留'}</strong></div>
        <p className="mt-4 text-sm leading-6 text-graphite"><span className="font-medium">{recommendation.tier === 'exploration' ? '这次新变量：' : '为什么成立：'}</span>{recommendation.tier === 'exploration' ? recommendation.paletteAssessment?.newVariable || reason : reason}</p>
        {explanations.length > 1 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-graphite underline decoration-graphite/25 underline-offset-4">查看其他依据</summary><div className="mt-3 space-y-2">{explanations.slice(1).map((entry, index) => <div key={`${entry.text}:${index}`} className="border-l-2 border-stamp/40 pl-3"><p className="leading-6 text-graphite/75">{entry.text}</p></div>)}</div></details>}
        {isRejecting && <div className="mt-4 border-t border-graphite/15 pt-4"><label className="text-xs text-graphite/65" htmlFor={`reject-${recommendation.id}`}>哪里不合适？这条反馈会进入下一轮推荐。</label><textarea id={`reject-${recommendation.id}`} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} className="mt-2 w-full border border-graphite/25 bg-white/50 p-2 text-sm outline-none focus:border-ink" placeholder="例如：下装的量感压住了上装…" /><div className="mt-2 flex gap-2"><button type="button" onClick={submitRejection} disabled={!rejectReason.trim()} className="min-h-10 bg-ink px-3 text-sm text-white disabled:bg-graphite">记下不合适</button><button type="button" onClick={() => { setRejecting(null); setRejectReason(''); }} className="min-h-10 border border-graphite/25 px-3 text-sm">取消</button></div></div>}
        {!isRejecting && <div className="mt-auto flex flex-wrap gap-2 pt-5">{recommendation.kind === 'new' && <><button type="button" disabled={isSuitable} onClick={() => markSuitable(recommendation)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 bg-ink px-4 text-sm text-white disabled:bg-graphite"><Check className="h-4 w-4" />{isSuitable ? '已标记合适' : '合适'}</button><button type="button" onClick={() => setRejecting(recommendation)} className="inline-flex min-h-11 items-center justify-center gap-2 border border-graphite/25 px-3 text-sm"><ThumbsDown className="h-4 w-4" />不太合适</button></>}<button type="button" disabled={isSelected} onClick={() => choose(recommendation)} className="inline-flex min-h-11 items-center justify-center gap-2 border border-graphite/25 px-3 text-sm disabled:bg-graphite/15"><Check className="h-4 w-4" />{isSelected ? '已记下今天穿' : '今天穿'}</button></div>}
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
          <h1 className="mt-2 font-story text-3xl font-semibold leading-tight sm:text-4xl">给这件单品找一套完整穿法</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-graphite/70">先看当前单品、来源、替换位置和成立原因；有依据的新组合会一套套出现。</p>
        </div>
      </header>

      {error && <p className="mt-5 border-l-2 border-stamp pl-3 text-sm leading-6 text-stamp">{error}</p>}
      {actionError && <p className="mt-5 border-l-2 border-stamp pl-3 text-sm leading-6 text-stamp">{actionError}</p>}

      {selected && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-ink/25 bg-tag p-4 text-ink"><div><p className="font-medium">已经记下：今天穿「{matches.find((match) => match.id === selected.sourceMatchId)?.name || '这套搭配'}」</p><p className="mt-1 text-sm">之后可以在风格志里补充实际效果，它会帮助校准这套搭配。</p></div><button type="button" onClick={() => setSelected(null)} className="inline-flex min-h-10 items-center gap-2 border border-graphite/30 px-3 text-sm"><RotateCcw className="h-4 w-4" />继续看</button></div>}

      {primaryRecommendation ? <>
        <div className="mt-6 flex items-end justify-between gap-4"><div><p className={`font-tag text-[10px] uppercase tracking-[0.2em] ${primaryRecommendation.tier === 'exploration' ? 'text-orange-700' : 'text-stamp'}`}>{primaryRecommendation.kind === 'new' ? primaryRecommendation.tier === 'exploration' ? 'One controlled exploration' : 'A suggestion for today' : 'A reference from your wardrobe'}</p><h2 className="mt-1 font-story text-2xl font-semibold">{primaryRecommendation.kind === 'new' ? primaryRecommendation.tier === 'exploration' ? '这一套是探索方向，等你来判定' : '这套搭配，值得试一次' : '先从你穿过的搭配开始'}</h2></div>{primaryRecommendation.kind === 'new' && primaryRecommendation.tier !== 'exploration' && newIndex < newRecommendations.length - 1 && <button type="button" onClick={() => skip(primaryRecommendation)} className="inline-flex min-h-10 items-center gap-2 border border-graphite/25 px-3 text-sm"><RotateCcw className="h-4 w-4" />下一套</button>}</div>
        <div className="mt-4 max-w-3xl">{renderCard(primaryRecommendation, true)}</div>
      </> : <div className="mt-8 border border-graphite/20 bg-tag/55 px-5 py-10 text-center"><h2 className="font-story text-2xl font-semibold">暂时没有更多有依据的新组合</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-graphite/70">下面保留你已经记录过的 Best Match；继续记录搭配和反馈，新的方向会从真实证据里出现。</p>{historyRecommendations.length === 0 && <button type="button" onClick={() => navigate('/best-match/new')} className="mt-5 min-h-11 bg-ink px-5 text-sm text-white">建立 Best Match</button>}</div>}

      {historyRecommendations.length > 0 && <section className="mt-10"><div className="hairline-b pb-3"><p className="font-tag text-[10px] uppercase tracking-[0.2em] text-graphite/50">Your references</p><h2 className="mt-1 font-story text-2xl font-semibold">三套稳妥参考</h2><p className="mt-1 text-sm text-graphite/65">一套正统 Best Match，再看两个只动一个位置的变体。</p></div><div className="mt-4 grid gap-4 lg:grid-cols-3">{historyRecommendations.map((recommendation) => renderCard(recommendation))}</div></section>}
    </section>
  );
}
