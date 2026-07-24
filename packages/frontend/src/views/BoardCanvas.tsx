import { useMemo, useRef, useState } from "react";
import type { BoardLayout, BoardMeta, Pick, Placement, Player } from "@drafthelper/shared";
import { moveBandBoundary, RANK_SPACING } from "@drafthelper/shared";
import { api } from "../api/client";
import { useLayoutSaver } from "../state/layoutSaver";
import "./BoardCanvas.css";

interface Props {
  meta: BoardMeta;
  layout: BoardLayout;
  playersById: Map<string, Player>;
  picks: Map<string, Pick>;
  onMetaChanged: (meta: BoardMeta) => void;
  onConflict: () => void;
}

/** Canvas x range; placements use these units directly. */
const CANVAS_WIDTH = 1000;
const CHIP_HALF_HEIGHT = RANK_SPACING * 1.4;

/**
 * The native 2D board: absolutely-positioned draggable chips (y ≈ value,
 * x free), tier bands as horizontal stripes with draggable boundaries.
 * ~300 DOM nodes — no <canvas> needed, and text/hit-testing come free.
 */
export function BoardCanvas({
  meta,
  layout,
  playersById,
  picks,
  onMetaChanged,
  onConflict,
}: Props) {
  const [placements, setPlacements] = useState(layout.placements);
  const [bands, setBands] = useState(meta.bands);
  const { save, saving } = useLayoutSaver(meta.id, layout.version, onConflict);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "chip"; id: string }
    | { kind: "boundary"; index: number }
    | null
  >(null);

  const maxY = useMemo(() => {
    const ys = [
      ...Object.values(placements).map((p) => p.y),
      ...bands.map((b) => b.y1),
    ];
    return Math.max(...ys, RANK_SPACING) + RANK_SPACING * 4;
  }, [placements, bands]);

  function toCanvas(e: React.PointerEvent): Placement | null {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(
        Math.max(((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH, 0),
        CANVAS_WIDTH
      ),
      y: Math.min(Math.max(((e.clientY - rect.top) / rect.height) * maxY, 0), maxY),
    };
  }

  function onChipPointerDown(e: React.PointerEvent, id: string) {
    drag.current = { kind: "chip", id };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBoundaryPointerDown(e: React.PointerEvent, index: number) {
    drag.current = { kind: "boundary", index };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const active = drag.current;
    if (!active) return;
    const point = toCanvas(e);
    if (!point) return;
    if (active.kind === "chip") {
      setPlacements((prev) => {
        const next = { ...prev, [active.id]: point };
        save(next);
        return next;
      });
    } else {
      setBands((prev) => moveBandBoundary(prev, active.index, point.y));
    }
  }

  function onPointerUp() {
    const active = drag.current;
    drag.current = null;
    if (active?.kind === "boundary") {
      void api<BoardMeta>(`/boards/${meta.id}`, {
        method: "PUT",
        body: { bands },
      }).then(onMetaChanged);
    }
  }

  return (
    <div className="canvas-wrap">
      {saving && <span className="canvas-saving muted">saving…</span>}
      <div
        ref={surfaceRef}
        className="canvas-surface"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${maxY}` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {bands.map((band, i) => (
          <div
            key={`${band.label}-${i}`}
            className={i % 2 === 0 ? "canvas-band" : "canvas-band canvas-band-alt"}
            style={{
              top: `${(band.y0 / maxY) * 100}%`,
              height: `${((band.y1 - band.y0) / maxY) * 100}%`,
            }}
          >
            <span className="canvas-band-label">{band.label}</span>
          </div>
        ))}
        {bands.slice(0, -1).map((band, i) => (
          <div
            key={`boundary-${i}`}
            className="canvas-boundary"
            style={{ top: `${(band.y1 / maxY) * 100}%` }}
            onPointerDown={(e) => onBoundaryPointerDown(e, i)}
            role="separator"
            aria-label={`Boundary below ${band.label}`}
          />
        ))}
        {Object.entries(placements).map(([id, p]) => {
          const pick = picks.get(id);
          const cls = [
            "canvas-chip",
            pick && (pick.mine ? "canvas-chip-mine" : "canvas-chip-gone"),
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={id}
              type="button"
              className={cls}
              style={{
                left: `${(p.x / CANVAS_WIDTH) * 100}%`,
                top: `${((p.y - CHIP_HALF_HEIGHT) / maxY) * 100}%`,
              }}
              onPointerDown={(e) => onChipPointerDown(e, id)}
              title={playersById.get(id)?.name ?? id}
            >
              {playersById.get(id)?.name ?? id}
            </button>
          );
        })}
      </div>
    </div>
  );
}
