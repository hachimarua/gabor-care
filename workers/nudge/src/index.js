import webpush from "web-push";

const MINUTE = 60 * 1000;
const JST_OFFSET = 9 * 60 * MINUTE;
const FIRST_ALLOWED_MINUTE = 6 * 60 + 30;
const LAST_ALLOWED_MINUTE = 21 * 60 + 59;

export default {
  async fetch(request, env) {
    return handleApiRequest(request, env);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendDueNudges(env));
  },
};

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/nudge/")) return new Response("Not found", { status: 404 });
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

  try {
    if (url.pathname === "/api/nudge/config" && request.method === "GET") {
      return apiJson({ available: Boolean(env.VAPID_PUBLIC_KEY), publicKey: env.VAPID_PUBLIC_KEY || undefined }, origin);
    }
    if (request.method !== "POST") return apiJson({ error: "not_found" }, origin, 404);
    const body = await readJson(request);
    if (url.pathname === "/api/nudge/subscribe") return subscribe(body, env, origin);
    if (url.pathname === "/api/nudge/preferences") return savePreferences(body, request, env, origin);
    if (url.pathname === "/api/nudge/complete") return recordCompletion(body, request, env, origin);
    if (url.pathname === "/api/nudge/unsubscribe") return unsubscribe(body, request, env, origin);
    return apiJson({ error: "not_found" }, origin, 404);
  } catch {
    return apiJson({ error: "invalid_request" }, origin, 400);
  }
}

async function subscribe(body, env, origin) {
  const preferredMinute = body.preferredMinute ?? 1110;
  if (!validDeviceId(body.deviceId) || !validSubscription(body.subscription) || !validPreferredMinute(preferredMinute)) {
    return apiJson({ error: "invalid_request" }, origin, 400);
  }
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await env.NUDGE_DB.batch([
    env.NUDGE_DB.prepare("DELETE FROM nudge_devices WHERE endpoint = ? AND device_id != ?")
      .bind(body.subscription.endpoint, body.deviceId),
    env.NUDGE_DB.prepare(`
      INSERT INTO nudge_devices (
        device_id, token_hash, endpoint, p256dh, auth, nudge_enabled, preferred_minute_jst, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        endpoint = excluded.endpoint,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        nudge_enabled = 1,
        preferred_minute_jst = excluded.preferred_minute_jst,
        updated_at = excluded.updated_at
    `).bind(
      body.deviceId,
      tokenHash,
      body.subscription.endpoint,
      body.subscription.keys.p256dh,
      body.subscription.keys.auth,
      preferredMinute,
      now
    ),
  ]);
  return apiJson({ token, preferredMinute }, origin);
}

async function savePreferences(body, request, env, origin) {
  if (!validDeviceId(body.deviceId) || typeof body.enabled !== "boolean" || !validPreferredMinute(body.preferredMinute)) {
    return apiJson({ error: "invalid_request" }, origin, 400);
  }
  if (!await requireDevice(request, env, body.deviceId)) return apiJson({ error: "unauthorized" }, origin, 401);
  await env.NUDGE_DB.prepare(
    "UPDATE nudge_devices SET nudge_enabled = ?, preferred_minute_jst = ?, updated_at = ? WHERE device_id = ?"
  ).bind(body.enabled ? 1 : 0, body.preferredMinute, Date.now(), body.deviceId).run();
  return apiJson({ ok: true }, origin);
}

async function recordCompletion(body, request, env, origin) {
  if (!validDeviceId(body.deviceId)) return apiJson({ error: "invalid_request" }, origin, 400);
  const device = await requireDevice(request, env, body.deviceId);
  if (!device) return apiJson({ error: "unauthorized" }, origin, 401);
  const completedAt = Date.parse(body.completedAt);
  const now = Date.now();
  if (!Number.isFinite(completedAt) || completedAt > now + 5 * MINUTE || completedAt < now - 14 * 24 * 60 * MINUTE) {
    return apiJson({ error: "invalid_request" }, origin, 400);
  }
  await env.NUDGE_DB.prepare(`
    UPDATE nudge_devices
    SET last_completed_at = ?, next_nudge_at = ?, last_nudged_completed_at = NULL, updated_at = ?
    WHERE device_id = ?
  `).bind(completedAt, nextNudgeAt(completedAt, device.preferred_minute_jst), now, body.deviceId).run();
  return apiJson({ ok: true }, origin);
}

async function unsubscribe(body, request, env, origin) {
  if (!validDeviceId(body.deviceId) || !await requireDevice(request, env, body.deviceId)) {
    return apiJson({ error: "unauthorized" }, origin, 401);
  }
  await env.NUDGE_DB.prepare("UPDATE nudge_devices SET nudge_enabled = 0, updated_at = ? WHERE device_id = ?")
    .bind(Date.now(), body.deviceId).run();
  return apiJson({ ok: true }, origin);
}

