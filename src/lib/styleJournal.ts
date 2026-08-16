import type { AnalysisRun, AestheticPrinciple, ColorInsight, DesignHighlightInsight, OutfitCaseGraph, CombinationOpportunity } from './aestheticAnalysisV3';

export type StyleJournalStage = 'starting' | 'growing' | 'established';

export type StyleJournalChapter = {
  id: 'core' | 'outfit-method' | 'palette' | 'design' | 'anchors' | 'evolution';
  title: string;
  summary: string;
  maturity: 'observation' | 'emerging' | 'stable' | 'explicit';
  knowledgeType: 'explicit' | 'observed' | 'emerging';
  sourceIds: string[];
  caseIds: string[];
  itemIds: string[];
};

export type StyleJournal = {
  stage: StyleJournalStage;
  portrait: string;
  chapters: StyleJournalChapter[];
  snapshotHash: string;
  engineVersion: string;
  generatedAt: string;
};

export type StyleJournalInput = Pick<AnalysisRun, 'inputSnapshotHash' | 'engineVersion' | 'generatedAt' | 'principles' | 'outfitCases' | 'colorInsights' | 'designHighlights' | 'opportunities'>;

const unique = <T,>(values: T[]) => [...new Set(values)];

function stageFor(input: StyleJournalInput): StyleJournalStage {
  const anchors = new Set(input.outfitCases.map((entry) => entry.anchorItemId));
  if (input.outfitCases.length >= 3 && anchors.size >= 2) return 'established';
  if (input.outfitCases.length > 0 || input.principles.length > 0 || input.colorInsights.length > 0 || input.designHighlights.length > 0) return 'growing';
  return 'starting';
}

function maturityForPrinciple(principle: AestheticPrinciple): StyleJournalChapter['maturity'] {
  if (principle.kind === 'self_aware') return 'explicit';
  if (principle.kind === 'enacted' && principle.supportMatchIds.length >= 3) return 'stable';
  if (principle.kind === 'case_only') return 'observation';
  return 'emerging';
}

function chapter(
  id: StyleJournalChapter['id'],
  title: string,
  summary: string,
  maturity: StyleJournalChapter['maturity'],
  knowledgeType: StyleJournalChapter['knowledgeType'],
  sourceIds: string[],
  caseIds: string[],
  itemIds: string[],
): StyleJournalChapter {
  return { id, title, summary, maturity, knowledgeType, sourceIds: unique(sourceIds), caseIds: unique(caseIds), itemIds: unique(itemIds) };
}

function principleChapter(principles: AestheticPrinciple[], cases: OutfitCaseGraph[]) {
  const selected = principles.slice(0, 4);
  if (!selected.length) {
    return chapter(
      'core',
      '我的风格核心',
      cases.length ? '你已经留下了一些真实的搭配线索，稳定的风格理解还在形成。' : '目前还在观察，等更多衣物和搭配留下证据后，这一章会慢慢长出来。',
      cases.length ? 'observation' : 'observation',
      cases.length ? 'observed' : 'emerging',
      [],
      cases.slice(0, 4).map((entry) => entry.matchId),
      cases.flatMap((entry) => entry.primaryItems.map((item) => item.itemId)),
    );
  }
  return chapter(
    'core',
    '我的风格核心',
    selected.map((entry) => entry.statement).filter(Boolean).join(' '),
    selected.some((entry) => entry.kind === 'self_aware') ? 'explicit' : selected.some((entry) => entry.kind === 'enacted' && entry.supportMatchIds.length >= 3) ? 'stable' : 'emerging',
    selected.some((entry) => entry.kind === 'self_aware') ? 'explicit' : 'observed',
    selected.flatMap((entry) => entry.evidenceIds),
    selected.flatMap((entry) => entry.supportMatchIds),
    cases.filter((entry) => selected.some((principle) => principle.supportMatchIds.includes(entry.matchId))).flatMap((entry) => entry.primaryItems.map((item) => item.itemId)),
  );
}

