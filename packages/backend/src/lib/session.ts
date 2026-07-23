import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days: outlives draft season, not forever
export const SESSION_COOKIE = "dh_session";

let cachedSecret: string | null = null;

async function getSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const param = process.env.SESSION_SECRET_PARAM;
  if (!param) throw new Error("SESSION_SECRET_PARAM not set");
  const res = await new SSMClient({}).send(
    new GetParameterCommand({ Name: param, WithDecryption: true })
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${param} is empty`);
  cachedSecret = value;
  return value;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSessionCookie(userId: string): Promise<string> {
  const secret = await getSecret();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  const value = `${payload}.${sign(payload, secret)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** Returns the userId for a valid, unexpired session cookie value, else null. */
export async function verifySession(cookieValue: string): Promise<string | null> {
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const secret = await getSecret();
  const expected = sign(`${userId}.${expStr}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