async function sendDueNudges(env) {
  const now = Date.now();
  const clock = jstClock(now);
  if (clock.minute < FIRST_ALLOWED_MINUTE || clock.minute > LAST_ALLOWED_MINUTE) return;

  const { results = [] } = await env.NUDGE_DB.prepare(`
    SELECT device_id, endpoint, p256dh, auth, preferred_minute_jst, last_completed_at, next_nudge_at
    FROM nudge_devices
    WHERE nudge_enabled = 1
      AND next_nudge_at IS NOT NULL
      AND next_nudge_at <= ?
      AND (last_nudged_completed_at IS NULL OR last_nudged_completed_at < last_completed_at)
  `).bind(now).all();

  for (const device of results) {
    if (jstDate(device.next_nudge_at) !== clock.date) {
      await env.NUDGE_DB.prepare(
        "UPDATE nudge_devices SET next_nudge_at = ?, updated_at = ? WHERE device_id = ?"
      ).bind(nextPreferredAt(now, device.preferred_minute_jst), now, device.device_id).run();
      continue;
    }
    if (clock.minute < device.preferred_minute_jst) continue;
    await sendOne(env, device, now);
  }
}

async function sendOne(env, device, now) {
  const claim = await env.NUDGE_DB.prepare(`
    UPDATE nudge_devices
    SET last_nudged_completed_at = last_completed_at, updated_at = ?
    WHERE device_id = ?
      AND nudge_enabled = 1
      AND last_completed_at = ?
      AND (last_nudged_completed_at IS NULL OR last_nudged_completed_at < last_completed_at)
  `).bind(now, device.device_id, device.last_completed_at).run();
  if (!claim.meta.changes) return;

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(
      {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
      },
      JSON.stringify({
        title: "ガボールアイ",
        body: "前回から2日あいています。3分だけ、絵探しゲームをやってみませんか？",
        url: "./#game",
      }),
      { TTL: 60, urgency: "low" }
    );
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await env.NUDGE_DB.prepare(
        "UPDATE nudge_devices SET nudge_enabled = 0, updated_at = ? WHERE device_id = ?"
      ).bind(Date.now(), device.device_id).run();
    }
  }
}

function jstClock(timestamp) {
  const shifted = new Date(timestamp + JST_OFFSET);
  return {
    date: `${shifted.getUTCFullYear()}-${shifted.getUTCMonth()}-${shifted.getUTCDate()}`,
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function jstDate(timestamp) {
  return jstClock(timestamp).date;
}

function nextPreferredAt(timestamp, preferredMinute) {
  const shifted = new Date(timestamp + JST_OFFSET);
  let result = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    preferredMinute
  ) - JST_OFFSET;
  if (result <= timestamp) result += 24 * 60 * MINUTE;
  return result;
}

function nextNudgeAt(completedAt, preferredMinute) {
  const earliest = completedAt + 48 * 60 * MINUTE;
  const shifted = new Date(earliest + JST_OFFSET);
  let candidate = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    preferredMinute
  ) - JST_OFFSET;
  if (candidate < earliest) candidate += 24 * 60 * MINUTE;
  return candidate;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 10_000) throw new Error("payload_too_large");
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_payload");
  return value;
}

function isAllowedOrigin(origin, env) {
  return origin === env.ALLOWED_ORIGIN;
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-device-token",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function apiJson(data, origin, status = 200) {
  return Response.json(data, { status, headers: { ...corsHeaders(origin), "cache-control": "no-store" } });
}

function validDeviceId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{20,80}$/.test(value);
}

function validPreferredMinute(value) {
  return Number.isInteger(value) && value >= 390 && value <= 1290 && value % 30 === 0;
}

function validSubscription(subscription) {
  return Boolean(
    subscription
    && typeof subscription.endpoint === "string"
    && subscription.endpoint.startsWith("https://")
    && subscription.endpoint.length < 2_000
    && typeof subscription.keys?.p256dh === "string"
    && subscription.keys.p256dh.length > 20
    && typeof subscription.keys?.auth === "string"
    && subscription.keys.auth.length > 8
  );
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64url(new Uint8Array(digest));
}

async function requireDevice(request, env, deviceId) {
  const token = request.headers.get("x-device-token");
  if (!token) return null;
  return env.NUDGE_DB.prepare(
    "SELECT device_id, nudge_enabled, preferred_minute_jst FROM nudge_devices WHERE device_id = ? AND token_hash = ?"
  ).bind(deviceId, await hashToken(token)).first();
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
