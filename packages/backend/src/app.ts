import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { SessionUser } from "@drafthelper/shared";
import {
  createUser,
  getUser,
  getUserIdByInviteHash,
  listUsers,
  rotateInvite,
} from "./db/users.js";
import {
  SESSION_COOKIE,
  hashInviteToken,
  issueSessionCookie,
  verifySession,
} from "./lib/session.js";

type Env = { Variables: { user: SessionUser } };

export const app = new Hono<Env>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/auth/login", async (c) => {
  const invite = c.req.query("invite");
  if (!invite) return c.json({ error: "missing invite token" }, 400);
  const userId = await getUserIdByInviteHash(hashInviteToken(invite));
  if (!userId) return c.json({ error: "invalid invite" }, 403);
  const user = await getUser(userId);
  if (!user) return c.json({ error: "invalid invite" }, 403);
  c.header("Set-Cookie", await issueSessionCookie(userId));
  return c.redirect("/");
});

/** Everything below requires a session. */
app.use("*", async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  const userId = cookie ? await verifySession(cookie) : null;
  const user = userId ? await getUser(userId) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", { id: user.id, name: user.name, admin: user.admin });
  await next();
});

app.get("/me", (c) => c.json(c.get("user")));

app.use("/admin/*", async (c, next) => {
  if (!c.get("user").admin) return c.json({ error: "forbidden" }, 403);
  await next();
});

app.get("/admin/users", async (c) => c.json(await listUsers()));

app.post("/admin/users", async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return c.json({ error: "name must be 1-50 characters" }, 400);
  }
  const { id, token } = await createUser(name);
  return c.json({ id, name, token }, 201);
});

app.post("/admin/users/:id/invite", async (c) => {
  const token = await rotateInvite(c.req.param("id"));
  if (!token) return c.json({ error: "no such user" }, 404);
  return c.json({ token });
});
