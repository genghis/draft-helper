# Draft Helper

Fantasy football draft-day assistant: import Boris Chen (or any) tiers onto a 2D
board, run your live ESPN draft against it with auto-synced picks, manual
tap-off as the always-working fallback.

Full plan and scope: see `docs/` (or the session plan). Monorepo layout:

| Package | What |
|---|---|
| `packages/shared` | Pure TS: types, parsers, name matching, tier⇄canvas math |
| `packages/backend` | Hono app on Lambda (`src/lambda.ts`) + players-refresh Lambda (`src/players/refresh.ts`) |
| `packages/frontend` | Vite + React SPA |
| `packages/infra` | CDK — one stack (`DraftHelperStack`) |

## Commands

```sh
pnpm typecheck        # tsc --noEmit in every package
pnpm test             # vitest where present
pnpm build            # builds frontend (dist/ picked up by CDK deploy)
pnpm synth            # cdk synth --quiet
```

## One-time AWS setup

1. Session-cookie signing secret (SecureString can't be made by CloudFormation):

   ```sh
   aws ssm put-parameter --name /drafthelper/session-secret \
     --type SecureString --value "$(openssl rand -hex 32)"
   ```

2. Deploy: `pnpm --filter @drafthelper/infra deploy` (build the frontend first
   so the SPA is included).

3. Populate `players.json` once (also runs weekly on a schedule):

   ```sh
   aws lambda invoke --function-name <PlayersRefreshFunction output> /dev/null
   ```

4. Seed users and hand out invite links:

   ```sh
   cd packages/backend
   TABLE_NAME=<TableName output> APP_URL=https://draft.clanseafox.com \
     node scripts/seed-user.ts "Display Name"
   ```

## Notes

- Auth is invite-link only: the link sets a long-lived signed httpOnly cookie.
  No passwords, nothing to forget on draft day.
- The API sits behind CloudFront at `/api/*` on the same domain (no CORS).
  Requests with bodies must send `x-amz-content-sha256` (the frontend
  `api/client.ts` does this) because the CloudFront→Lambda OAC signs payloads.
- ESPN cookies (`espn_s2`/`SWID`) are user-supplied secrets stored in DynamoDB —
  keep them out of logs.
