import type { BoardAgreement, BoardLayout, BoardMeta, Pick, Player } from "@drafthelper/shared";
import { highDisagreementIds, projectBands } from "@drafthelper/shared";
import "./TierListView.css";

interface Props {
  meta: BoardMeta;
  layout: BoardLayout;
  agreement?: BoardAgreement;
  playersById: Map<string, Player>;
  picks: Map<string, Pick>;
  onMark: (playerId: string, mine: boolean) => void;
  onUnmark: (playerId: string) => void;
}

export function TierListView({
  meta,
  layout,
  agreement,
  playersById,
  picks,
  onMark,
  onUnmark,
}: Props) {
  const groups = projectBands(layout.placements, meta.bands);
  const sourceCount = meta.sourceIds?.length ?? 0;
  const splitIds = agreement ? highDisagreementIds(agreement) : new Set<string>();
  let overallRank = 0;

  return (
    <div className="tier-list">
      {agreement && (
        <p className="tier-legend muted">
          <span className="agree-badge agree-split">±</span> experts split (boom/bust) ·{" "}
          <span className="agree-badge agree-thin">n/{sourceCount || "N"}</span> ranked by only
          some sources
        </p>
      )}
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
                    {!gone && agreement && (
                      <AgreementBadge
                        stat={agreement[id]}
                        sourceCount={sourceCount}
                        split={splitIds.has(id)}
                      />
                    )}
                    {gone && pick.mine && <span className="tier-mine-tag">my pick</span>}
                    {gone && pick.source === "espn" && (
                      <span className="tier-espn-tag">espn</span>
                    )}
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

/** Boom/bust (high rank spread) and thin-coverage markers for consensus boards. */
function AgreementBadge({
  stat,
  sourceCount,
  split,
}: {
  stat: { coverage: number; spread: number } | undefined;
  sourceCount: number;
  split: boolean;
}) {
  if (!stat) return null;
  const thin = sourceCount > 1 && stat.coverage < sourceCount;
  if (!split && !thin) return null;
  return (
    <span className="agree-badges">
      {split && (
        <span
          className="agree-badge agree-split"
          title={`Experts disagree — ranks varied by ~${Math.round(stat.spread)}`}
        >
          ±{Math.round(stat.spread)}
        </span>
      )}
      {thin && (
        <span
          className="agree-badge agree-thin"
          title={`Ranked by only ${stat.coverage} of ${sourceCount} sources`}
        >
          {stat.coverage}/{sourceCount}
        </span>
      )}
    </span>
  );
}
