import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tag, TagColor, TagMeta } from "@drafthelper/shared";
import { api, ApiError } from "../api/client";

/** Server cap on tag membership; mirrored here to fail with a readable message. */
const MAX_TAG_PLAYERS = 300;

/**
 * Loads every tag's full membership (not just its meta) so views can look up
 * a player's tags directly. Tag lists are few and small (unlike sources), so
 * fetching all of them up front is cheap.
 */
export function useTags(enabled: boolean) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Mutations read the latest tags through a ref so their callback identities
  // stay stable — otherwise every refresh re-renders each player surface.
  const latest = useRef<Tag[]>([]);

  // Overlapping refreshes: a slower earlier one must not overwrite the result
  // of a faster later one (the same guard draft.ts uses for its poll).
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const metas = await api<TagMeta[]>("/tags");
    const full = await Promise.all(metas.map((m) => api<Tag>(`/tags/${m.id}`)));
    if (seq !== refreshSeq.current) return latest.current;
    latest.current = full;
    setTags(full);
    return full;
  }, []);

  useEffect(() => {
    if (enabled) refresh().catch((e) => setError(String(e)));
  }, [enabled, refresh]);

  /**
   * Adds one player to a tag. The API has no single-player add — PUT replaces
   * the whole list against the version we last read — so a stale cache 409s
   * whenever two adds land close together. Refetch and retry once before
   * surfacing the failure.
   */
  const addPlayerToTag = useCallback(
    async (tagId: string, playerId: string) => {
      const attempt = async (source: Tag[]) => {
        const tag = source.find((t) => t.meta.id === tagId);
        if (!tag) throw new Error("That tag no longer exists.");
        if (tag.playerIds.includes(playerId)) return false;
        if (tag.playerIds.length >= MAX_TAG_PLAYERS) {
          throw new Error(`“${tag.meta.label}” is full (${MAX_TAG_PLAYERS} players).`);
        }
        await api(`/tags/${tagId}`, {
          method: "PUT",
          body: { playerIds: [...tag.playerIds, playerId], version: tag.meta.version },
        });
        return true;
      };
      // The write and the follow-up refresh fail differently: a failed write
      // means nothing was tagged, a failed refresh means it WAS tagged and only
      // our cache is stale. Reporting the second as the first would send the
      // user to re-add a player who is already there.
      let wrote = false;
      try {
        wrote = await attempt(latest.current);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        wrote = await attempt(await refresh());
      }
      if (wrote) await refresh().catch(() => undefined);
    },
    [refresh]
  );

  /** Quick-create a tag seeded with one player; the API rejects empty tags. */
  const createTagWithPlayer = useCallback(
    async (label: string, color: TagColor, playerId: string) => {
      const meta = await api<TagMeta>("/tags", {
        method: "POST",
        body: { label, color, playerIds: [playerId] },
      });
      await refresh();
      return meta;
    },
    [refresh]
  );

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

  return { tags, metas, tagsByPlayer, error, refresh, addPlayerToTag, createTagWithPlayer };
}

export type TagsState = ReturnType<typeof useTags>;
