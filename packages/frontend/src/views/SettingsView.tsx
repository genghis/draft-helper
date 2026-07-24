import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import "./SettingsView.css";

interface MySettings {
  espn: { leagueId: string } | null;
}

export function SettingsView() {
  const [settings, setSettings] = useState<MySettings | null>(null);
  const [extToken, setExtToken] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [swid, setSwid] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MySettings>("/me/settings").then((s) => {
      setSettings(s);
      if (s.espn) setLeagueId(s.espn.leagueId);
    });
  }, []);

  function report(promise: Promise<string>) {
    setStatus(null);
    setError(null);
    promise
      .then(setStatus)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }

  async function generateToken() {
    const { token } = await api<{ token: string }>("/me/ext-token", { method: "POST" });
    setExtToken(token);
    return "New extension token generated — copy it now, it won't be shown again.";
  }

  async function revokeToken() {
    await api("/me/ext-token", { method: "DELETE" });
    setExtToken(null);
    return "Extension token revoked.";
  }

  async function saveEspn() {
    await api("/me/espn", { method: "PUT", body: { leagueId, espnS2, swid } });
    setEspnS2("");
    setSwid("");
    setSettings({ espn: { leagueId } });
    return "ESPN settings saved.";
  }

  async function testEspn() {
    const { leagueName } = await api<{ leagueName: string }>("/me/espn/test", {
      method: "POST",
    });
    return `Connected — league: “${leagueName}”.`;
  }

  async function importEspn() {
    const res = await api<{ written: number; skipped: number; unmapped: number[] }>(
      "/draft/import-espn",
      { method: "POST" }
    );
    const unmapped = res.unmapped.length
      ? ` (${res.unmapped.length} ESPN ids had no player match)`
      : "";
    return `Imported ${res.written} picks, ${res.skipped} already marked manually${unmapped}.`;
  }

  return (
    <section className="settings">
      <h2>Settings</h2>
      {status && <p className="settings-status">{status}</p>}
      {error && <p className="app-error">{error}</p>}

      <section className="settings-card">
        <h3>Draft-room extension</h3>
        <p className="muted">
          The Chrome extension watches your ESPN draft room and marks picks here
          automatically. Generate a token and paste it into the extension's
          options page once.
        </p>
        {extToken && (
          <div className="settings-token">
            <code>{extToken}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(extToken)}
            >
              Copy
            </button>
          </div>
        )}
        <div className="settings-actions">
          <button type="button" onClick={() => report(generateToken())}>
            {extToken ? "Regenerate token" : "Generate token"}
          </button>
          <button type="button" className="secondary" onClick={() => report(revokeToken())}>
            Revoke
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h3>ESPN league (post-draft import)</h3>
        <p className="muted">
          Used to pull the final results from ESPN after your draft completes —
          live sync comes from the extension, not from here. Cookies: open
          fantasy.espn.com logged in → DevTools → Application → Cookies → copy{" "}
          <code>espn_s2</code> and <code>SWID</code>.
        </p>
        <label>
          League ID
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            placeholder="e.g. 498682"
            inputMode="numeric"
          />
        </label>
        <label>
          espn_s2 cookie
          <input
            value={espnS2}
            onChange={(e) => setEspnS2(e.target.value)}
            placeholder={settings?.espn ? "saved — paste to replace" : ""}
            type="password"
            autoComplete="off"
          />
        </label>
        <label>
          SWID cookie
          <input
            value={swid}
            onChange={(e) => setSwid(e.target.value)}
            placeholder={settings?.espn ? "saved — paste to replace" : "{...}"}
            type="password"
            autoComplete="off"
          />
        </label>
        <div className="settings-actions">
          <button type="button" onClick={() => report(saveEspn())}>
            Save
          </button>
          <button
            type="button"
            disabled={!settings?.espn}
            onClick={() => report(testEspn())}
          >
            Test connection
          </button>
          <button
            type="button"
            disabled={!settings?.espn}
            onClick={() => report(importEspn())}
          >
            Import completed draft
          </button>
        </div>
      </section>
    </section>
  );
}
