import { useEffect, useMemo, useState } from "react";
import type { Player } from "@drafthelper/shared";

interface PlayersFile {
  updatedAt: string;
  players: Player[];
}

/** Loads the static players.json published by the refresh Lambda. */
export function usePlayers() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/players.json")
      .then((r) => {
        if (!r.ok) throw new Error(`players.json: ${r.status}`);
        return r.json() as Promise<PlayersFile>;
      })
      .then((f) => setPlayers(f.players))
      .catch((e) => setError(String(e)));
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players ?? []) map.set(p.id, p);
    return map;
  }, [players]);

  return { players, byId, error };
}
