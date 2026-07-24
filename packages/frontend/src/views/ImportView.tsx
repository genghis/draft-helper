import { useState } from "react";
import type {
  BoardMeta,
  BoardPosition,
  MatchResult,
  MatchedEntry,
  Player,
  ScoringFormat,
} from "@drafthelper/shared";
import { layoutFromRanked, matchEntries, parseRankings } from "@drafthelper/shared";
import { api } from "../api/client";
import "./ImportView.css";

const POSITIONS: BoardPosition[] = ["QB", "RB", "WR", "TE", "FLX", "K", "DST"];
const SCORINGS: ScoringFormat[] = ["PPR", "HALF", "STD"];

interface Props {
  players: Player[];
  onCreated: (board: BoardMeta) => void;
  onCancel: () => void;
}

type Stage =
  | { kind: "pick" }
  | { kind: "review"; result: MatchResult; sourceLabel: string }
  | { kind: "creating" };

export function ImportView({ players, onCreated, onCancel }: Props) {
  const [position, setPosition] = useState<BoardPosition>("RB");
  const [scoring, setScoring] = useState<ScoringFormat>("PPR");
  const [pasted, setPasted] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  // review-stage selections: entry rank -> chosen playerId ("" = skip)
  const [resolutions, setResolutions] = useState<Record<number, string>>({});

  function startReview(content: string, sourceLabel: string) {
    const entries = parseRankings(content);
    if (entries.length === 0) {
      setError("Couldn't find any players in that content.");
      return;
    }
    const result = matchEntries(entries, players, position);
    setResolutions(
      Object.fromEntries(
        result.unmatched.map((u) => [u.entry.rank, u.candidates[0]?.player.id ?? ""])
      )
    );
    setStage({ kind: "review", result, sourceLabel });
  }

  async function fetchBorisChen() {
    setError(null);
    try {
      const res = await api<{ content: string }>(
        `/imports/borischen?position=${position}&scoring=${scoring}`
      );
      startReview(res.content, "Boris Chen");
    } catch (e) {
      setError(String(e));
    }
  }

  async function createBoard(result: MatchResult, sourceLabel: string) {
    setStage({ kind: "creating" });
    const resolved: MatchedEntry[] = result.unmatched.flatMap((u) => {
      const playerId = resolutions[u.entry.rank];
      const player = u.candidates.find((c) => c.player.id === playerId)?.player;
      return player ? [{ entry: u.entry, player }] : [];
    });
    const all = [...result.matched, ...resolved];
    const { placements, bands } = layoutFromRanked(
      all.map((m) => ({ playerId: m.player.id, rank: m.entry.rank, tier: m.entry.tier }))
    );
    try {
      const meta = await api<BoardMeta>("/boards", {
        method: "POST",
        body: {
          name: `${position} ${scoring} (${sourceLabel})`,
          position,
          scoring,
          bands,
          placements,
        },
      });
      onCreated(meta);
    } catch (e) {
      setError(String(e));
      setStage({ kind: "review", result, sourceLabel });
    }
  }

  if (stage.kind === "review" || stage.kind === "creating") {
    const { result, sourceLabel } =
      stage.kind === "review" ? stage : { result: null, sourceLabel: "" };
    if (!result) return <p className="muted">Creating board…</p>;
    return (
      <section className="import-view">
        <h2>Review import</h2>
        <p>
          {result.matched.length} matched automatically
          {result.unmatched.length > 0 &&
            ` — ${result.unmatched.length} need${result.unmatched.length === 1 ? "s" : ""} your eye`}
          .
        </p>
        {result.unmatched.length > 0 && (
          <ul className="import-unmatched">
            {result.unmatched.map((u) => (
              <li key={u.entry.rank}>
                <span className="import-source-name">
                  #{u.entry.rank} {u.entry.name}
                </span>
                <select
                  value={resolutions[u.entry.rank] ?? ""}
                  onChange={(e) =>
                    setResolutions((r) => ({ ...r, [u.entry.rank]: e.target.value }))
                  }
                >
                  <option value="">Skip this player</option>
                  {u.candidates.map((c) => (
                    <option key={c.player.id} value={c.player.id}>
                      {c.player.name} ({c.player.team ?? "FA"})
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
        <div className="import-actions">
          <button type="button" onClick={() => createBoard(result, sourceLabel)}>
            Create board
          </button>
          <button type="button" className="secondary" onClick={() => setStage({ kind: "pick" })}>
            Back
          </button>
        </div>
        {error && <p className="import-error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="import-view">
      <h2>Import rankings</h2>
      <div className="import-controls">
        <label>
          Position
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as BoardPosition)}
          >
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Scoring
          <select
            value={scoring}
            onChange={(e) => setScoring(e.target.value as ScoringFormat)}
          >
            {SCORINGS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="import-actions">
        <button type="button" onClick={fetchBorisChen}>
          Fetch Boris Chen tiers
        </button>
      </div>
      <p className="muted">…or paste tiers / CSV / a ranked list:</p>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        rows={8}
        placeholder={"Tier 1: Player One, Player Two\nTier 2: Player Three"}
      />
      <div className="import-actions">
        <button
          type="button"
          disabled={!pasted.trim()}
          onClick={() => startReview(pasted, "Pasted")}
        >
          Parse pasted rankings
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
