import { useEffect, useState } from "react";
import type { TagColor, TagMeta } from "@drafthelper/shared";
import { TAG_COLORS } from "@drafthelper/shared";
import "./Modal.css";
import "./TagBadges.css";
import "./TagPickerModal.css";

interface Props {
  playerId: string;
  playerName: string;
  /** Every tag, including auto-managed ones (filtered out below). */
  tags: TagMeta[];
  /** Tags this player already carries, used to disable rows. */
  current: TagMeta[] | undefined;
  onAdd: (tagId: string, playerId: string) => Promise<void>;
  onCreate: (label: string, color: TagColor, playerId: string) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Adds one player to a tag from anywhere a player is listed. A modal rather
 * than an anchored popover: the canvas lays chips out in percentages, and
 * there is no popover primitive in the app to reuse.
 */
export function TagPickerModal({
  playerId,
  playerName,
  tags,
  current,
  onAdd,
  onCreate,
  onClose,
}: Props) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The handcuff tag recomputes its membership as you draft, so a manual add
  // there would be silently reverted.
  const pickable = tags.filter((t) => !t.autoManaged);
  const memberIds = new Set((current ?? []).map((t) => t.id));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Tag {playerName}</h2>

        {pickable.length === 0 ? (
          <p className="muted">No tags yet — make one below.</p>
        ) : (
          <ul className="tag-picker-list">
            {pickable.map((tag) => {
              const member = memberIds.has(tag.id);
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    className="tag-picker-option"
                    disabled={member || busy}
                    onClick={() => run(() => onAdd(tag.id, playerId))}
                  >
                    <span className={`tag-badge tag-color-${tag.color}`}>{tag.label}</span>
                    <span className="muted">
                      {member ? "already tagged" : `${tag.playerCount} players`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <fieldset className="tag-picker-new">
          <legend>New tag</legend>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="Sleepers, My guys…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim() && !busy) {
                run(() => onCreate(label.trim(), color, playerId));
              }
            }}
          />
          <div className="tag-editor-colors">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`tag-dot tag-color-swatch tag-color-${c}${
                  color === c ? " tag-color-swatch-active" : ""
                }`}
                onClick={() => setColor(c)}
                aria-label={c}
                title={c}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!label.trim() || busy}
            onClick={() => run(() => onCreate(label.trim(), color, playerId))}
          >
            Create and tag
          </button>
        </fieldset>

        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
