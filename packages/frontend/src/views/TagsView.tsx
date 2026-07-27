import type { TagMeta } from "@drafthelper/shared";
import { api } from "../api/client";
import "../components/TagBadges.css";
import "./TagsView.css";

interface Props {
  tags: TagMeta[];
  onNew: () => void;
  onEdit: (tag: TagMeta) => void;
  onDeleted: (id: string) => void;
}

/** Editable player-membership sets — sleepers, my guys, handcuffs, etc. */
export function TagsView({ tags, onNew, onEdit, onDeleted }: Props) {
  async function remove(tag: TagMeta) {
    if (!window.confirm(`Delete tag “${tag.label}”? This removes its badge everywhere.`)) {
      return;
    }
    await api(`/tags/${tag.id}`, { method: "DELETE" });
    onDeleted(tag.id);
  }

  return (
    <section className="tags-view">
      <div className="tags-header">
        <p className="muted">
          Editable player labels — paste names to tag them, then add or remove players anytime.
        </p>
        <button type="button" onClick={onNew}>
          + New tag
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="muted">No tags yet — make one for your sleepers or handcuffs.</p>
      ) : (
        <ul className="tags-list">
          {tags.map((t) => (
            <li key={t.id} className="tags-row">
              <span className={`tag-badge tag-color-${t.color}`}>{t.label}</span>
              <span className="tags-meta">{t.playerCount} players</span>
              <button type="button" className="secondary" onClick={() => onEdit(t)}>
                Edit
              </button>
              <button type="button" className="secondary" onClick={() => remove(t)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
