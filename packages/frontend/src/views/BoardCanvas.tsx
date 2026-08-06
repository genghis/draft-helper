import { useMemo, useRef, useState } from "react";
import type {
  BoardAgreement,
  BoardLayout,
  BoardMeta,
  Pick,
  Placement,
  Player,
  Position,
  TagMeta,
  TierBand,
} from "@drafthelper/shared";
import {
  appendBand,
  highDisagreementIds,
  moveBandBoundary,
  RANK_SPACING,
  removeBand,
  renameBand,
  splitBand,
  spreadPlacements,
} from "@drafthelper/shared";
import { api, ApiError } from "../api/client";
import { useLayoutSaver } from "../state/layoutSaver";
import { TagDots } from "../components/TagBadges";
import { matchesPosition, PositionFilter } from "../components/PositionFilter";
import "./BoardCanvas.css";

interface Props {
  meta: BoardMeta;
  layout: BoardLayout;
  agreement?: BoardAgreement;
  playersById: Map<string, Player>;
  tagsByPlayer?: Map<string, TagMeta[]>;
  picks: Map<string, Pick>;
  onMetaChanged: (meta: BoardMeta) => void;
  onConflict: () => void;
  onLayoutChanged?: (boardId: string, layout: BoardLayout) => void;
}

/** Canvas x range; placements use these units directly. */
const CANVAS_WIDTH = 1000;
const CHIP_HALF_HEIGHT = RANK_SPACING * 1.4;
/** Rendered pixels per vertical canvas unit — bigger = taller, more readable. */
const V_SCALE = 3.2;

/**
 * The native 2D board: absolutely-positioned draggable chips (y ≈ value,
 * x free), tier bands as horizontal stripes with draggable boundaries.
 * ~300 DOM nodes — no <canvas> needed, and text/hit-testing come free.
 */
