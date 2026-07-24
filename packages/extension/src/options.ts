import { extApi, loadConfig } from "./apiClient.js";

const tokenInput = document.getElementById("token") as HTMLInputElement;
const apiBaseInput = document.getElementById("apiBase") as HTMLInputElement;
const status = document.getElementById("status")!;
const lastPushEl = document.getElementById("lastPush")!;

function show(message: string, ok: boolean): void {
  status.textContent = message;
  status.className = ok ? "ok" : "err";
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(["token", "apiBase", "lastPush"]);
  if (typeof stored.token === "string") tokenInput.value = stored.token;
  if (typeof stored.apiBase === "string") apiBaseInput.value = stored.apiBase;
  if (typeof stored.lastPush === "string") {
    lastPushEl.textContent = `Last push: ${new Date(stored.lastPush).toLocaleString()}`;
  }
}

document.getElementById("save")!.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      token: tokenInput.value.trim(),
      apiBase: apiBaseInput.value.trim(),
    });
    show("Saved.", true);
  })();
});

document.getElementById("test")!.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      token: tokenInput.value.trim(),
      apiBase: apiBaseInput.value.trim(),
    });
    const config = await loadConfig();
    if (!config) {
      show("Paste a token first.", false);
      return;
    }
    try {
      const me = await extApi<{ name: string }>(config, "/ext/ping");
      show(`Connected as ${me.name}.`, true);
    } catch (err) {
      show(`Failed: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  })();
});

void init();
