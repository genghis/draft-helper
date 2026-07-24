import type { BoardLayout, BoardMeta, Pick, Player } from "@drafthelper/shared";
import { projectBands } from "@drafthelper/shared";
import "./TierListView.css";

interface Props {
  meta: BoardMeta;
  layout: BoardLayout;
  playersById: Map<string, Player>;
  picks: Map<string, Pick>;
  onMark: (playerId: string, mine: boolean) => void;
  onUnmark: (playerId: string) => void;
}

export function TierListView({ meta, layout, playersById, picks, onMark, onUnmark }: Props) {
  const groups = projectBands(layout.placements, meta.bands);
  let overallRank = 0;

  return (
    <div className="tier-list">
      {groups.map((group) => {
        const remaining = group.playerIds.filter((id) => !picks.has(id)).length;
        return (
          <section key={group.band.label} className="tier-band">
            <header className="tier-band-header">
              <span>{group.band.label}</span>
              <span className={remaining <= 1 ? "tier-remaining tier-remaining-low" : "tier-remaining"}>
                {remaining} left
              </span>
            </header>
            <ul>
              {group.playerIds.map((id) => {
                overallRank++;
                const player = playersById.get(id);
                const pick = picks.get(id);
                const gone = pick !== undefined;
                const rowClass = [
                  "tier-row",
                  gone && (pick.mine ? "tier-row-mine" : "tier-row-gone"),
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={id} className={rowClass}>
                    <button
                      type="button"
                      className="tier-row-main"
                      onClick={() => (gone ? onUnmark(id) : onMark(id, false))}
                      title={gone ? "Undo" : "Mark drafted"}
                    >
                      <span className="tier-rank">{overallRank}</span>
                      <span className="tier-name">{player?.name ?? id}</span>
                      <span className="tier-team">{player?.team ?? ""}</span>
                    </button>
                    {!gone && (
                      <button
                        type="button"
                        className="tier-mine-btn"
                        onClick={() => onMark(id, true)}
                        title="Drafted by me"
                      >
                        Mine
                      </button>
                    )}
                    {gone && pick.mine && <span className="tier-mine-tag">my pick</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
