import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardLayout, BoardMeta } from "@drafthelper/shared";
import { api } from "../api/client";

export interface BoardLayouts {
  layouts: Map<string, BoardLayout>;
  /** Patches one board's layout in place — called after a save/edit so ranks
   * derived from these layouts (handcuff, best-available, search) stay fresh. */
  setLayout: (boardId: string, layout: BoardLayout) => void;
}

/** Fetches every board's layout — used by draft day (best-available) and the
 * handcuff auto-tagger, both of which need ranks regardless of active tab. */
export function useAllBoardLayouts(boards: BoardMeta[]): BoardLayouts {
  const [layouts, setLayouts] = useState<Map<string, BoardLayout>>(new Map());
  const boardIdsKey = useMemo(() => boards.map((b) => b.id).join(","), [boards]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      boards.map((b) =>
        api<{ meta: BoardMeta; layout: BoardLayout }>(`/boards/${b.id}`).then(
          (r) => [b.id, r.layout] as const
        )
      )
    ).then((entries) => {
      if (!cancelled) setLayouts(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardIdsKey]);

  const setLayout = useCallback((boardId: string, layout: BoardLayout) => {
    setLayouts((prev) => new Map(prev).set(boardId, layout));
  }, []);

  return { layouts, setLayout };
}
