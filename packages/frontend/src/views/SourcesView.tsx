import type { SourceMeta } from "@drafthelper/shared";
import { api } from "../api/client";
import "./SourcesView.css";

interface Props {
  sources: SourceMeta[];
  onImport: () => void;
  onDeleted: (id: string) => void;
}

/** Immutable imported ranking lists — the raw inputs to sortings. */
export function SourcesView({ sources, onImport, onDeleted }: Props) {
  async function remove(source: SourceMeta) {
    if (!window.confirm(`Delete source “${source.name}”? Sortings already made from it stay.`)) {
      return;
    }
    await api(`/sources/${source.id}`, { method: "DELETE" });
    onDeleted(source.id);
  }

  return (
    <section className="sources-view">
      <div className="sources-header">
        <p className="muted">
          Imported ranking lists. They're immutable — build editable sortings from them on the
          Sortings tab.
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
