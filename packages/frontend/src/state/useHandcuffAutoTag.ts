import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardLayout, BoardMeta, Pick, Player, TagMeta } from "@drafthelper/shared";
import {
  boardAdpRanks,
  computeHandcuffIds,
  primaryAdp,
  reconcileHandcuffTag,
} from "@drafthelper/shared";
import { api } from "../api/client";
import type { AdpLookup } from "./adp";
import type { useTags } from "./tags";

const TOAST_MS = 5000;

export interface HandcuffToast {
  addedNames: string[];
  leadName: string;
  addedIds: string[];
  tagId: string;
}

interface Args {
  enabled: boolean;
  picks: Map<string, Pick>;
  players: Player[];
  playersById: Map<string, Player>;
  boards: BoardMeta[];
  layouts: Map<string, BoardLayout>;
  adp: AdpLookup;
  tags: ReturnType<typeof useTags>;
}

/**
 * Auto-tags a drafted RB's backup(s) with a "Handcuffs" tag. Fires regardless
 * of which tab is open (picks/layouts are lifted to App), so it stays in sync
 * whether you mark "Mine" from the Sortings tier list or the Draft day search.
 */
export function useHandcuffAutoTag({
  enabled,
  picks,
  players,
  playersById,
  boards,
  layouts,
  adp,
  tags,
}: Args) {
  const [toast, setToast] = useState<HandcuffToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const signatureRef = useRef<string | null>(null);
  // Guards against two overlapping persist() calls both reading "no handcuff
  // tag yet" and each creating one. While locked, a run bails without
  // recording its signature, so the next real pick change retries it.
  const persistingRef = useRef(false);

  // Ordinal RB rank: prefer an RB-scoped board, else RB-filtered OVERALL board,
  // else ADP. Board-ranked players always sort ahead of ADP-only ones.
  const rankById = useMemo(() => {
    const rbBoard = boards.find((b) => b.position === "RB" && layouts.has(b.id));
    const overallBoard = boards.find((b) => b.position === "OVERALL" && layouts.has(b.id));
    const board = rbBoard ?? overallBoard;

    let boardRanks = new Map<string, number>();
    if (board) {
      const layout = layouts.get(board.id)!;
      const metricById = new Map<string, number>();
      for (const [id, placement] of Object.entries(layout.placements)) {
        if (playersById.get(id)?.position === "RB") metricById.set(id, placement.y);
      }
      boardRanks = boardAdpRanks(metricById);
    }

    const scoring = board?.scoring ?? "PPR";
    const adpMetric = new Map<string, number>();
    for (const p of players) {
      if (p.position !== "RB" || boardRanks.has(p.id)) continue;
      const v = primaryAdp(adp.forPlayer(scoring, p.id));
      if (v != null) adpMetric.set(p.id, v);
    }
    const adpRanks = boardAdpRanks(adpMetric);
    const offset = boardRanks.size > 0 ? Math.max(...boardRanks.values()) : 0;

    const merged = new Map(boardRanks);
    for (const [id, r] of adpRanks) merged.set(id, r + offset);
    return merged;
  }, [players, playersById, boards, layouts, adp]);

  const myRbIds = useMemo(() => {
    const ids = [...picks.values()]
      .filter((p) => p.mine && playersById.get(p.playerId)?.position === "RB")
      .map((p) => p.playerId);
    ids.sort();
    return ids;
  }, [picks, playersById]);

  function showToast(addedIds: string[], tagId: string) {
    const addedNames = addedIds.map((id) => playersById.get(id)?.name ?? id);
    const addedTeam = playersById.get(addedIds[0]!)?.team;
    const lead = myRbIds.map((id) => playersById.get(id)).find((p) => p?.team === addedTeam);
    clearTimeout(toastTimer.current);
    setToast({ addedNames, leadName: lead?.name ?? "your pick", addedIds, tagId });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  useEffect(() => {
    if (!enabled) return;
    if (layouts.size === 0 && !adp.loaded) return;
    if (persistingRef.current) return;
    const draftedIds = new Set(picks.keys());
    const rankFingerprint = [...rankById.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, r]) => `${id}:${r}`)
      .join(",");
    const signature = `${myRbIds.join(",")}|${[...draftedIds].sort().join(",")}|${rankFingerprint}`;
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;

    const computedIds = computeHandcuffIds({ myRbIds, players, rankById, draftedIds });
    const existing = tags.tags.find((t) => t.meta.autoManaged === "handcuff") ?? null;
    const result = reconcileHandcuffTag(existing, computedIds);

    async function persist() {
      persistingRef.current = true;
      try {
        if (!existing) {
          if (result.playerIds.length === 0) return;
          const meta = await api<TagMeta>("/tags", {
            method: "POST",
            body: {
              label: "Handcuffs",
              color: "amber",
              playerIds: result.playerIds,
              autoManaged: "handcuff",
              autoAddedIds: result.autoAddedIds,
              autoExcludedIds: [],
            },
          });
          await tags.refresh();
          if (result.added.length > 0) showToast(result.added, meta.id);
        } else if (result.added.length > 0 || result.removed.length > 0) {
          await api(`/tags/${existing.meta.id}`, {
            method: "PUT",
            body: {
              playerIds: result.playerIds,
              autoAddedIds: result.autoAddedIds,
              autoExcludedIds: result.autoExcludedIds,
              version: existing.meta.version,
            },
          });
          await tags.refresh();
          if (result.added.length > 0) showToast(result.added, existing.meta.id);
        }
      } catch (e) {
        // Failed write (network error, or a 409 from a concurrent editor):
        // clear the signature so a future pick change retries instead of
        // treating this recompute as permanently settled.
        signatureRef.current = null;
        console.error("handcuff auto-tag failed", e);
      } finally {
        persistingRef.current = false;
      }
    }

    void persist();
    // Deliberately re-run only on the derived signature (guarded above), not
    // on `tags` identity — tags.refresh() must not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, myRbIds, picks, rankById, layouts, adp.loaded, players]);

  function dismissToast() {
    clearTimeout(toastTimer.current);
    setToast(null);
  }

  async function undo() {
    if (!toast) return;
    const existing = tags.tags.find((t) => t.meta.id === toast.tagId);
    if (existing) {
      const addedSet = new Set(toast.addedIds);
      const autoExcludedIds = [
        ...new Set([...(existing.autoExcludedIds ?? []), ...toast.addedIds]),
      ];
      try {
        await api(`/tags/${existing.meta.id}`, {
          method: "PUT",
          body: {
            playerIds: existing.playerIds.filter((id) => !addedSet.has(id)),
            autoAddedIds: (existing.autoAddedIds ?? []).filter((id) => !addedSet.has(id)),
            autoExcludedIds,
            version: existing.meta.version,
          },
        });
        await tags.refresh();
      } catch (e) {
        console.error("handcuff undo failed", e);
      }
    }
    dismissToast();
  }

  return { toast, dismissToast, undo };
}
