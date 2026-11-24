import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useWardrobe } from "../contexts/WardrobeContext";
import { useBestMatches } from "../contexts/BestMatchContext";
import {
  buildAestheticAnalysisV4,
  type AnalysisRun,
} from "../lib/aestheticAnalysisV3";
import { liveAestheticSnapshot } from "../lib/aestheticProduct";
import {
  listVisionAnalyses,
  type VisionAnalysis,
} from "../lib/aestheticVision";
import { loadSyncedAestheticRun } from "../lib/aestheticRunSync";
import { StyleJournalExperience } from "./StyleJournalExperience";
import { currentJournalAnalyses } from "../lib/styleJournalView";
import { useAuth } from "./Auth";

export function AestheticProfilePage() {
  const { user } = useAuth();
  const { items, loading: itemsLoading, error: itemsError } = useWardrobe();
  const {
    matches,
    loading: matchesLoading,
    error: matchesError,
  } = useBestMatches();
  const [analyses, setAnalyses] = useState<VisionAnalysis[]>([]);
  const [syncedRun, setSyncedRun] = useState<AnalysisRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotice("");
    Promise.allSettled([listVisionAnalyses(), loadSyncedAestheticRun()]).then(
      ([vision, saved]) => {
        if (!alive) return;
        setAnalyses(vision.status === "fulfilled" ? vision.value : []);
        setSyncedRun(saved.status === "fulfilled" ? saved.value : null);
        if (vision.status === "rejected")
          setNotice("颜色信息暂时没能读取，已有搭配仍可查看。");
        else if (saved.status === "rejected")
          setNotice("暂时无法读取上次整理的风格，先展示当前衣物与搭配。");
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [retry, user?.uid]);
  // Never inherit another account's local audit-workbench state.
  const currentRun = useMemo(
    () =>
      buildAestheticAnalysisV4(
        liveAestheticSnapshot(
          items,
          matches,
          currentJournalAnalyses(analyses, items),
        ),
      ),
    [items, matches, analyses],
  );
  const displayRun = useMemo(
    () =>
      syncedRun
        ? {
            ...syncedRun,
            atoms: currentRun.atoms,
            colors: currentRun.colors,
            substitutions: currentRun.substitutions,
            outfitCases: currentRun.outfitCases,
            opportunities: currentRun.opportunities,
            conceptRelations: currentRun.conceptRelations,
            recommendationRuleVersion: currentRun.recommendationRuleVersion,
          }
        : currentRun,
    [syncedRun, currentRun],
  );
  if (itemsLoading || matchesLoading || loading)
    return (
      <div className="grid min-h-[55vh] place-items-center" role="status">
        <p className="flex items-center gap-3 font-story text-graphite">
          <Loader2 className="h-5 w-5 animate-spin" />
          正在加载衣物与搭配…
        </p>
      </div>
    );
  if (itemsError || matchesError)
    return (
      <div className="py-20 text-center">
        <h1 className="font-story text-2xl">衣柜记录加载失败</h1>
        <p className="my-4 text-sm text-graphite">
          请重新加载后再试。
        </p>
        <button className="sj-button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          重新加载
        </button>
      </div>
    );
  return (
    <>
      {notice && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 text-sm text-graphite"
        >
          {notice}
          <button
            onClick={() => setRetry((value) => value + 1)}
            className="sj-button"
          >
            重新读取
          </button>
        </div>
      )}
      <StyleJournalExperience
        items={items}
        matches={matches}
        run={displayRun}
        colors={currentRun.colors}
      />
    </>
  );
}
