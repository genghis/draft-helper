import { useEffect, useState } from "react";
import type { BoardLayout, BoardMeta, Player } from "@drafthelper/shared";
import { api } from "../api/client";
import { useDraft } from "../state/draft";
import { TierListView } from "./TierListView";
import "./BoardsView.css";

interface Props {
  boards: BoardMeta[];
  playersById: Map<string, Player>;
  onImport: () => void;
  onBoardDeleted: (id: string) => void;
}

export function BoardsView({ boards, playersById, onImport, onBoardDeleted }: Props) {
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null);
  const [board, setBoard] = useState<{ meta: BoardMeta; layout: BoardLayout } | null>(null);
  const draft = useDraft();

  useEffect(() => {
    if (activeId === null && boards[0]) setActiveId(boards[0].id);
    if (activeId && !boards.some((b) => b.id === activeId)) {
      setActiveId(boards[0]?.id ?? null);
    }
  }, [boards, activeId]);

  useEffect(() => {
    if (!activeId) {
      setBoard(null);
      return;
    }
    api<{ meta: BoardMeta; layout: BoardLayout }>(`/boards/${activeId}`).then(setBoard);
  }, [activeId]);

  async function removeBoard(id: string) {
    if (!window.confirm("Delete this board?")) return;
    await api(`/boards/${id}`, { method: "DELETE" });
    onBoardDeleted(id);
  }

  async function resetDraft() {
    if (!window.confirm("Clear every drafted mark? (Start of a new mock/draft.)")) return;
    await draft.reset();
  }

  if (boards.length === 0) {
    return (
      <section className="boards-empty">
        <p>No boards yet — import your first tiers to get started.</p>
        <button type="button" onClick={onImport}>
          Import rankings
        </button>
      </section>
    );
  }

  return (
    <section className="boards-view">
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
        <button type="button" className="board-tab board-tab-add" onClick={onImport}>
          + Import
        </button>
      </nav>
      {board && (
        <>
          <div className="board-toolbar">
            <span className="muted">
              Tap a player when they're drafted; tap again to undo.
            </span>
            <span className="board-toolbar-actions">
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
          <TierListView
            meta={board.meta}
            layout={board.layout}
            playersById={playersById}
            picks={draft.picks}
            onMark={draft.mark}
            onUnmark={draft.unmark}
          />
        </>
      )}
    </section>
  );
}
