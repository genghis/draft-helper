import { useCallback, useEffect, useState } from "react";
import type { BoardMeta, SessionUser, SourceMeta, Tag } from "@drafthelper/shared";
import { picksMade } from "@drafthelper/shared";
import { api, ApiError } from "./api/client";
import { useAdp } from "./state/adp";
import { useAllBoardLayouts } from "./state/boardLayouts";
import { useDraft } from "./state/draft";
import { useHandcuffAutoTag } from "./state/useHandcuffAutoTag";
import { usePlayers } from "./state/players";
import { useTags } from "./state/tags";
import { PaywallPrank } from "./components/PaywallPrank";
import { TagPickerModal } from "./components/TagPickerModal";
import { AdminPanel } from "./views/AdminPanel";
import { BoardsView } from "./views/BoardsView";
import { DraftDayView } from "./views/DraftDayView";
import { ImportView } from "./views/ImportView";
import { SettingsView } from "./views/SettingsView";
import { SourceDetailView } from "./views/SourceDetailView";
import { SourcesView } from "./views/SourcesView";
import { TagEditorView } from "./views/TagEditorView";
import { TagsView } from "./views/TagsView";
import "./views/DraftDayView.css";
import "./App.css";

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; user: SessionUser };

/**
 * League in-joke: the one user id that gets the gag paywall after round 4.
 * Empty string disarms it entirely, which is how it ships until someone
 * deliberately fills in an id. Grab the id from the Admin panel.
 */
const PRANK_TARGET_USER_ID: string = "23c75cd5-6d0d-40fb-913f-c1f951c5f901";
/** Used on the reveal, so it doesn't depend on how he named his profile. */
const PRANK_TARGET_NAME = "Matt";
const PRANK_AFTER_ROUND = 4;
const PRANK_DISMISSED_KEY = "dh-paywall-prank-dismissed";

