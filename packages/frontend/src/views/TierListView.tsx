import type {
  AdpForPlayer,
  BoardAgreement,
  BoardLayout,
  BoardMeta,
  Pick,
  Player,
} from "@drafthelper/shared";
import { adpDivergence, adpValue, boardAdpRanks, highDisagreementIds, primaryAdp, projectBands } from "@drafthelper/shared";
import type { AdpLookup } from "../state/adp";
import "./TierListView.css";

/** Gap (in ADP picks) at which the two markets are called "split". */
const ADP_DIVERGENCE_THRESHOLD = 12;
/** Minimum |value| worth surfacing as a value/reach tag. */
const VALUE_THRESHOLD = 4;

interface Props {
  meta: BoardMeta;
  layout: BoardLayout;
  agreement?: BoardAgreement;
  playersById: Map<string, Player>;
  adp: AdpLookup;
  picks: Map<string, Pick>;
  onMark: (playerId: string, mine: boolean) => void;
  onUnmark: (playerId: string) => void;
}

export function TierListView({
  meta,
  layout,
  agreement,
  playersById,
  adp,
  picks,
  onMark,
  onUnmark,
}: Props) {
  const groups = projectBands(layout.placements, meta.bands);
  const sourceCount = meta.sourceIds?.length ?? 0;
  const splitIds = agreement ? highDisagreementIds(agreement) : new Set<string>();

  // Rank this board's players by market ADP so value = market rank - your rank.
  const primaryAdpById = new Map<string, number>();
  for (const id of Object.keys(layout.placements)) {
    const v = primaryAdp(adp.forPlayer(meta.scoring, id));
    if (v != null) primaryAdpById.set(id, v);
  }
  const adpRankById = boardAdpRanks(primaryAdpById);
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
                const adpVals = adp.forPlayer(meta.scoring, id);
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
                      {!gone && (
                        <AdpCell
                          vals={adpVals}
                          boardRank={overallRank}
                          adpRank={adpRankById.get(id)}
                        />
                      )}
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

/** Side-by-side ESPN/FFC ADP, a value-vs-market tag, and a divergence flag. */
function AdpCell({
  vals,
  boardRank,
  adpRank,
}: {
  vals: AdpForPlayer;
  boardRank: number;
  adpRank: number | undefined;
}) {
  if (vals.espn == null && vals.ffc == null) return null;
  const fmt = (n: number | undefined) => (n == null ? "—" : Math.round(n));
  const divergence = adpDivergence(vals);
  const value = adpRank != null ? adpValue(boardRank, adpRank) : null;
  return (
    <span className="tier-adp">
      <span className="adp-pair" title="ESPN · FFC average draft position">
        <span className="adp-espn">E{fmt(vals.espn)}</span>
        <span className="adp-ffc">F{fmt(vals.ffc)}</span>
      </span>
      {value != null && Math.abs(value) >= VALUE_THRESHOLD && (
        <span
          className={value > 0 ? "adp-value adp-value-up" : "adp-value adp-value-down"}
          title={
            value > 0
              ? "Value — the market drafts him later than you rank him (he may fall to you)"
              : "The market drafts him earlier than you rank him (likely gone by your slot)"
          }
        >
          {value > 0 ? `+${value}` : value}
        </span>
      )}
      {divergence != null && divergence >= ADP_DIVERGENCE_THRESHOLD && (
        <span className="agree-badge agree-split" title={`Markets disagree by ~${Math.round(divergence)} picks`}>
          ⇄
        </span>
      )}
    </span>
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
