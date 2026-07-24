# Chrome Web Store submission — Draft Helper Sync

Everything needed to publish the extension as an **Unlisted** listing (shareable
by link, not searchable). One-time $5 developer registration required at
<https://chrome.google.com/webstore/devconsole>.

## 0. Build the upload package

```
pnpm --filter @drafthelper/extension build
cd packages/extension/dist && zip -r ../draft-helper-sync.zip . -x '.*'
```

Upload `packages/extension/draft-helper-sync.zip`. `manifest.json` must sit at
the **root** of the zip (hence zipping `dist`'s contents, not the `dist`
folder). Re-run this whenever the code changes; bump `version` in
`manifest.json` first (the store rejects re-uploads at the same version).

## 1. Store listing

| Field | Value |
|---|---|
| **Name** | Draft Helper Sync |
| **Summary** (≤132 chars) | Mirrors your ESPN fantasy football draft picks onto your Draft Helper board, live, as they happen. |
| **Category** | Sports |
| **Language** | English (United States) |
| **Visibility** | **Unlisted** |

**Description:**

> Draft Helper Sync keeps your Draft Helper board in sync with your ESPN
> fantasy football draft. While you're in your ESPN draft room, it marks each
> pick on your board the instant it happens — so your tiers, best-available
> list, and "who's gone" view stay current without you touching anything.
>
> You'll need a Draft Helper account and the sync token from your Settings page
> (paste it into the extension once). The extension only runs on ESPN draft
> pages and only talks to your Draft Helper app — no tracking, no ads, no other
> sites.
>
> Not in a draft? The Draft Helper web app still works on its own with one-tap
> manual marking; this extension just automates it for ESPN drafts.

## 2. Privacy tab (required fields)

- **Single purpose:** "Mirror the user's ESPN fantasy draft picks onto their
  own Draft Helper board in real time."
- **Privacy policy URL:** `https://draft.clanseafox.com/privacy.html`
- **Permission justifications** (paste each verbatim):

| Item | Justification |
|---|---|
| `storage` | Stores the user's Draft Helper sync token and the last-sync timestamp locally so the extension can authenticate to the Draft Helper API. |
| `host_permissions` → `https://draft.clanseafox.com/*` | The extension's only network destination: it POSTs observed draft picks to the user's Draft Helper API on this domain. |
| Content script on `https://fantasy.espn.com/football/draft*` | Reads draft picks as they occur in the user's own ESPN draft room. This is the core function; the script is inactive on all other pages. |
| Remote code | None. All scripts are bundled in the package; nothing is fetched and executed at runtime. |

- **Data usage disclosures** — check only:
  - *"Website content"* → the extension handles draft picks (player, pick
    number, team) read from the ESPN draft page.
  - *"Authentication information"* → the Draft Helper sync token.
  - Certify: **not** sold to third parties, **not** used for anything unrelated
    to the single purpose, **not** used for creditworthiness/lending.

## 3. Graphics

- **Store icon:** `dist/icons/icon128.png` (128×128, included).
- **Screenshots:** at least one 1280×800 or 640×400 PNG required. Suggested:
  the extension options page (token + Test connection) and the Draft Day view
  mid-sync. Capture at the target size or resize with `sips -z 800 1280 in.png`.

## 4. After approval

Review is typically a few days but can run longer. Share the resulting
Unlisted install link with league mates. Each person still generates their own
token in Draft Helper → Settings and pastes it into the extension.

## Notes / decisions

- **Unlisted, not Public:** private to people with the link; avoids a public,
  searchable listing for a single-league tool.
- **No ESPN branding** in the name, description, or icon — describe the function
  generically to avoid a trademark rejection.
- The manifest is already minimal: `storage` + one host permission + one
  content-script match. Don't add permissions without a matching justification
  above, or review will flag it.
