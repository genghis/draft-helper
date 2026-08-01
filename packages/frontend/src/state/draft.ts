import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftOrder, DraftState, DraftSync, Pick } from "@drafthelper/shared";
import { deriveOrder, emptyOrder } from "@drafthelper/shared";
import { api } from "../api/client";

const POLL_MS = 5000;
/** Seat names are typed, so coalesce keystrokes into one write. */
const ORDER_SAVE_DEBOUNCE_MS = 400;

interface Options {
  /** Refetch every few seconds while the tab is visible (draft-day mode). */
  poll?: boolean;
  /** Skip the initial fetch and the poll while false (e.g. not signed in yet). */
  enabled?: boolean;
}

/** The user's picks (their one implicit draft), with optimistic updates. */
export function useDraft({ poll = false, enabled = true }: Options = {}) {
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());
  const [sync, setSync] = useState<DraftSync>({ lastPushAt: null });
  const [order, setOrderState] = useState<DraftOrder | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  // Mirrors `order` so a save can roll back to the value it replaced without
  // depending on a stale closure.
  const orderRef = useRef<DraftOrder | null>(null);
  // Player ids this session marked, most recent last; undoLast pops it.
  const undoStack = useRef<string[]>([]);
  const [lastMarked, setLastMarked] = useState<string | null>(null);
  // Count of optimistic writes in flight; the poll skips while any are pending
  // so a refetch can't resurrect a just-deleted pick (or drop a just-marked one).
  const inflight = useRef(0);

  const refresh = useCallback(async () => {
    if (inflight.current > 0) return;
    const state = await api<DraftState>("/draft");
    if (inflight.current > 0) return; // a write started while we were fetching
    setPicks(new Map(state.picks.map((p) => [p.playerId, p])));
    setSync(state.sync);
    setOrderState(state.order ?? null);
    orderRef.current = state.order ?? null;
  }, []);

  const track = useCallback(async (op: Promise<unknown>) => {
    inflight.current++;
    try {
      await op;
    } finally {
      inflight.current--;
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!poll || !enabled) return;
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
    await track(api(`/draft/picks/${playerId}`, { method: "PUT", body: { mine } }));
  }, [track]);

  const unmark = useCallback(async (playerId: string) => {
    setPicks((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      return next;
    });
    undoStack.current = undoStack.current.filter((id) => id !== playerId);
    setLastMarked(undoStack.current[undoStack.current.length - 1] ?? null);
    await track(api(`/draft/picks/${playerId}`, { method: "DELETE" }));
  }, [track]);

  /** Undo the most recent mark made in this session. */
  const undoLast = useCallback(async () => {
    const playerId = undoStack.current[undoStack.current.length - 1];
    if (playerId !== undefined) await unmark(playerId);
  }, [unmark]);

  const reset = useCallback(async () => {
    setPicks(new Map());
    undoStack.current = [];
    setLastMarked(null);
    await track(api("/draft", { method: "DELETE" }));
  }, [track]);

  const orderSeq = useRef(0);
  const orderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (orderTimer.current) clearTimeout(orderTimer.current);
  }, []);

  /**
   * Applies an order change optimistically, then writes it once the edits stop.
   * PUT /draft/order is last-write-wins with no version, and seat names are
   * typed — so an un-debounced write per keystroke lets a slow early response
   * land after a fast later one and silently revert what was typed. The
   * sequence guard drops any save a newer edit has already superseded.
   *
   * Resolves either way: callers (including the auto-derive effect) fire and
   * forget, and an unhandled rejection would be invisible mid-draft. A failed
   * write leaves the optimistic value on screen with an error beside it; the
   * 5s poll then reconciles against the server.
   */
  const saveOrder = useCallback(
    async (next: DraftOrder) => {
      setOrderState(next);
      orderRef.current = next;
      setOrderError(null);
      const seq = ++orderSeq.current;
      if (orderTimer.current) clearTimeout(orderTimer.current);
      await new Promise<void>((resolve) => {
        orderTimer.current = setTimeout(resolve, ORDER_SAVE_DEBOUNCE_MS);
      });
      if (seq !== orderSeq.current) return;
      try {
        await track(api("/draft/order", { method: "PUT", body: next }));
      } catch {
        if (seq === orderSeq.current) {
          setOrderError("Couldn't save the draft order — retrying on the next sync.");
        }
      }
    },
    [track]
  );

  // Round 1's live ESPN picks reveal the seat order, so fill it in as they
  // arrive. Only persists when something was actually learned — deriveOrder
  // returns its input unchanged otherwise, which keeps this out of a loop.
  useEffect(() => {
    if (!enabled || order === null) return;
    const derived = deriveOrder([...picks.values()], order);
    if (derived !== order) void saveOrder(derived);
  }, [enabled, picks, order, saveOrder]);

  return {
    picks,
    sync,
    order,
    orderError,
    saveOrder,
    /** Creates a default order on first use; the app has none until then. */
    startOrder: useCallback((teamCount: number) => saveOrder(emptyOrder(teamCount)), [saveOrder]),
    mark,
    unmark,
    undoLast,
    lastMarked,
    refresh,
    reset,
  };
}

export type DraftController = ReturnType<typeof useDraft>;
