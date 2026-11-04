import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashIp } from "../src/lib/privacy.js";
import { parseUserAgent } from "../src/lib/ua.js";
import type { DownloadEvent, DownloadStore } from "../src/services/downloads.js";
import { fakeAuth, fakeCommunity } from "./fakes.js";

const env = {
  NODE_ENV: "test",
  ALLOWED_ORIGIN: "https://example.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  IP_HASH_SECRET: "test-secret-0123456789",
  SUPABASE_ANON_KEY: "anon-key",
  PUBLIC_URL: "https://api.example.com",
};

async function setup(overrides: Record<string, string> = {}, fail = false) {
  const events: DownloadEvent[] = [];
  const downloads: DownloadStore = {
    record: async (e) => {
      if (fail) throw new Error("db down");
      events.push(e);
    },
  };
  const app = await buildApp(loadConfig({ ...env, ...overrides }), {
    auth: fakeAuth(),
    community: fakeCommunity(),
    downloads,
    analytics: { downloads: async () => { throw new Error("unused"); } },
  });
  return { app, events };
}

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("POST /api/download", () => {
  it("records a click with coarse fields and a hashed IP", async () => {
    const { app, events } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/download?ref=reddit.com",
      headers: { "user-agent": ANDROID_CHROME },
      remoteAddress: "8.8.8.8",
    });
    expect(res.statusCode).toBe(204);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ country: "US", device: "android", uaFamily: "chrome", referrer: "reddit.com" });
    expect(events[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(events[0])).not.toContain("8.8.8.8");
  });

  it("defaults to android and accepts a windows download", async () => {
    const { app, events } = await setup();
    await app.inject({ method: "POST", url: "/api/download" });
    await app.inject({ method: "POST", url: "/api/download?platform=windows" });
    expect(events.map((e) => e.platform)).toEqual(["android", "windows"]);
  });

  it("rejects an unknown platform", async () => {
    const { app, events } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/download?platform=ios" });
    expect(res.statusCode).toBe(400);
    expect(events).toHaveLength(0);
  });

  it("still answers 204 when storing fails", async () => {
    const { app } = await setup({}, true);
    const res = await app.inject({ method: "POST", url: "/api/download" });
    expect(res.statusCode).toBe(204);
  });

  it("rejects a malformed referrer", async () => {
    const { app, events } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/download?ref=%3Cscript%3E" });
    expect(res.statusCode).toBe(400);
    expect(events).toHaveLength(0);
  });

  it("in production only accepts the site's origin", async () => {
    const { app, events } = await setup({ NODE_ENV: "production" });
    const bad = await app.inject({ method: "POST", url: "/api/download", headers: { origin: "https://evil.example" } });
    expect(bad.statusCode).toBe(403);
    const none = await app.inject({ method: "POST", url: "/api/download" });
    expect(none.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/api/download", headers: { origin: env.ALLOWED_ORIGIN } });
    expect(ok.statusCode).toBe(204);
    expect(events).toHaveLength(1);
  });

  it("rate limits repeated clicks from one address", async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: "POST", url: "/api/download" })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe("client IP", () => {
  it("ignores a forged X-Forwarded-For and uses the address the proxy appended", async () => {
    const { app, events } = await setup();
    // Same real client (8.8.8.8, appended by the proxy), different forged first entries.
    await app.inject({ method: "POST", url: "/api/download", remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": "6.6.6.6, 8.8.8.8" } });
    await app.inject({ method: "POST", url: "/api/download", remoteAddress: "10.0.0.2",
      headers: { "x-forwarded-for": "1.2.3.4, 8.8.8.8" } });
    expect(events[0]!.country).toBe("US");
    expect(events[0]!.ipHash).toBe(events[1]!.ipHash);
  });

  it("rate limits by the real address, so rotating a forged header does not help", async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: "POST", url: "/api/download", remoteAddress: "10.0.0.1",
        headers: { "x-forwarded-for": `9.9.9.${i}, 8.8.8.8` } })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe("hashIp", () => {
  it("is stable within a day and changes across days and secrets", () => {
    const d1 = new Date("2026-01-01T10:00:00Z");
    const d1b = new Date("2026-01-01T23:00:00Z");
    const d2 = new Date("2026-01-02T00:30:00Z");
    expect(hashIp("1.2.3.4", "s".repeat(16), d1)).toBe(hashIp("1.2.3.4", "s".repeat(16), d1b));
    expect(hashIp("1.2.3.4", "s".repeat(16), d1)).not.toBe(hashIp("1.2.3.4", "s".repeat(16), d2));
    expect(hashIp("1.2.3.4", "s".repeat(16), d1)).not.toBe(hashIp("1.2.3.4", "t".repeat(16), d1));
  });
});

describe("parseUserAgent", () => {
  it.each([
    [ANDROID_CHROME, "android", "chrome"],
    ["Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36", "android", "samsung"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "ios", "safari"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0", "desktop", "firefox"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0", "desktop", "edge"],
    [undefined, "other", "other"],
  ])("%s", (ua, device, family) => {
    expect(parseUserAgent(ua as string | undefined)).toEqual({ device, family });
  });
});
