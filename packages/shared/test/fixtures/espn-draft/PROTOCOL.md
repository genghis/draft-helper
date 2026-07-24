# ESPN draft-room websocket protocol (observed 2026-07-24)

Captured live from a league-specific practice draft (4-team, snake). Practice
drafts use the real draft-room software, so this is the same protocol as a real
league draft. `messages.txt` holds verbatim frames from that session
(SWID scrubbed).

## Connection

- Room URL (extension `matches` pattern): `https://fantasy.espn.com/football/draft?leagueId=...&seasonId=...&teamId=...&memberId={SWID}` — identical for practice and real drafts; `teamId` in the query is the viewer's own team.
- Socket: `wss://fantasydraft.espn.com/game-1/league-{leagueId}/JOIN?...` — query carries 8 positional numeric params plus `nocache`. One of them corresponds to the numeric token returned by `GET lm-api-reads.../leagues/{leagueId}/teams/{teamId}/draftSecurity` (plain number in the body, e.g. `-118435305`).
- Frames are **plain text**, one command per frame, newline-terminated, space-delimited fields. No JSON, no binary (except the INIT payload blob).

## Messages (server → client)

| Frame | Meaning |
|---|---|
| `INIT <blob>` | Sent once after join. ~11 KB base64-ish blob; big-endian int32 stream (leagueId visible in it). Full state snapshot — **not decoded**; catch-up uses the DOM picks-rail rescan instead. |
| `TOKEN 1:<leagueId>:<teamId>:<SWID>:<n>` | Session/identity echo after join. |
| `JOINED <teamId> <SWID>` | A manager joined. |
| `SELECTING <teamId> <clockMs>` | Team is on the clock (clock duration in ms). |
| `SELECTED <teamId> <espnPlayerId> <lineupSlotId>` | **A pick was made.** Negative playerIds are D/ST (ESPN's negative team-id convention). No overall pick number — order = arrival order; missed history recovered from the DOM rail. |
| `AUTOSUGGEST <espnPlayerId>` | Server's suggested pick for the viewer. |
| `CLOCK <seq?> <msRemaining> <teamId>` | Clock tick. |
| `AUTODRAFT <teamId> <bool>` | Autopick toggle state change. |
| `PONG` | Reply to client `PING`. |

## Messages (client → server)

- `PING PING%20<epochMs>` periodically (URL-encoded space).
- Pick submission not captured (all-autopick session) — not needed by the extension (read-only observer).

## Extension implications

- Parse rule: split frame on whitespace; switch on first token; only `SELECTED` matters for sync (plus `SELECTING`/`CLOCK` for optional on-the-clock UI).
- `mine` = `SELECTED.teamId === teamId` from the room URL query.
- Catch-up after late join / SW restart: re-scan the picks rail DOM — pick rows expose espn playerIds via headshot `<img>` URLs matching `/headshots/nfl/players/full/{espnPlayerId}.png` (negative-id D/ST have no headshot: fall back to name matching for DST only, or count on SELECTED replay).
- The room page sets `beforeunload` (Leave site? dialog) — reloading mid-draft is safe; the draft continues server-side and the room resyncs (INIT) on rejoin.
- Practice leagues are ephemeral: torn down (404 from lm-api-reads) shortly after the draft ends. Don't build tests that depend on them persisting.

## Open item

Full-length mid-draft `INIT` blob was not retained (only the first 6 KB of a
pre-draft one). The extension's frame logger should stash one during the
mid-August rehearsal in case INIT decoding ever becomes worthwhile.
