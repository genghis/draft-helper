import { useState } from "react";
import type { DraftOrder, Pick, Player, Position } from "@drafthelper/shared";
import { buildBoard, picksMade, turnStatus, matchesPosition} from "@drafthelper/shared";
import { PositionFilter } from "../components/PositionFilter";
import { PlayerPositionBadge } from "../components/PositionBadge";
import "./RunningBoard.css";

interface Props {
  picks: Map<string, Pick>;
  order: DraftOrder;
  playersById: Map<string, Player>;
}

/**
 * Every pick so far, in order, with the team that made it, plus whose turn it
 * is. Called a pick log rather than a draft board: on draft day it sits beside
 * the cheat sheet, and two things called "board" on one screen is one too many.
 */
export function RunningBoard({ picks, order, playersById }: Props) {
  const [posFilter, setPosFilter] = useState<Set<Position>>(new Set());
  const all = [...picks.values()];
  const rows = buildBoard(all, order);
  const turn = turnStatus(picksMade(all), order);
  // Snake-inferred rows are a guess when picks were marked by hand; say so once
  // rather than casting doubt on every row.
  const inferred = rows.filter((r) => !r.attributed).length;
  const visible = rows.filter((row) =>
    matchesPosition(playersById.get(row.playerId)?.position, posFilter)
  );
  const counts = new Map<Position, number>();
  for (const row of rows) {
    const pos = playersById.get(row.playerId)?.position;
    if (pos) counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }

  return (
    <section className="running-board">
      {turn && (
        <div
          className={turn.picksAway === 0 ? "turn-banner turn-banner-now" : "turn-banner"}
          role="status"
        >
          {turn.picksAway === 0 ? (
            <>
              <strong>You're on the clock</strong>
              <span>
                pick {turn.round}.{turn.pick} · overall #{turn.nextOverall}
              </span>
            </>
          ) : (
            <>
              <strong>
                {turn.picksAway} pick{turn.picksAway === 1 ? "" : "s"} away
              </strong>
              <span>
                you're up at {turn.round}.{turn.pick} (overall #{turn.nextOverall})
              </span>
            </>
          )}
        </div>
      )}

      <header className="running-board-head">
        <span>Pick log</span>
        {rows.length > 0 && <span className="muted">{rows.length} picks in</span>}
      </header>
      {rows.length > 0 && (
        <PositionFilter selected={posFilter} onChange={setPosFilter} counts={counts} />
      )}

      {rows.length === 0 ? (
        <p className="muted">No picks yet.</p>
      ) : visible.length === 0 ? (
        <p className="muted">No picks yet at those positions.</p>
      ) : (
        <ol className="running-board-list">
          {visible.map((row) => (
            <li key={row.playerId} className={row.mine ? "is-mine" : undefined}>
              <span className="running-board-num">
                {row.round}.{String(row.pick).padStart(2, "0")}
              </span>
              <span className="running-board-team">
                {row.mine && <span className="pin" aria-hidden="true" />}
                {row.team?.name || `Seat ${row.slot + 1}`}
              </span>
              <PlayerPositionBadge player={playersById.get(row.playerId)} />
              <span className="running-board-player">
                {playersById.get(row.playerId)?.name ?? row.playerId}
              </span>
              {!row.attributed && (
                <span className="running-board-guess" title="Team inferred from snake order">
                  ?
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {inferred > 0 && (
        <p className="muted">
          {inferred} pick{inferred === 1 ? "" : "s"} marked “?” — team inferred from snake
          position, since ESPN didn't say who picked.
        </p>
      )}
    </section>
  );
}
