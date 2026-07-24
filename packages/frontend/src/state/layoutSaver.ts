import { useCallback, useEffect, useRef, useState } from "react";
import type { Placement } from "@drafthelper/shared";
import { api, ApiError } from "../api/client";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Debounced, versioned layout persistence. On a 409 (another tab saved first)
 * the local delta is dropped and the caller reloads the server copy — this is
 * a single-editor app, so "reload latest" beats merge machinery.
 */
export function useLayoutSaver(
  boardId: string,
  initialVersion: number,
  onConflict: () => void
) {
  const version = useRef(initialVersion);
  const pending = useRef<Record<string, Placement> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    version.current = initialVersion;
  }, [boardId, initialVersion]);

  const flush = useCallback(async () => {
    const placements = pending.current;
    if (!placements) return;
    pending.current = null;
    setSaving(true);
    try {
      const res = await api<{ version: number }>(`/boards/${boardId}/layout`, {
        method: "PUT",
        body: { placements, version: version.current },
      });
      version.current = res.version;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        pending.current = null;
        onConflict();
      } else {
        throw err;
      }
    } finally {
      setSaving(false);
    }
  }, [boardId, onConflict]);

  const save = useCallback(
    (placements: Record<string, Placement>) => {
      pending.current = placements;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { save, saving };
}
