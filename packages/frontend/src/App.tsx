import { useCallback, useEffect, useState } from "react";
import type { BoardMeta, SessionUser } from "@drafthelper/shared";
import { api, ApiError } from "./api/client";
import { usePlayers } from "./state/players";
import { AdminPanel } from "./views/AdminPanel";
import { BoardsView } from "./views/BoardsView";
import { DraftDayView } from "./views/DraftDayView";
import { ImportView } from "./views/ImportView";
import { SettingsView } from "./views/SettingsView";
import "./App.css";

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; user: SessionUser };

type View = "boards" | "import" | "draft" | "settings";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [view, setView] = useState<View>("boards");
  const { players, byId, error: playersError } = usePlayers();

  useEffect(() => {
    api<SessionUser>("/me")
      .then((user) => setAuth({ status: "in", user }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: "out" });
        else throw err;
      });
  }, []);

  const signedIn = auth.status === "in";
  useEffect(() => {
    if (signedIn) api<BoardMeta[]>("/boards").then(setBoards);
  }, [signedIn]);

  const onCreated = useCallback((meta: BoardMeta) => {
    setBoards((prev) => [...prev, meta]);
    setView("boards");
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Draft Helper</h1>
        {signedIn && (
          <nav className="app-nav">
            <button
              type="button"
              className={view === "boards" ? "app-nav-active" : undefined}
              onClick={() => setView("boards")}
            >
              Boards
            </button>
            <button
              type="button"
              className={view === "draft" ? "app-nav-active" : undefined}
              onClick={() => setView("draft")}
            >
              Draft day
            </button>
            <button
              type="button"
              className={view === "settings" ? "app-nav-active" : undefined}
              onClick={() => setView("settings")}
            >
              Settings
            </button>
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
          {view === "import" && players ? (
            <ImportView
              players={players}
              onCreated={onCreated}
              onCancel={() => setView("boards")}
            />
          ) : view === "draft" && players ? (
            <DraftDayView boards={boards} players={players} playersById={byId} />
          ) : view === "settings" ? (
            <SettingsView />
          ) : (
            <BoardsView
              boards={boards}
              playersById={byId}
              onImport={() => setView("import")}
              onBoardDeleted={(id) => setBoards((prev) => prev.filter((b) => b.id !== id))}
            />
          )}
          {auth.user.admin && <AdminPanel />}
        </>
      )}
    </main>
  );
}