function outfitMethodChapter(cases: OutfitCaseGraph[]) {
  const representative = [...cases].sort((left, right) => right.decisionMechanisms.length - left.decisionMechanisms.length || left.matchId.localeCompare(right.matchId))[0];
  if (!representative) return chapter('outfit-method', '我怎样完成一套搭配', '还没有足够的搭配案例来概括你的搭配动作。', 'observation', 'emerging', [], [], []);
  const action = representative.decisionMechanisms.find((entry) => entry.role !== 'structural')?.action;
  return chapter(
    'outfit-method',
    '我怎样完成一套搭配',
    `你常从「${representative.anchorItemName}」这样的核心单品展开，再通过支持件${action ? `完成“${action}”` : '处理比例、重心或色彩关系'}。`,
    cases.length >= 3 ? 'stable' : 'emerging',
    'observed',
    representative.decisionMechanisms.flatMap((entry) => entry.evidenceIds),
    cases.slice(0, 5).map((entry) => entry.matchId),
    representative.primaryItems.map((entry) => entry.itemId),
  );
}

function insightChapter(
  id: 'palette' | 'design',
  title: string,
  insights: Array<ColorInsight | DesignHighlightInsight>,
  fallback: string,
) {
  const selected = insights.slice(0, 3);
  if (!selected.length) return chapter(id, title, fallback, 'observation', 'emerging', [], [], []);
  return chapter(
    id,
    title,
    selected.map((entry) => entry.statement).filter(Boolean).join(' '),
    selected.some((entry) => entry.level === 'stable') ? 'stable' : 'emerging',
    'observed',
    selected.flatMap((entry) => entry.evidenceIds),
    selected.flatMap((entry) => entry.matchIds),
    selected.flatMap((entry) => entry.itemIds),
  );
}

function anchorChapter(cases: OutfitCaseGraph[]) {
  const counts = new Map<string, { name: string; count: number }>();
  cases.forEach((entry) => {
    const current = counts.get(entry.anchorItemId) || { name: entry.anchorItemName, count: 0 };
    counts.set(entry.anchorItemId, { name: current.name, count: current.count + 1 });
  });
  const anchors = [...counts.entries()].sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0])).slice(0, 3);
  return chapter(
    'anchors',
    '代表我的单品与搭配',
    anchors.length ? `目前最能代表你的搭配锚点是${anchors.map(([, value]) => `「${value.name}」`).join('、')}。它们提供了稳定的起点，具体风格仍要结合每套搭配的处理来看。` : '还没有足够的搭配案例来找到稳定的审美锚点。',
    anchors.length >= 2 ? 'emerging' : 'observation',
    anchors.length ? 'observed' : 'emerging',
    cases.flatMap((entry) => entry.decisionMechanisms.flatMap((mechanism) => mechanism.evidenceIds)),
    cases.slice(0, 5).map((entry) => entry.matchId),
    anchors.map(([id]) => id),
  );
}

function evolutionChapter(opportunities: CombinationOpportunity[], cases: OutfitCaseGraph[]) {
  return chapter(
    'evolution',
    '正在形成的变化',
    opportunities.length ? `当前有 ${opportunities.length} 个只改变一个位置的待试方向。它们沿用已经出现过的搭配骨架，仍然需要你的选择和实穿反馈来决定是否成立。` : '目前没有新的待试方向；继续记录搭配和反馈，变化会从新的证据里出现。',
    opportunities.length ? 'emerging' : cases.length ? 'observation' : 'observation',
    opportunities.length ? 'emerging' : 'observed',
    opportunities.flatMap((entry) => entry.evidenceIds),
    cases.slice(0, 5).map((entry) => entry.matchId),
    opportunities.flatMap((entry) => [entry.anchorItemId, entry.candidateItemId]),
  );
}

export function buildStyleJournal(input: StyleJournalInput): StyleJournal {
  const stage = stageFor(input);
  const core = principleChapter(input.principles, input.outfitCases);
  const portrait = core.summary || '这份风格志还在观察。';
  return {
    stage,
    portrait,
    chapters: [
      core,
      outfitMethodChapter(input.outfitCases),
      insightChapter('palette', '我的配色', input.colorInsights, '还没有足够的颜色案例来概括你的配色习惯。'),
      insightChapter('design', '我在意的设计', input.designHighlights, '还没有足够的设计案例来概括你在意的焦点。'),
      anchorChapter(input.outfitCases),
      evolutionChapter(input.opportunities, input.outfitCases),
    ],
    snapshotHash: input.inputSnapshotHash,
    engineVersion: input.engineVersion,
    generatedAt: input.generatedAt,
  };
}
