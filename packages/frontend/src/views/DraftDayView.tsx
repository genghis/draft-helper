import { useMemo, useRef, useState } from "react";
import type { BoardLayout, BoardMeta, Pick, Player, TagMeta } from "@drafthelper/shared";
import { buildNameIndex, orderWarnings, searchPlayers } from "@drafthelper/shared";
import type { AdpLookup } from "../state/adp";
import type { DraftController } from "../state/draft";
import { PlayerPositionBadge } from "../components/PositionBadge";
import { BestAvailableRail } from "./BestAvailableRail";
import { DraftOrderPanel } from "./DraftOrderPanel";
import { RunningBoard } from "./RunningBoard";
import "../components/PlayerRowActions.css";
import "./DraftDayView.css";

interface Props {
  boards: BoardMeta[];
  players: Player[];
  playersById: Map<string, Player>;
  adp: AdpLookup;
  tagsByPlayer?: Map<string, TagMeta[]>;
  onTagPlayer?: (playerId: string) => void;
  draft: DraftController;
  layouts: Map<string, BoardLayout>;
}

interface Toast {
  playerId: string;
  name: string;
  mine: boolean;
}

const TOAST_MS = 5000;
const LOG_SIZE = 10;

export function DraftDayView({
  boards,
  players,
  playersById,
  adp,
  tagsByPlayer,
  onTagPlayer,
  draft,
  layouts,
}: Props) {
  const [query, setQuery] = useState("");
  const [mineNext, setMineNext] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Keyboard-first only where a hardware keyboard is likely; on touch the
  // constant refocus would keep popping the on-screen keyboard.
  const keyboardMode = useMemo(() => window.matchMedia("(hover: hover)").matches, []);

  // Best board y per player, used to rank search hits toward ranked players.
  const rankById = useMemo(() => {
    const rank = new Map<string, number>();
    for (const layout of layouts.values()) {
      for (const [id, p] of Object.entries(layout.placements)) {
        const prev = rank.get(id);
        if (prev === undefined || p.y < prev) rank.set(id, p.y);
      }
    }
    return rank;
  }, [layouts]);

  const nameIndex = useMemo(() => buildNameIndex(players), [players]);

  const results = useMemo(
    () =>
      searchPlayers(query, players, rankById, undefined, nameIndex).filter(
        (p) => !draft.picks.has(p.id)
      ),
    [query, players, rankById, nameIndex, draft.picks]
  );

  function showToast(player: Player, mine: boolean) {
    clearTimeout(toastTimer.current);
    setToast({ playerId: player.id, name: player.name, mine });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  function markPlayer(player: Player, mine: boolean) {
    void draft.mark(player.id, mine);
    showToast(player, mine);
    setQuery("");
    setMineNext(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results[0]) {
      e.preventDefault();
      markPlayer(results[0], mineNext || e.shiftKey);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  async function undoToast(t: Toast) {
    setToast(null);
    clearTimeout(toastTimer.current);
    await draft.unmark(t.playerId);
    inputRef.current?.focus();
  }

  const recent = useMemo(
    () =>
      [...draft.picks.values()]
        .sort((a, b) => b.pickedAt.localeCompare(a.pickedAt))
        .slice(0, LOG_SIZE),
    [draft.picks]
  );

  const orderIssues = useMemo(
    () => (draft.order ? orderWarnings([...draft.picks.values()], draft.order) : []),
    [draft.picks, draft.order]
  );

  const lastMarkedName =
    draft.lastMarked !== null ? playersById.get(draft.lastMarked)?.name : null;

  const espnCount = [...draft.picks.values()].filter((p) => p.source === "espn").length;
  const pushAgeSec =
    draft.sync.lastPushAt !== null
      ? Math.max(0, (Date.now() - Date.parse(draft.sync.lastPushAt)) / 1000)
      : null;
  const syncState =
    pushAgeSec === null ? "off" : pushAgeSec < 15 ? "live" : pushAgeSec < 60 ? "stale" : "dead";
  const syncLabel =
    syncState === "off"
      ? "manual mode"
      : syncState === "live"
        ? `extension live · ${espnCount} synced`
        : syncState === "stale"
          ? `extension lagging (${Math.round(pushAgeSec!)}s)`
          : `extension silent ${Math.round(pushAgeSec! / 60)}m — mark manually`;

  return (
    <section className="draft-day">
      <div className={`draft-sync draft-sync-${syncState}`} role="status">
        {syncLabel}
      </div>
      <DraftOrderPanel
        order={draft.order}
        error={draft.orderError}
        warnings={orderIssues}
        onStart={draft.startOrder}
        onChange={draft.saveOrder}
      />
      <div className="draft-search-bar">
        <input
          ref={inputRef}
          autoFocus
          type="search"
          inputMode="search"
          placeholder="Type a name, Enter marks drafted…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (keyboardMode) setTimeout(() => inputRef.current?.focus(), 100);
          }}
          aria-label="Search players"
        />
        <button
          type="button"
          className={mineNext ? "draft-mine-toggle draft-mine-toggle-on" : "draft-mine-toggle"}
          onClick={() => setMineNext((v) => !v)}
          title="The next mark is my pick"
        >
          {mineNext ? "Marking: mine" : "Next is mine?"}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="draft-results">
          {results.map((p, i) => (
            <li key={p.id} className={i === 0 ? "draft-result draft-result-top" : "draft-result"}>
              <button
                type="button"
                className="draft-result-main"
                onClick={() => markPlayer(p, mineNext)}
              >
                <PlayerPositionBadge player={p} />
                <span className="draft-result-name">{p.name}</span>
                <span className="draft-result-meta">{p.team ?? "FA"}</span>
                {i === 0 && <kbd className="draft-result-kbd">↵</kbd>}
              </button>
              {onTagPlayer && (
                <button
                  type="button"
                  className="tier-tag-btn"
                  onClick={() => onTagPlayer(p.id)}
                  title={`Tag ${p.name}`}
                  aria-label={`Tag ${p.name}`}
                >
                  ⊕
                </button>
              )}
              <button
                type="button"
                className="tier-mine-btn"
                onClick={() => markPlayer(p, true)}
                title="Drafted by me"
              >
                Mine
              </button>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="draft-toast" role="status">
          <span>
            Marked <strong>{toast.name}</strong>
            {toast.mine ? " — my pick" : ""}
          </span>
          <button type="button" onClick={() => void undoToast(toast)}>
            Undo
          </button>
        </div>
      )}

      {draft.order && (
        <RunningBoard picks={draft.picks} order={draft.order} playersById={playersById} />
      )}

      <BestAvailableRail
        boards={boards}
        layouts={layouts}
        playersById={playersById}
        adp={adp}
        tagsByPlayer={tagsByPlayer}
        onTagPlayer={onTagPlayer}
        picks={draft.picks}
      />

      <div className="draft-log">
        <header className="draft-log-header">
          <span>Recent picks</span>
          {lastMarkedName != null && (
            <button type="button" className="secondary" onClick={() => void draft.undoLast()}>
              Undo last ({lastMarkedName})
            </button>
          )}
        </header>
        {recent.length === 0 && <p className="muted">No picks yet.</p>}
        <ul>
          {recent.map((pick: Pick) => (
            <li key={pick.playerId} className="draft-log-row">
              <span className="draft-log-name">
                {playersById.get(pick.playerId)?.name ?? pick.playerId}
              </span>
              {pick.mine && <span className="tier-mine-tag">my pick</span>}
              <span className={`draft-source draft-source-${pick.source}`}>{pick.source}</span>
              <button
                type="button"
                className="secondary"
                onClick={() => void draft.unmark(pick.playerId)}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
