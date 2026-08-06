import { useEffect, useMemo, useState } from "react";
import type { Player, Position, Source, SourceMeta } from "@drafthelper/shared";
import { api } from "../api/client";
import { matchesPosition } from "@drafthelper/shared";
import { PositionFilter } from "../components/PositionFilter";
import { PositionBadge } from "../components/PositionBadge";
import "./SourceDetailView.css";

interface Props {
  meta: SourceMeta;
  playersById: Map<string, Player>;
  onBack: () => void;
}

/**
 * What a source actually contains. The list view only ever showed a count, so
 * there was no way to check what you imported — or to see that a row matched
 * the wrong player — without building a cheat sheet from it first.
 */
export function SourceDetailView({ meta, playersById, onBack }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<Set<Position>>(new Set());

  useEffect(() => {
    let live = true;
    api<Source>(`/sources/${meta.id}`)
      .then((s) => live && setSource(s))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [meta.id]);

  const entries = useMemo(
    () => [...(source?.entries ?? [])].sort((a, b) => a.rank - b.rank),
    [source]
  );

  const counts = useMemo(() => {
    const c = new Map<Position, number>();
    for (const e of entries) {
      const pos = playersById.get(e.playerId)?.position;
      if (pos) c.set(pos, (c.get(pos) ?? 0) + 1);
    }
    return c;
  }, [entries, playersById]);

  const visible = entries.filter((e) =>
    matchesPosition(playersById.get(e.playerId)?.position, posFilter)
  );

  return (
    <section className="source-detail">
      <header className="source-detail-head">
        <button type="button" className="secondary" onClick={onBack}>
          ← Sources
        </button>
        <h2>{meta.name}</h2>
        <span className="muted">
          {meta.scope} · {meta.scoring} · {meta.entryCount} players
        </span>
      </header>

      {error && <p className="app-error">{error}</p>}
      {!source && !error && <p className="muted">Loading…</p>}

      {source && (
        <>
          <PositionFilter selected={posFilter} onChange={setPosFilter} counts={counts} />
          <p className="muted">
            {visible.length === entries.length
              ? `${entries.length} players`
              : `${visible.length} of ${entries.length} players`}
            {" · read-only — build a cheat sheet to reorder"}
          </p>
          <ol className="source-detail-list">
            {visible.map((e) => {
              const player = playersById.get(e.playerId);
              return (
                <li key={e.playerId} data-position={player?.position}>
                  <span className="source-detail-rank">{e.rank}</span>
                  <PositionBadge position={player?.position} />
                  <span className="source-detail-name">
                    {/* A source stores player ids; an id with no player means the
                        canonical list dropped them since import. */}
                    {player?.name ?? <em className="muted">unknown player ({e.playerId})</em>}
                  </span>
                  <span className="source-detail-team">{player?.team ?? "FA"}</span>
                  <span className="source-detail-tier">T{e.tier}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
