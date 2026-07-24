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
| **Summary** (≤132 chars) | Mirrors your online fantasy football draft picks onto your Draft Helper board, live, as they happen. |
| **Category** | Sports |
| **Language** | English (United States) |
| **Visibility** | **Unlisted** |

**Description:**

> Draft Helper Sync keeps your Draft Helper board in sync with your online
> fantasy football draft. While you're in your league's draft room, it marks
> each pick on your board the instant it happens — so your tiers,
> best-available list, and "who's gone" view stay current without you touching
> anything.
>
> You'll need a Draft Helper account and the sync token from your Settings page
> (paste it into the extension once). The extension only runs on your draft
> page and only talks to your Draft Helper app — no tracking, no ads, no other
> sites.
>
> Not in a draft? The Draft Helper web app still works on its own with one-tap
> manual marking; this extension just automates it during your draft.

_Marketing copy keeps the platform name out per the branding note below. The
draft host is named only in the permission justification, where the reviewer
needs it to make sense of the host access._

## 2. Privacy tab (required fields)

- **Single purpose:** "Mirror the user's online fantasy football draft picks
  onto their own Draft Helper board in real time."
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
    number, team) read from the draft page.
  - *"Authentication information"* → the Draft Helper sync token.
  - Certify: **not** sold to third parties, **not** used for anything unrelated
    to the single purpose, **not** used for creditworthiness/lending.

## 3. Graphics

- **Store icon:** `dist/icons/icon128.png` (128×128, included).
- **Screenshots:** at least one 1280×800 or 640×400 PNG required. A ready-made
  one (Draft Day view, live sync) is at
  `store-assets/screenshot-draftday-1280x800.png` (git-ignored, local only).

## 4. Notes for reviewers (paste into the private "Notes for reviewers" field)

The Draft Helper web app uses one-click invite login (no public signup), so the
reviewer needs a test account. A dedicated **"Store Reviewer"** account already
exists.

1. **Get its login link:** in Draft Helper → sign in → the admin **League
   members** panel → click **"New invite link"** next to *Store Reviewer* →
   **Copy link**. Paste that link into the reviewer-notes field. (The link
   contains a one-use-visible token; generate it right before submitting.)
2. **Reviewer-notes text to paste** (fill in the link from step 1):

   > This extension mirrors picks from your online fantasy football draft room
   > onto your board in the Draft Helper web app (draft.clanseafox.com). The app
   > uses one-click invite login.
   >
   > Test login (no password): &lt;PASTE INVITE LINK&gt;
   >
   > To verify the extension:
   > 1. Install it.
   > 2. In the Draft Helper web app (logged in via the link above), open
   >    Settings → "Generate token" and copy it.
   > 3. Open the extension's options page, paste the token, click "Test
   >    connection" → it confirms the authenticated connection ("Connected as
   >    Store Reviewer").
   >
   > Full live sync additionally requires being in an active fantasy draft room
   > on fantasy.espn.com/football/draft; the token + Test connection above
   > verifies the extension's core behavior without a fantasy account.

## 5. After approval

Review is typically a few days but can run longer. Share the resulting
Unlisted install link with league mates. Each person still generates their own
token in Draft Helper → Settings and pastes it into the extension.

## Notes / decisions

- **Unlisted, not Public:** private to people with the link; avoids a public,
  searchable listing for a single-league tool.
- **No platform branding** in the name, marketing description, or icon —
  described generically to avoid a trademark rejection. The draft host
  (`fantasy.espn.com`) appears **only** in the content-script permission
  justification and the private reviewer notes, where naming it is required for
  the reviewer to understand the host access; hiding it there would look more
  suspicious, not less.
- The manifest is already minimal: `storage` + one host permission + one
  content-script match. Don't add permissions without a matching justification
  above, or review will flag it.
