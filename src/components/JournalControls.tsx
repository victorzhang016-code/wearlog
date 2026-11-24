import { useEffect, useMemo } from "react";
import { Link, useLocation, type LinkProps } from "react-router";
import type { BestMatch, WardrobeItem } from "../types";
import { bundleEntriesFromMatch } from "../contexts/BestMatchContext";
import { TagBundle } from "./TagBundle";
import { ChevronDown } from "lucide-react";

/** Native selection with an explicit action label; the result is the content below. */
export function JournalSelect({ label, name, value, options, onChange }: {
  label: string; name: string; value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return <label className="sj-select-action">
    <span aria-hidden="true">{label}<span className="sj-select-count">{Math.max(0, options.findIndex(option => option.value === value)) + 1} / {options.length}</span><ChevronDown size={18} /></span>
    <select aria-label={name} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

// A reading position lasts for this tab's session; no wardrobe data is stored.
const readingPositions = new Map<string, {
  top: number; target: string; index: number; horizontal: Array<{ key: string; left: number }>;
}>();

export function useJournalReadingPosition() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  useEffect(() => {
    const position = readingPositions.get(path);
    if (!position) return;
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".style-journal [data-journal-scroll]").forEach((element) => {
        const saved = position.horizontal.find((entry) => entry.key === element.dataset.journalScroll);
        if (saved) element.scrollLeft = saved.left;
      });
      const links = [...document.querySelectorAll<HTMLAnchorElement>(".style-journal a")]
        .filter((entry) => entry.getAttribute("href") === position.target);
      const link = links[position.index] || links[0];
      link?.focus({ preventScroll: true });
      window.scrollTo({ top: position.top, behavior: "instant" });
      readingPositions.delete(path);
    });
    return () => cancelAnimationFrame(frame);
  }, [path]);
}

export function JournalLink({ onClick, state, ...props }: LinkProps) {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  return <Link {...props} state={{ ...state, journalReturnTo: path }} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const target = event.currentTarget.getAttribute("href") || "";
      const links = [...document.querySelectorAll<HTMLAnchorElement>(".style-journal a")].filter((entry) => entry.getAttribute("href") === target);
      const horizontal = [...document.querySelectorAll<HTMLElement>(".style-journal [data-journal-scroll]")]
        .map((element) => ({ key: element.dataset.journalScroll || "", left: element.scrollLeft }));
      readingPositions.set(path, { top: window.scrollY, target, index: links.indexOf(event.currentTarget), horizontal });
    }
  }} />;
}

/** A saved outfit is the same linked physical object used in Best Match. */
export function JournalOutfitLink({ match, items, caption }: {
  match: BestMatch; items: WardrobeItem[]; caption?: string;
}) {
  const entries = useMemo(() => bundleEntriesFromMatch(match, new Map(items.map((item) => [item.id, item]))), [match, items]);
  return <JournalLink className="sj-outfit-link" to={`/best-match/${match.id}`} aria-label={`查看搭配：${match.name || "我的搭配"}`}>
    <div className="best-match-card-surface sj-outfit-surface">
      <TagBundle entries={entries} size="mini" variant="stacked" />
    </div>
    <h4>{match.name || "我的搭配"}</h4>
    {caption && <blockquote>“{caption}”</blockquote>}
  </JournalLink>;
}