export function BoardCanvas({
  meta,
  layout,
  agreement,
  playersById,
  tagsByPlayer,
  picks,
  onMetaChanged,
  onConflict,
  onLayoutChanged,
}: Props) {
  const [placements, setPlacements] = useState(layout.placements);
  const [bands, setBands] = useState(meta.bands);
  const [bandError, setBandError] = useState<string | null>(null);
  // Index of the band whose label is being edited, plus its in-progress text.
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [posFilter, setPosFilter] = useState<Set<Position>>(new Set());
  const splitIds = useMemo(
    () => (agreement ? highDisagreementIds(agreement) : new Set<string>()),
    [agreement]
  );
  const { save, saving } = useLayoutSaver(
    meta.id,
    layout.version,
    onConflict,
    onLayoutChanged && ((next) => onLayoutChanged(meta.id, next))
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "chip"; id: string }
    | { kind: "boundary"; index: number }
    | null
  >(null);
  // Offset between the pointer and the chip's placement at grab time, so a
  // chip follows the cursor from wherever it was grabbed instead of its
  // placement snapping to the cursor (which reads as a jump on drag start).
  const chipGrabOffset = useRef<Placement>({ x: 0, y: 0 });

  const positionCounts = useMemo(() => {
    const c = new Map<Position, number>();
    for (const id of Object.keys(placements)) {
      const pos = playersById.get(id)?.position;
      if (pos) c.set(pos, (c.get(pos) ?? 0) + 1);
    }
    return c;
  }, [placements, playersById]);

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
    const point = toCanvas(e);
    const current = placements[id];
    chipGrabOffset.current =
      point && current ? { x: point.x - current.x, y: point.y - current.y } : { x: 0, y: 0 };
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
      // Compute next outside the updater — updaters must be pure (StrictMode
      // double-invokes them), and save() is a side effect.
      const placement = {
        x: point.x - chipGrabOffset.current.x,
        y: point.y - chipGrabOffset.current.y,
      };
      const next = { ...placements, [active.id]: placement };
      setPlacements(next);
      save(next);
    } else {
      setBands((prev) => moveBandBoundary(prev, active.index, point.y));
    }
  }

  // PUT /boards/:id is last-write-wins with no version, so an older response
  // landing after a newer one would push stale bands back up through
  // onMetaChanged. Only the newest save is allowed to report.
  const bandSeq = useRef(0);
  // Bumped locally on each accepted save so consecutive edits send the version
  // the server now holds, without waiting for a refetch.
  const bandVersion = useRef(meta.version ?? 0);

  /**
   * Bands live on the board meta and are replaced whole on every change, so the
   * write is version-guarded: a second tab editing the same cheat sheet would
   * otherwise silently re-tier every player. A 409 routes into the same reload
   * the layout saver already uses.
   */
  function saveBands(next: TierBand[]) {
    const prev = bands;
    const seq = ++bandSeq.current;
    setBands(next);
    void api<BoardMeta>(`/boards/${meta.id}`, {
      method: "PUT",
      body: { bands: next, version: bandVersion.current },
    })
      .then((m) => {
        bandVersion.current = m.version ?? bandVersion.current + 1;
        if (seq === bandSeq.current) onMetaChanged(m);
      })
      .catch((e) => {
        if (seq !== bandSeq.current) return;
        // Put the tiers back: a rejected save that left the new bands on screen
        // would have the user drafting against a layout the server never took.
        setBands(prev);
        if (e instanceof ApiError && e.status === 409) {
          setBandError("Tiers changed in another tab — reloading the latest.");
          onConflict();
        } else {
          setBandError("Couldn't save that tier change — try again.");
        }
      });
  }

  function onPointerUp() {
    const active = drag.current;
    drag.current = null;
    if (active?.kind === "boundary") saveBands(bands);
  }

  function splitAt(index: number) {
    const band = bands[index];
    if (!band) return;
    const next = splitBand(bands, index, (band.y0 + band.y1) / 2);
    if (next === bands) {
      setBandError("That tier is too short to split — drag its boundary down first.");
      return;
    }
    setBandError(null);
    saveBands(next);
  }

  /**
   * Rename commits on blur, so Enter and click-away take one path. Escape sets
   * this first, since closing the input also fires blur.
   */
  const renameCancelled = useRef(false);

  function commitRename(index: number) {
    setEditingLabel(null);
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const label = draftLabel.trim();
    if (!label || label === bands[index]?.label) return;
    saveBands(renameBand(bands, index, label.slice(0, 40)));
  }

  function autoArrange() {
    const next = spreadPlacements(placements);
    setPlacements(next);
    save(next);
  }

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button type="button" className="secondary" onClick={autoArrange}>
          Auto-arrange
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setBandError(null);
            saveBands(appendBand(bands));
          }}
        >
          + Add tier at bottom
        </button>
        {saving && <span className="canvas-saving muted">saving…</span>}
        {bandError && <span className="canvas-band-error">{bandError}</span>}
      </div>
      <div className="canvas-toolbar">
        <PositionFilter selected={posFilter} onChange={setPosFilter} counts={positionCounts} />
        {posFilter.size > 0 && (
          <span className="muted">
            Filtered — tier bands still span the hidden players, and dragging still saves.
          </span>
        )}
      </div>
      {/* Inline styles below are all per-element coordinates computed from live
          layout/drag state (maxY, band y0/y1, chip x/y as %); they change every
          render and every drag frame, so they cannot live in a stylesheet. */}
      <div
        ref={surfaceRef}
        className="canvas-surface"
        style={{ width: "100%", height: `${maxY * V_SCALE}px` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {bands.map((band, i) => (
          <div
            key={`band-${i}`}
            className={i % 2 === 0 ? "canvas-band" : "canvas-band canvas-band-alt"}
            style={{
              top: `${(band.y0 / maxY) * 100}%`,
              height: `${((band.y1 - band.y0) / maxY) * 100}%`,
            }}
          >
            <div className="canvas-band-head">
              {editingLabel === i ? (
                <input
                  className="canvas-band-input"
                  value={draftLabel}
                  autoFocus
                  maxLength={40}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onBlur={() => commitRename(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") renameCancelled.current = true;
                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="canvas-band-label"
                  onClick={() => {
                    setDraftLabel(band.label);
                    setEditingLabel(i);
                  }}
                  title="Rename this tier"
                >
                  {band.label}
                </button>
              )}
              <button
                type="button"
                className="canvas-band-action"
                onClick={() => splitAt(i)}
                title={`Split ${band.label} into two tiers`}
                aria-label={`Split ${band.label} into two tiers`}
              >
                +
              </button>
              {bands.length > 1 && (
                <button
                  type="button"
                  className="canvas-band-action"
                  onClick={() => saveBands(removeBand(bands, i))}
                  title={`Remove ${band.label}, merging it into the neighbouring tier`}
                  aria-label={`Remove ${band.label}`}
                >
                  ×
                </button>
              )}
            </div>
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
          if (!matchesPosition(playersById.get(id)?.position, posFilter)) return null;
          const pick = picks.get(id);
          const cls = [
            "canvas-chip",
            pick && (pick.mine ? "canvas-chip-mine" : "canvas-chip-gone"),
            !pick && splitIds.has(id) && "canvas-chip-split",
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
              data-position={playersById.get(id)?.position}
            >
              {pick?.mine && <span className="pin" aria-hidden="true" />}
              {playersById.get(id)?.name ?? id}
              <TagDots tags={tagsByPlayer?.get(id)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
