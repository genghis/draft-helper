import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tag, TagMeta } from "@drafthelper/shared";
import { api } from "../api/client";

/**
 * Loads every tag's full membership (not just its meta) so views can look up
 * a player's tags directly. Tag lists are few and small (unlike sources), so
 * fetching all of them up front is cheap.
 */
export function useTags(enabled: boolean) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const metas = await api<TagMeta[]>("/tags");
    const full = await Promise.all(metas.map((m) => api<Tag>(`/tags/${m.id}`)));
    setTags(full);
  }, []);

  useEffect(() => {
    if (enabled) refresh().catch((e) => setError(String(e)));
  }, [enabled, refresh]);

  const metas = useMemo(() => tags.map((t) => t.meta), [tags]);

  const tagsByPlayer = useMemo(() => {
    const map = new Map<string, TagMeta[]>();
    for (const tag of tags) {
      for (const playerId of tag.playerIds) {
        const list = map.get(playerId);
        if (list) list.push(tag.meta);
        else map.set(playerId, [tag.meta]);
      }
    }
    return map;
  }, [tags]);

  return { tags, metas, tagsByPlayer, error, refresh };
}
