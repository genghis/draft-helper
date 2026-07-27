import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoardAgreement,
  BoardLayout,
  BoardMeta,
  Player,
  SourceMeta,
  TagMeta,
} from "@drafthelper/shared";
import { api } from "../api/client";
import type { AdpLookup } from "../state/adp";
import type { DraftController } from "../state/draft";
import { BoardCanvas } from "./BoardCanvas";
import { NewSortingModal } from "./NewSortingModal";
import { TierListView } from "./TierListView";
import "./BoardsView.css";

interface Props {
  boards: BoardMeta[];
  sources: SourceMeta[];
  playersById: Map<string, Player>;
  adp: AdpLookup;
  tagsByPlayer: Map<string, TagMeta[]>;
  draft: DraftController;
  onLayoutChanged?: (boardId: string, layout: BoardLayout) => void;
  onSortingCreated: (board: BoardMeta) => void;
  onBoardDeleted: (id: string) => void;
}

export function BoardsView({
  boards,
  sources,
  playersById,
  adp,
  tagsByPlayer,
  draft,
  onLayoutChanged,
  onSortingCreated,
  onBoardDeleted,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null);
  const [board, setBoard] = useState<{
    meta: BoardMeta;
    layout: BoardLayout;
    agreement?: BoardAgreement;
  } | null>(null);
  const [mode, setMode] = useState<"list" | "canvas">("list");
  const [conflictNotice, setConflictNotice] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (activeId === null && boards[0]) setActiveId(boards[0].id);
    if (activeId && !boards.some((b) => b.id === activeId)) {
      setActiveId(boards[0]?.id ?? null);
    }
  }, [boards, activeId]);

  // Last-requested wins: a slower response for a previously-active board must
  // not overwrite the board the user has since switched to.
  const loadSeq = useRef(0);
  const loadBoard = useCallback(() => {
    if (!activeId) {
      setBoard(null);
      return;
    }
    const seq = ++loadSeq.current;
    api<{ meta: BoardMeta; layout: BoardLayout; agreement?: BoardAgreement }>(
      `/boards/${activeId}`
    ).then((b) => {
      if (seq === loadSeq.current) {
        setBoard(b);
        onLayoutChanged?.(activeId, b.layout);
      }
    });
  }, [activeId, onLayoutChanged]);

  useEffect(loadBoard, [loadBoard]);

  const onConflict = useCallback(() => {
    setConflictNotice(true);
    loadBoard();
  }, [loadBoard]);

  async function removeBoard(id: string) {
    if (!window.confirm("Delete this board?")) return;
    await api(`/boards/${id}`, { method: "DELETE" });
    onBoardDeleted(id);
  }

  async function resetDraft() {
    if (!window.confirm("Clear every drafted mark? (Start of a new mock/draft.)")) return;
    await draft.reset();
  }

  const newSortingModal = showNew && (
    <NewSortingModal
      sources={sources}
      onCreated={(b) => {
        setShowNew(false);
        setActiveId(b.id);
        onSortingCreated(b);
      }}
      onClose={() => setShowNew(false)}
    />
  );

  if (boards.length === 0) {
    return (
      <section className="boards-empty">
        <p>No sortings yet — build one from your ranking sources.</p>
        <button type="button" onClick={() => setShowNew(true)}>
          New sorting
        </button>
        {newSortingModal}
      </section>
    );
  }

  return (
    <section className="boards-view">
      {newSortingModal}
      <nav className="board-tabs">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className={b.id === activeId ? "board-tab board-tab-active" : "board-tab"}
            onClick={() => setActiveId(b.id)}
          >
            {b.name}
          </button>
        ))}
        <button type="button" className="board-tab board-tab-add" onClick={() => setShowNew(true)}>
          + New sorting
        </button>
      </nav>
      {conflictNotice && (
        <p className="app-error">
          Board was updated elsewhere — reloaded the latest version.{" "}
          <button type="button" className="secondary" onClick={() => setConflictNotice(false)}>
            Dismiss
          </button>
        </p>
      )}
      {board && (
        <>
          <div className="board-toolbar">
            <span className="muted">
              {board.meta.seededBy && (
                <span className="board-provenance">
                  {board.meta.seededBy === "consensus"
                    ? `consensus of ${board.meta.sourceIds?.length ?? 0} sources`
                    : "from 1 source"}
                </span>
              )}
              {mode === "list"
                ? "Tap a player when they're drafted; tap again to undo."
                : "Drag players to rearrange; drag dashed lines to move tier breaks."}
            </span>
            <span className="board-toolbar-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setMode(mode === "list" ? "canvas" : "list")}
              >
                {mode === "list" ? "Canvas view" : "List view"}
              </button>
              <button type="button" className="secondary" onClick={resetDraft}>
                Reset draft
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => removeBoard(board.meta.id)}
              >
                Delete board
              </button>
            </span>
          </div>
          {mode === "list" ? (
            <TierListView
              meta={board.meta}
              layout={board.layout}
              agreement={board.agreement}
              playersById={playersById}
              adp={adp}
              tagsByPlayer={tagsByPlayer}
              picks={draft.picks}
              onMark={draft.mark}
              onUnmark={draft.unmark}
            />
          ) : (
            <BoardCanvas
              // Include the layout version so a conflict-triggered reload
              // remounts with fresh placements instead of keeping stale local state.
              key={`${board.meta.id}:${board.layout.version}`}
              meta={board.meta}
              layout={board.layout}
              agreement={board.agreement}
              playersById={playersById}
              tagsByPlayer={tagsByPlayer}
              picks={draft.picks}
              onMetaChanged={(meta) => setBoard((prev) => (prev ? { ...prev, meta } : prev))}
              onConflict={onConflict}
              onLayoutChanged={onLayoutChanged}
            />
          )}
        </>
      )}
    </section>
  );
}
