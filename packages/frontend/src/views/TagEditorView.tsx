import { useMemo, useState } from "react";
import type { MatchResult, Player, Tag, TagColor, TagMeta } from "@drafthelper/shared";
import { matchEntries, parseRankings, TAG_COLORS } from "@drafthelper/shared";
import { api, ApiError } from "../api/client";
import { PlayerPicker } from "../components/PlayerPicker";
import "../components/TagBadges.css";
import "./ImportView.css";
import "./TagEditorView.css";

interface Props {
  players: Player[];
  playersById: Map<string, Player>;
  /** Present when editing an existing tag; absent when creating a new one. */
  existingTag?: Tag;
  onSaved: (meta: TagMeta) => void;
  onCancel: () => void;
}

type Stage = { kind: "edit" } | { kind: "review"; result: MatchResult } | { kind: "saving" };

/** Create or edit a tag: label + color + search-to-add, with removable member chips. */
export function TagEditorView({ players, playersById, existingTag, onSaved, onCancel }: Props) {
  const [label, setLabel] = useState(existingTag?.meta.label ?? "");
  const [color, setColor] = useState<TagColor>(existingTag?.meta.color ?? "blue");
  const [pasted, setPasted] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: "edit" });
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const isHandcuff = existingTag?.meta.autoManaged === "handcuff";

  const baseIds = useMemo(
    () => (existingTag?.playerIds ?? []).filter((id) => !removedIds.has(id)),
    [existingTag, removedIds]
  );
  const memberIds = useMemo(() => [...new Set([...baseIds, ...addedIds])], [baseIds, addedIds]);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);

  function removeMember(id: string) {
    setRemovedIds((prev) => new Set(prev).add(id));
    setAddedIds((prev) => prev.filter((x) => x !== id));
  }

  function addMember(id: string) {
    // Re-adding someone removed earlier this session has to clear the removal,
    // or the two sets cancel out and the click appears to do nothing.
    setRemovedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setAddedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function parsePasted() {
    setError(null);
    const entries = parseRankings(pasted);
    if (entries.length === 0) {
      setError("Couldn't find any players in that text.");
      return;
    }
    const result = matchEntries(entries, players, "OVERALL");
    if (result.unmatched.length > 0) {
      // Empty on purpose — unmatched rows start on "Skip" rather than the
      // nearest fuzzy guess, which was quietly adding the wrong players.
      setResolutions({});
      setStage({ kind: "review", result });
    } else {
      setAddedIds((ids) => [...ids, ...result.matched.map((m) => m.player.id)]);
      setPasted("");
    }
  }

  function confirmReview(result: MatchResult) {
    // Keyed by index, not rank: ranking lists repeat rank numbers.
    const resolvedIds = result.unmatched.flatMap((_, i) =>
      resolutions[i] ? [resolutions[i]!] : []
    );
    const matchedIds = result.matched.map((m) => m.player.id);
    setAddedIds((ids) => [...ids, ...matchedIds, ...resolvedIds]);
    setPasted("");
    setStage({ kind: "edit" });
  }

  async function save() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give the tag a name.");
      return;
    }
    if (memberIds.length === 0 && !isHandcuff) {
      setError("Add at least one player.");
      return;
    }
    setStage({ kind: "saving" });
    try {
      let meta: TagMeta;
      if (existingTag && isHandcuff) {
        // Removing an auto-added handcuff must exclude him from future
        // recomputes, not just delete him — else the next pick re-adds him.
        const autoAdded = new Set(existingTag.autoAddedIds ?? []);
        const newlyExcluded = [...removedIds].filter((id) => autoAdded.has(id));
        const autoExcludedIds = [
          ...new Set([...(existingTag.autoExcludedIds ?? []), ...newlyExcluded]),
        ];
        const autoAddedIds = (existingTag.autoAddedIds ?? []).filter((id) => !removedIds.has(id));
        meta = await api<TagMeta>(`/tags/${existingTag.meta.id}`, {
          method: "PUT",
          body: {
            label: trimmed,
            color,
            playerIds: memberIds,
            autoAddedIds,
            autoExcludedIds,
            version: existingTag.meta.version,
          },
        });
      } else if (existingTag) {
        meta = await api<TagMeta>(`/tags/${existingTag.meta.id}`, {
          method: "PUT",
          body: { label: trimmed, color, playerIds: memberIds, version: existingTag.meta.version },
        });
      } else {
        meta = await api<TagMeta>("/tags", {
          method: "POST",
          body: { label: trimmed, color, playerIds: memberIds },
        });
      }
      onSaved(meta);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "This tag changed elsewhere — close and reopen it to see the latest, then try again."
          : String(e)
      );
      setStage({ kind: "edit" });
    }
  }

  if (stage.kind === "review") {
    const { result } = stage;
    return (
      <section className="tag-editor-view">
        <h2>Resolve players</h2>
        <p>
          {result.matched.length} matched automatically
          {result.unmatched.length > 0 &&
            ` — ${result.unmatched.length} need${result.unmatched.length === 1 ? "s" : ""} your eye`}
          .
        </p>
        {result.unmatched.some((_, i) => !resolutions[i]) && (
          <p className="import-warning">
            Highlighted rows won't be added — pick a player for any you want to keep.
          </p>
        )}
        {result.unmatched.length > 0 && (
          <ul className="import-unmatched">
            {result.unmatched.map((u, i) => (
              <li
                key={`${u.entry.rank}-${i}`}
                className={resolutions[i] ? undefined : "import-unresolved"}
              >
                <span className="import-source-name">{u.entry.name}</span>
                <select
                  value={resolutions[i] ?? ""}
                  onChange={(e) =>
                    setResolutions((r) => ({ ...r, [i]: e.target.value }))
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
          <button type="button" onClick={() => confirmReview(result)}>
            Add these players
          </button>
          <button type="button" className="secondary" onClick={() => setStage({ kind: "edit" })}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const saving = stage.kind === "saving";

  return (
    <section className="tag-editor-view">
      <h2>{existingTag ? `Edit "${existingTag.meta.label}"` : "New tag"}</h2>
      {isHandcuff && (
        <p className="muted">
          Auto-managed — members are added/removed automatically as you draft RBs. Removing one
          here keeps it from reappearing.
        </p>
      )}
      <label className="tag-editor-name-field">
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
      </label>
      <div className="tag-editor-colors">
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`tag-dot tag-color-swatch tag-color-${c}${color === c ? " tag-color-swatch-active" : ""}`}
            onClick={() => setColor(c)}
            aria-label={c}
            title={c}
          />
        ))}
      </div>
      <div>
        <p className="muted">Members ({memberIds.length}):</p>
        {memberIds.length === 0 ? (
          <p className="muted">None yet — paste some names below.</p>
        ) : (
          <ul className="tag-editor-members">
            {memberIds.map((id) => (
              <li key={id} className="tag-editor-chip">
                {playersById.get(id)?.name ?? id}
                <button
                  type="button"
                  className="tag-editor-chip-remove"
                  onClick={() => removeMember(id)}
                  aria-label={`Remove ${playersById.get(id)?.name ?? id}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted">Add players:</p>
      <PlayerPicker players={players} selected={memberIdSet} onAdd={addMember} />

      <details className="tag-editor-paste">
        <summary>Paste a list instead</summary>
        <p className="muted">One name per line, or straight from an article:</p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={6}
          placeholder={"Player One\nPlayer Two"}
        />
        <div className="import-actions">
          <button type="button" disabled={!pasted.trim()} onClick={parsePasted}>
            Add pasted players
          </button>
        </div>
      </details>
      <div className="import-actions">
        <button type="button" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save tag"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
