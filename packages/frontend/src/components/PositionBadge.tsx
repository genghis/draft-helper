import type { Position } from "@drafthelper/shared";
import "./PositionFilter.css";

/** Readable position label. Colour alone was the only signal before this. */
export function PositionBadge({ position }: { position: Position | undefined }) {
  if (!position) return null;
  return (
    <span className="position-badge" data-position={position}>
      {position}
    </span>
  );
}
