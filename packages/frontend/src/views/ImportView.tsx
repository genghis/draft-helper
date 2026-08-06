import { useState } from "react";
import type {
  BoardPosition,
  MatchResult,
  MatchedEntry,
  ParsedEntry,
  Player,
  RankedPlayer,
  ScoringFormat,
  SourceMeta,
} from "@drafthelper/shared";
import { looksLikeEspnPdf, matchEntries, parseEspnPdfLines, parseRankings } from "@drafthelper/shared";
import { api } from "../api/client";
import { readPdfText } from "../lib/readPdfText";
import "./ImportView.css";

const SCOPES: BoardPosition[] = ["OVERALL", "QB", "RB", "WR", "TE", "FLX", "K", "DST"];
const SCORINGS: ScoringFormat[] = ["PPR", "HALF", "STD"];

interface Props {
  players: Player[];
  onCreated: (source: SourceMeta) => void;
  onCancel: () => void;
}

type Stage =
  | { kind: "pick" }
  | { kind: "review"; result: MatchResult; sourceLabel: string }
  | { kind: "creating" };

export function ImportView({ players, onCreated, onCancel }: Props) {
  const [scope, setScope] = useState<BoardPosition>("OVERALL");
  const [scoring, setScoring] = useState<ScoringFormat>("PPR");
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  /** Set while a PDF is being read; the engine loads on demand and is not instant. */
  const [busy, setBusy] = useState<string | null>(null);
  // review-stage selections: entry rank -> chosen playerId ("" = skip)
  const [resolutions, setResolutions] = useState<Record<number, string>>({});

  function startReview(content: string, sourceLabel: string) {
    review(parseRankings(content), sourceLabel);
  }

  function review(entries: ParsedEntry[], sourceLabel: string) {
    if (entries.length === 0) {
      setError("Couldn't find any players in that content.");
      return;
    }
    const result = matchEntries(entries, players, scope);
    // Deliberately empty: every unmatched row starts on "Skip". Pre-selecting the
    // nearest fuzzy candidate silently wrote wrong players into saved sources.
    setResolutions({});
    setName(`${sourceLabel} — ${scope} ${scoring}`);
    setStage({ kind: "review", result, sourceLabel });
  }

  /** Guard against a mis-picked file: rankings exports are tens of KB, not MB. */
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${Math.round(file.size / 1024 / 1024)} MB — rankings exports are far smaller. Check you picked the right one.`);
      return;
    }
    const label = file.name.replace(/\.[^.]+$/, "");
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setBusy("Reading PDF…");
        const lines = await readPdfText(file);
        if (!looksLikeEspnPdf(lines)) {
          setError(
            "That PDF doesn't look like a rankings list. Only ESPN's printable rankings are supported — for anything else, export CSV."
          );
          return;
        }
        review(parseEspnPdfLines(lines), label);
        return;
      }
      const text = await file.text();
      // Strip a UTF-8 BOM: Excel writes one, and it would corrupt the first
      // header cell so the name column is never found.
      startReview(text.replace(/^\uFEFF/, ""), label);
    } catch {
      setError("Couldn't read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function fetchBorisChen() {
    setError(null);
    try {
      const res = await api<{ content: string }>(
        `/imports/borischen?position=${scope}&scoring=${scoring}`
      );
      startReview(res.content, "Boris Chen");
    } catch (e) {
      setError(String(e));
    }
  }

  async function createSource(result: MatchResult, sourceLabel: string) {
    setStage({ kind: "creating" });
    const resolved: MatchedEntry[] = result.unmatched.flatMap((u) => {
      const playerId = resolutions[u.entry.rank];
      const player = u.candidates.find((c) => c.player.id === playerId)?.player;
      return player ? [{ entry: u.entry, player }] : [];
    });
    const all = [...result.matched, ...resolved];
    const entries: RankedPlayer[] = all
      .map((m) => ({ playerId: m.player.id, rank: m.entry.rank, tier: m.entry.tier }))
      .sort((a, b) => a.rank - b.rank);
    try {
      const meta = await api<SourceMeta>("/sources", {
        method: "POST",
        body: { name: name.trim() || `${sourceLabel} — ${scope} ${scoring}`, scope, scoring, entries },
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
    if (!result) return <p className="muted">Saving source…</p>;
    const skipCount = result.unmatched.filter((u) => !resolutions[u.entry.rank]).length;
    return (
      <section className="import-view">
        <h2>Review import</h2>
        <label className="import-name-field">
          Source name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <p>
          {result.matched.length} matched automatically
          {result.unmatched.length > 0 &&
            ` — ${result.unmatched.length} need${result.unmatched.length === 1 ? "s" : ""} your eye`}
          .
        </p>
        {result.matched.length > 0 && (
          <details className="import-matched">
            <summary>Check the {result.matched.length} automatic matches</summary>
            <ul>
              {result.matched.map((m) => (
                <li key={m.entry.rank}>
                  <span className="import-source-name">
                    #{m.entry.rank} {m.entry.name}
                  </span>
                  <span className="import-matched-arrow">→</span>
                  <span>
                    {m.player.name} ({m.player.team ?? "FA"})
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {skipCount > 0 && (
          <p className="import-warning">
            {skipCount} highlighted row{skipCount === 1 ? "" : "s"} will be left out of this source
            — pick a player for any you want to keep.
          </p>
        )}
        {result.unmatched.length > 0 && (
          <ul className="import-unmatched">
            {result.unmatched.map((u) => (
              <li
                key={u.entry.rank}
                className={resolutions[u.entry.rank] ? undefined : "import-unresolved"}
              >
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
          <button type="button" onClick={() => createSource(result, sourceLabel)}>
            Save source
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
      <h2>Import a ranking source</h2>
      <div className="import-controls">
        <label>
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as BoardPosition)}>
            {SCOPES.map((p) => (
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
      {scope !== "OVERALL" && (
        <div className="import-actions">
          <button type="button" onClick={fetchBorisChen}>
            Fetch Boris Chen tiers
          </button>
        </div>
      )}
      <label className="import-file">
        <span>Upload a rankings file</span>
        <input
          type="file"
          accept=".csv,.tsv,.txt,.pdf,text/csv,text/plain,application/pdf"
          onChange={onFile}
          disabled={busy !== null}
        />
        <span className="muted">
          {busy ?? "CSV, tab-separated, or ESPN's printable rankings PDF."}
        </span>
      </label>

      <p className="muted">
        {scope === "OVERALL"
          ? "…or paste an overall/full-draft ranking (tiers, CSV, or a ranked list):"
          : "…or paste tiers / CSV / a ranked list:"}
      </p>
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
