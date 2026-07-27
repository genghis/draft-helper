import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardLayout, Placement } from "@drafthelper/shared";
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
  onConflict: () => void,
  onSaved?: (layout: BoardLayout) => void
) {
  const version = useRef(initialVersion);
  const pending = useRef<Record<string, Placement> | null>(null);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    version.current = initialVersion;
  }, [boardId, initialVersion]);

  // One PUT at a time. Overlapping writes would send a stale version and
  // trigger a spurious 409 against our own edit (rapid drag → auto-arrange);
  // draining a pending queue keeps version.current in sync between writes.
  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSaving(true);
    try {
      while (pending.current) {
        const placements = pending.current;
        pending.current = null;
        try {
          const res = await api<{ version: number }>(`/boards/${boardId}/layout`, {
            method: "PUT",
            body: { placements, version: version.current },
          });
          version.current = res.version;
          onSaved?.({ placements, version: res.version });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            pending.current = null;
            onConflict();
            break;
          }
          throw err;
        }
      }
    } finally {
      running.current = false;
      setSaving(false);
    }
  }, [boardId, onConflict, onSaved]);

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
