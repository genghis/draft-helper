import { useCallback, useEffect, useState } from "react";
import type { Pick } from "@drafthelper/shared";
import { api } from "../api/client";

/** The user's picks (their one implicit draft), with optimistic updates. */
export function useDraft() {
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());

  useEffect(() => {
    api<Pick[]>("/draft").then((list) =>
      setPicks(new Map(list.map((p) => [p.playerId, p])))
    );
  }, []);

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
    await api(`/draft/picks/${playerId}`, { method: "PUT", body: { mine } });
  }, []);

  const unmark = useCallback(async (playerId: string) => {
    setPicks((prev) => {
      const next = new Map(prev);
      next.delete(playerId);
      return next;
    });
    await api(`/draft/picks/${playerId}`, { method: "DELETE" });
  }, []);

  const reset = useCallback(async () => {
    setPicks(new Map());
    await api("/draft", { method: "DELETE" });
  }, []);

  return { picks, mark, unmark, reset };
}