type View =
  | "sortings"
  | "sources"
  | "source-detail"
  | "import"
  | "draft"
  | "settings"
  | "tags"
  | "tag-editor";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [view, setView] = useState<View>("sortings");
  const [editingTag, setEditingTag] = useState<Tag | undefined>(undefined);
  // One tag picker for the whole app — every player surface opens this one.
  const [tagTarget, setTagTarget] = useState<string | null>(null);
  const [viewingSource, setViewingSource] = useState<SourceMeta | null>(null);
  const { players, byId, error: playersError } = usePlayers();
  const adp = useAdp();
  const signedIn = auth.status === "in";
  const tags = useTags(signedIn);
  const draft = useDraft({ poll: true, enabled: signedIn });
  const boardLayouts = useAllBoardLayouts(boards);
  const handcuff = useHandcuffAutoTag({
    enabled: signedIn,
    picks: draft.picks,
    players: players ?? [],
    playersById: byId,
    boards,
    layouts: boardLayouts.layouts,
    adp,
    tags,
  });

  const [prankDismissed, setPrankDismissed] = useState(
    () => sessionStorage.getItem(PRANK_DISMISSED_KEY) === "1"
  );
  // Same round math the pick log uses, so there's no second source of truth.
  const prankArmed =
    PRANK_TARGET_USER_ID !== "" &&
    auth.status === "in" &&
    auth.user.id === PRANK_TARGET_USER_ID &&
    !prankDismissed &&
    draft.order !== null &&
    picksMade([...draft.picks.values()]) >= PRANK_AFTER_ROUND * draft.order.teamCount;

  useEffect(() => {
    api<SessionUser>("/me")
      .then((user) => setAuth({ status: "in", user }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: "out" });
        else throw err;
      });
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (signedIn) {
      api<BoardMeta[]>("/boards").then(setBoards).catch((e) => setLoadError(String(e)));
      api<SourceMeta[]>("/sources").then(setSources).catch((e) => setLoadError(String(e)));
    }
  }, [signedIn]);

  const onSourceCreated = useCallback((meta: SourceMeta) => {
    setSources((prev) => [...prev, meta]);
    setView("sources");
  }, []);

  const onSortingCreated = useCallback((meta: BoardMeta) => {
    setBoards((prev) => [...prev, meta]);
    setView("sortings");
  }, []);

  const onTagSaved = useCallback(() => {
    setEditingTag(undefined);
    setView("tags");
    void tags.refresh();
  }, [tags]);

  const onTagDeleted = useCallback(() => {
    void tags.refresh();
  }, [tags]);

  const navItem = (key: View, label: string) => (
    <button
      type="button"
      className={view === key ? "app-nav-active" : undefined}
      onClick={() => setView(key)}
    >
      {label}
    </button>
  );

  // Dense, scannable views earn the full window; the rest stay readable.
  const wide = view === "draft" || view === "sortings";

  return (
    <main className={wide ? "app-shell is-wide" : "app-shell"}>
      <header className="app-header">
        <h1 className="wordmark">
          <span className="pin" aria-hidden="true" />
          Draft Helper
        </h1>
        {signedIn && (
          <nav className="app-nav">
            {navItem("sortings", "Cheat Sheets")}
            {navItem("sources", "Sources")}
            {navItem("tags", "Tags")}
            {navItem("draft", "Draft day")}
            {navItem("settings", "Settings")}
          </nav>
        )}
      </header>
      {auth.status === "loading" && <p className="muted">Checking session…</p>}
      {auth.status === "out" && (
        <p className="muted">Not signed in — use your invite link to get in.</p>
      )}
      {auth.status === "in" && (
        <>
          {playersError && <p className="app-error">Player list failed to load: {playersError}</p>}
          {loadError && <p className="app-error">Failed to load your data: {loadError}</p>}
          {view === "import" && players ? (
            <ImportView
              players={players}
              onCreated={onSourceCreated}
              onCancel={() => setView("sources")}
            />
          ) : view === "source-detail" && viewingSource ? (
            <SourceDetailView
              meta={viewingSource}
              playersById={byId}
              onBack={() => {
                setViewingSource(null);
                setView("sources");
              }}
            />
          ) : view === "sources" ? (
            <SourcesView
              sources={sources}
              onImport={() => setView("import")}
              onView={(s) => {
                setViewingSource(s);
                setView("source-detail");
              }}
              onDeleted={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
            />
          ) : view === "tag-editor" && players ? (
            <TagEditorView
              players={players}
              playersById={byId}
              existingTag={editingTag}
              onSaved={onTagSaved}
              onCancel={() => {
                setEditingTag(undefined);
                setView("tags");
              }}
            />
          ) : view === "tags" ? (
            <TagsView
              tags={tags.metas}
              onNew={() => {
                setEditingTag(undefined);
                setView("tag-editor");
              }}
              onEdit={(meta) => {
                setEditingTag(tags.tags.find((t) => t.meta.id === meta.id));
                setView("tag-editor");
              }}
              onDeleted={onTagDeleted}
            />
          ) : view === "draft" && players ? (
            <DraftDayView
              boards={boards}
              players={players}
              playersById={byId}
              adp={adp}
              tagsByPlayer={tags.tagsByPlayer}
              onTagPlayer={setTagTarget}
              draft={draft}
              layouts={boardLayouts.layouts}
            />
          ) : view === "settings" ? (
            <SettingsView />
          ) : (
            <BoardsView
              boards={boards}
              sources={sources}
              playersById={byId}
              adp={adp}
              tagsByPlayer={tags.tagsByPlayer}
              onTagPlayer={setTagTarget}
              draft={draft}
              onLayoutChanged={boardLayouts.setLayout}
              onSortingCreated={onSortingCreated}
              onBoardDeleted={(id) => setBoards((prev) => prev.filter((b) => b.id !== id))}
            />
          )}
          {tagTarget && (
            <TagPickerModal
              playerId={tagTarget}
              playerName={byId.get(tagTarget)?.name ?? tagTarget}
              tags={tags.metas}
              current={tags.tagsByPlayer.get(tagTarget)}
              onAdd={tags.addPlayerToTag}
              onCreate={tags.createTagWithPlayer}
              onClose={() => setTagTarget(null)}
            />
          )}
          {prankArmed && (
            <PaywallPrank
              name={PRANK_TARGET_NAME}
              onDismiss={() => {
                sessionStorage.setItem(PRANK_DISMISSED_KEY, "1");
                setPrankDismissed(true);
              }}
            />
          )}
          {handcuff.toast && (
            <div className="draft-toast handcuff-toast" role="status">
              <span>
                Auto-tagged <strong>{handcuff.toast.addedNames.join(", ")}</strong> as
                handcuff{handcuff.toast.addedNames.length > 1 ? "s" : ""} for{" "}
                {handcuff.toast.leadName}
              </span>
              <button type="button" onClick={() => void handcuff.undo()}>
                Undo
              </button>
              <button type="button" className="secondary" onClick={handcuff.dismissToast}>
                Dismiss
              </button>
            </div>
          )}
          {auth.user.admin && <AdminPanel />}
        </>
      )}
    </main>
  );
}
