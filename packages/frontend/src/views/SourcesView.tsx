import type { SourceMeta } from "@drafthelper/shared";
import { api } from "../api/client";
import "./SourcesView.css";

interface Props {
  sources: SourceMeta[];
  onImport: () => void;
  onView: (source: SourceMeta) => void;
  onDeleted: (id: string) => void;
}

/** Immutable imported ranking lists — the raw inputs to cheat sheets (boards). */
export function SourcesView({ sources, onImport, onView, onDeleted }: Props) {
  async function remove(source: SourceMeta) {
    if (!window.confirm(`Delete source “${source.name}”? Cheat sheets already made from it stay.`)) {
      return;
    }
    await api(`/sources/${source.id}`, { method: "DELETE" });
    onDeleted(source.id);
  }

  return (
    <section className="sources-view">
      <div className="sources-header">
        <p className="muted">
          Imported ranking lists. They're read-only — build editable cheat sheets from them on the
          Cheat Sheets tab.
        </p>
        <button type="button" onClick={onImport}>
          + Import source
        </button>
      </div>
      {sources.length === 0 ? (
        <p className="muted">No sources yet — import your first ranking list.</p>
      ) : (
        <ul className="sources-list">
          {sources.map((s) => (
            <li key={s.id} className="sources-row">
              <span className="sources-name">{s.name}</span>
              <span className="sources-meta">
                {s.scope} · {s.scoring} · {s.entryCount} players
              </span>
              <button type="button" className="secondary" onClick={() => onView(s)}>
                View
              </button>
              <button type="button" className="secondary" onClick={() => remove(s)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
