import type { Player, Position } from "@drafthelper/shared";
import "./PositionFilter.css";

interface Props {
  position: Position | undefined;
  /** Depth-chart slot on the player's own team; 1 is the starter. */
  depthOrder?: number;
  /** Used only for the tooltip, to name the team the depth belongs to. */
  team?: string | null;
}

/**
 * Position label, with the depth-chart slot appended when known ("RB2").
 *
 * The slot is deliberately folded into the same badge rather than shown
 * separately: it is one fact about the player and two chips would crowd every
 * row. The tooltip carries the disambiguation, because "RB2" is also how
 * people say "the second-best RB" — here it strictly means second on his own
 * team's depth chart.
 */
export function PositionBadge({ position, depthOrder, team }: Props) {
  if (!position) return null;
  const label = depthOrder ? `${position}${depthOrder}` : position;
  const title = depthOrder
    ? `${ordinal(depthOrder)} on ${team ?? "his team"}'s depth chart at ${position}`
    : position;
  return (
    <span className="position-badge" data-position={position} title={title}>
      {label}
    </span>
  );
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

/** Convenience for the common case of rendering straight from a player record. */
export function PlayerPositionBadge({ player }: { player: Player | undefined }) {
  return (
    <PositionBadge
      position={player?.position}
      depthOrder={player?.depthOrder}
      team={player?.team}
    />
  );
}
