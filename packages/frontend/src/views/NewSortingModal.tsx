import { useMemo, useState } from "react";
import type { BoardMeta, SeedTool, Source, SourceMeta } from "@drafthelper/shared";
import {
  agreementFromRows,
  consensusRanking,
  consensusToRanked,
  layoutFromRanked,
} from "@drafthelper/shared";
import { api } from "../api/client";
import "./NewSortingModal.css";

interface Props {
  sources: SourceMeta[];
  onCreated: (board: BoardMeta) => void;
  onClose: () => void;
}

/** Seeds a new sorting (board) from one or more immutable sources. */
export function NewSortingModal({ sources, onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [tool, setTool] = useState<SeedTool>("consensus");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(
    () => sources.filter((s) => selected.has(s.id)),
    [sources, selected]
  );
  const scopes = useMemo(() => new Set(chosen.map((s) => s.scope)), [chosen]);
  const scoringMismatch = useMemo(() => new Set(chosen.map((s) => s.scoring)).size > 1, [chosen]);

  const needCount = tool === "single" ? 1 : 2;
  const scopeMismatch = scopes.size > 1;
  const ready = chosen.length >= needCount && !scopeMismatch;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function create() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const full = await Promise.all(
        chosen.map((s) => api<Source>(`/sources/${s.id}`))
      );
      const rows = tool === "consensus" ? consensusRanking(full.map((s) => s.entries)) : null;
      const ranked = rows ? consensusToRanked(rows) : full[0]!.entries;
      const { placements, bands } = layoutFromRanked(ranked);
      const first = chosen[0]!;
      const board = await api<BoardMeta>("/boards", {
        method: "POST",
        body: {
          name: name.trim() || defaultName(tool, chosen),
          position: first.scope,
          scoring: first.scoring,
          bands,
          placements,
          sourceIds: chosen.map((s) => s.id),
          seededBy: tool,
          agreement: rows ? agreementFromRows(rows) : undefined,
        },
      });
      onCreated(board);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>New sorting</h2>

        {sources.length === 0 ? (
          <p className="muted">Import a source first — sortings are built from sources.</p>
        ) : (
          <>
            <label className="modal-field">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder={defaultName(tool, chosen)}
              />
            </label>

            <fieldset className="modal-tools">
              <legend>Seed with</legend>
              <label>
                <input
                  type="radio"
                  checked={tool === "single"}
                  onChange={() => setTool("single")}
                />
                Single source (use one list as-is)
              </label>
              <label>
                <input
                  type="radio"
                  checked={tool === "consensus"}
                  onChange={() => setTool("consensus")}
                />
                Consensus average (blend 2+ lists)
              </label>
              <label className="modal-tool-disabled">
                <input type="radio" disabled />
                ADP / value-over <span className="muted">(coming soon)</span>
              </label>
            </fieldset>

            <fieldset className="modal-sources">
              <legend>Sources</legend>
              {sources.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  {s.name} <span className="muted">({s.scope} · {s.scoring})</span>
                </label>
              ))}
            </fieldset>

            {scopeMismatch && (
              <p className="modal-error">Pick sources of the same scope (all {[...scopes][0]}, etc.).</p>
            )}
            {scoringMismatch && !scopeMismatch && (
              <p className="modal-warn">
                Heads up: mixing scoring formats — the sorting will use {chosen[0]!.scoring}.
              </p>
            )}
            {error && <p className="modal-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" disabled={!ready || busy} onClick={create}>
                {busy ? "Creating…" : "Create sorting"}
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function defaultName(tool: SeedTool, chosen: SourceMeta[]): string {
  if (chosen.length === 0) return "New sorting";
  if (tool === "single") return chosen[0]!.name;
  return `Consensus — ${chosen[0]!.scope} (${chosen.length} sources)`;
}
