import { useEffect, useMemo, useState } from "react";
import type { AdpFile, AdpForPlayer, ScoringFormat } from "@drafthelper/shared";

const EMPTY_FFC: Record<ScoringFormat, Record<string, number>> = { STD: {}, HALF: {}, PPR: {} };

export interface AdpLookup {
  loaded: boolean;
  /** ADP for a player in a scoring format: ESPN (format-agnostic) + FFC. */
  forPlayer: (scoring: ScoringFormat, playerId: string) => AdpForPlayer;
}

/** Loads the static adp.json published by the refresh Lambda. */
export function useAdp(): AdpLookup {
  const [file, setFile] = useState<AdpFile | null>(null);

  useEffect(() => {
    fetch("/adp.json")
      .then((r) => (r.ok ? (r.json() as Promise<AdpFile>) : null))
      .then(setFile)
      .catch(() => setFile(null)); // ADP is optional; absence just hides the lens
  }, []);

  return useMemo(() => {
    const espn = file?.espn ?? {};
    const ffc = file?.ffc ?? EMPTY_FFC;
    return {
      loaded: file !== null,
      forPlayer: (scoring, playerId) => ({
        espn: espn[playerId],
        ffc: ffc[scoring]?.[playerId],
      }),
    };
  }, [file]);
}
