import { useState } from "react";
import type { DraftOrder, OrderWarning } from "@drafthelper/shared";
import { MAX_TEAMS, MIN_TEAMS, namedSeatsBeyond, resizeOrder, unlinkSeat } from "@drafthelper/shared";
import "./ImportView.css"; // .import-warning
import "./DraftOrderPanel.css";

interface Props {
  order: DraftOrder | null;
  error?: string | null;
  /** Sanity checks against the live picks; a wrong league size is otherwise invisible. */
  warnings?: OrderWarning[];
  onStart: (teamCount: number) => void;
  onChange: (order: DraftOrder) => void;
}

const TEAM_COUNTS = [8, 10, 12, 14, 16];

/**
 * The seat list. Seats fill themselves in from round 1's live ESPN picks;
 * this is for naming them, fixing the order for a mock, and saying which
 * seat is yours.
 */
export function DraftOrderPanel({ order, error, warnings, onStart, onChange }: Props) {
  const [open, setOpen] = useState(false);

  if (!order) {
    return (
      <div className="draft-order-setup">
        <span className="muted">Set your league size to track the draft order:</span>
        {TEAM_COUNTS.map((n) => (
          <button key={n} type="button" className="secondary" onClick={() => onStart(n)}>
            {n} teams
          </button>
        ))}
      </div>
    );
  }

  const setName = (slot: number, name: string) =>
    onChange({
      ...order,
      teams: order.teams.map((t, i) => (i === slot ? { ...t, name } : t)),
    });

  /** Shrinking drops seats permanently, so confirm when named ones would go. */
  function resize(current: DraftOrder, teamCount: number) {
    const losing = namedSeatsBeyond(current, teamCount);
    if (losing.length > 0) {
      const ok = window.confirm(
        `Dropping to ${teamCount} teams removes ${losing.join(", ")}. Their names can't be recovered.`
      );
      if (!ok) return;
    }
    onChange(resizeOrder(current, teamCount));
  }

  const knownSeats = order.teams.filter((t) => t.espnTeamId !== undefined).length;
  const hasWarnings = (warnings?.length ?? 0) > 0;

  return (
    <section className="draft-order">
      <header className="draft-order-head">
        <button type="button" className="secondary" onClick={() => setOpen(!open)}>
          {open ? "Hide draft order" : "Draft order"}
        </button>
        {hasWarnings && (
          <span className="draft-order-alert" title="Check the draft order">
            !
          </span>
        )}
        <span className="muted">
          {order.teamCount} teams
          {knownSeats > 0 && ` · ${knownSeats} matched from live picks`}
          {order.mySlot === null && " · pick your seat"}
        </span>
      </header>

      {open && (
        <>
          <div className="draft-order-size">
            <span className="muted">Teams:</span>
            <input
              type="number"
              min={MIN_TEAMS}
              max={MAX_TEAMS}
              value={order.teamCount}
              onChange={(e) => {
                // Ignore intermediate keystrokes: an empty box is Number("") === 0,
                // which would clamp to MIN_TEAMS and destroy seats mid-edit.
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= MIN_TEAMS && n <= MAX_TEAMS) {
                  resize(order, n);
                }
              }}
            />
          </div>
          <ol className="draft-order-list">
            {order.teams.map((team, slot) => (
              <li key={slot} className={slot === order.mySlot ? "is-mine" : undefined}>
                <span className="draft-order-slot">{slot + 1}</span>
                <input
                  value={team.name}
                  maxLength={40}
                  placeholder={
                    team.espnTeamId !== undefined ? `Team ${team.espnTeamId}` : "unclaimed seat"
                  }
                  onChange={(e) => setName(slot, e.target.value)}
                  aria-label={`Name for seat ${slot + 1}`}
                />
                {team.espnTeamId !== undefined && (
                  <button
                    type="button"
                    className="draft-order-unlink"
                    onClick={() => onChange(unlinkSeat(order, slot))}
                    title={`Unlink ESPN team ${team.espnTeamId} from this seat — it will re-learn from live picks`}
                    aria-label={`Unlink seat ${slot + 1}`}
                  >
                    unlink
                  </button>
                )}
                <button
                  type="button"
                  className="draft-order-mine"
                  // Not a toggle: clearing mySlot would be silently refilled by
                  // deriveOrder from the next live pick. Click another seat to move it.
                  onClick={() => onChange({ ...order, mySlot: slot })}
                  disabled={order.mySlot === slot}
                  title={order.mySlot === slot ? "Your seat" : "This is my seat"}
                >
                  {order.mySlot === slot ? "★ you" : "this is me"}
                </button>
              </li>
            ))}
          </ol>
          {error && <p className="import-warning">{error}</p>}
          {warnings?.map((w) => (
            <p key={w.kind} className="import-warning">
              {w.message}
            </p>
          ))}
          <p className="muted">
            Seats fill in automatically from round 1 once picks start arriving from ESPN.
          </p>
        </>
      )}
    </section>
  );
}
