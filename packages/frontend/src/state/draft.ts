import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftState, DraftSync, Pick } from "@drafthelper/shared";
import { api } from "../api/client";

const POLL_MS = 5000;

interface Options {
  /** Refetch every few seconds while the tab is visible (draft-day mode). */
  poll?: boolean;
}

/** The user's picks (their one implicit draft), with optimistic updates. */
export function useDraft({ poll = false }: Options = {}) {
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());
  const [sync, setSync] = useState<DraftSync>({ lastPushAt: null });
  // Player ids this session marked, most recent last; undoLast pops it.
  const undoStack = useRef<string[]>([]);
  const [lastMarked, setLastMarked] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const state = await api<DraftState>("/draft");
    setPicks(new Map(state.picks.map((p) => [p.playerId, p])));
    setSync(state.sync);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!poll) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll, refresh]);

  const mark = useCallback(async (playerId: string, mine: boolean) => {
    setPicks((prev) => {
      const next = new Map(prev);
      next.set(playerId, {
        playerId,
        mine,
        source: "manual",
        pickedAt: new Date().toISOString(),
      });
      return next;
    });
    undoStack.current.push(playerId);
    setLastMarked(playerId);
    await api(`/draft/picks/${playerId}`, { method: "PUT", body: { mine } });
  }, []);

  const unmark = useCallback(async (playerId: string) => {
    setPicks((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      return next;
    });
    undoStack.current = undoStack.current.filter((id) => id !== playerId);
    setLastMarked(undoStack.current[undoStack.current.length - 1] ?? null);
    await api(`/draft/picks/${playerId}`, { method: "DELETE" });
  }, []);

  /** Undo the most recent mark made in this session. */
  const undoLast = useCallback(async () => {
    const playerId = undoStack.current[undoStack.current.length - 1];
    if (playerId !== undefined) await unmark(playerId);
  }, [unmark]);

  const reset = useCallback(async () => {
    setPicks(new Map());
    undoStack.current = [];
    setLastMarked(null);
    await api("/draft", { method: "DELETE" });
  }, []);

  return { picks, sync, mark, unmark, undoLast, lastMarked, refresh, reset };
}
