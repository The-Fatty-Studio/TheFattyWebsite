import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthService, AuthUser } from "../src/plugins/auth.js";
import type { AnalyticsStore } from "../src/services/analytics.js";
import type { DownloadStore } from "../src/services/downloads.js";
import { fakeCommunity } from "./fakes.js";

const env = {
  NODE_ENV: "test",
  ALLOWED_ORIGIN: "https://example.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  IP_HASH_SECRET: "test-secret-0123456789",
  SUPABASE_ANON_KEY: "anon-key",
};
const config = loadConfig(env);

const users: Record<string, AuthUser> = {
  "user-token": { id: "u1", email: "u@x.com", emailVerified: true, username: null, role: "user" },
  "admin-token": { id: "a1", email: "a@x.com", emailVerified: true, username: null, role: "admin" },
};
const fakeAuth: AuthService = {
  authenticate: async (t) => users[t] ?? null,
  signIn: async () => null,
  refresh: async () => null,
  signOut: async () => {},
    oauthUrl: () => "https://example.supabase.co/auth/v1/authorize",
    exchangeCode: async () => null,
};

const downloads: DownloadStore = { record: async () => {} };
const emptyAnalytics = {
  days: 30, total: 0, visitor_days: 0, by_day: [], by_version: [], by_country: [],
  by_device: [], by_browser: [], by_referrer: [], recent: [],
};
const requestedDays: number[] = [];
const analytics: AnalyticsStore = {
  downloads: async (days) => {
    requestedDays.push(days);
    return { ...emptyAnalytics, days };
  },
};
const services = { auth: fakeAuth, downloads, analytics, community: fakeCommunity() };

const get = async (url: string, headers: Record<string, string> = {}) => {
  const app = await buildApp(config, services);
  return app.inject({ method: "GET", url, headers });
};

describe("config", () => {
  it("rejects missing env", () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment/);
  });
  it("refuses to run in production without an https PUBLIC_URL", () => {
    const prod = { ...env, NODE_ENV: "production" };
    expect(() => loadConfig(prod)).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...prod, PUBLIC_URL: "http://api.example.com" })).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ ...prod, PUBLIC_URL: "https://api.example.com/" }).PUBLIC_URL).toBe("https://api.example.com");
    const multi = loadConfig({ ...prod, PUBLIC_URL: "https://api.example.com", ALLOWED_ORIGIN: "https://a.example.com, https://b.example.com/" });
    expect(multi.ALLOWED_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(() => loadConfig({ ...prod, PUBLIC_URL: "https://api.example.com", ALLOWED_ORIGIN: "https://a.example.com,nope" })).toThrow(/ALLOWED_ORIGIN/);
  });
});

describe("health", () => {
  it("is public", async () => {
    const res = await get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("admin routes", () => {
  it("401 without a token", async () => {
    expect((await get("/api/admin/ping")).statusCode).toBe(401);
  });
  it("401 with an invalid token", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer nope" });
    expect(res.statusCode).toBe(401);
  });
  it("401 with a non-bearer scheme", async () => {
    const res = await get("/api/admin/ping", { authorization: "Basic admin-token" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a normal user", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer user-token" });
    expect(res.statusCode).toBe(403);
  });
  it("200 for an admin", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer admin-token" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, userId: "a1" });
  });
});

describe("analytics", () => {
  const url = "/api/admin/analytics/downloads";
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  it("is admin only", async () => {
    expect((await get(url)).statusCode).toBe(401);
    expect((await get(url, as("user-token"))).statusCode).toBe(403);
  });
  it("defaults to 30 days and passes the requested range through", async () => {
    expect((await get(url, as("admin-token"))).json().days).toBe(30);
    expect((await get(`${url}?days=7`, as("admin-token"))).json().days).toBe(7);
    expect(requestedDays.slice(-2)).toEqual([30, 7]);
  });
  it("rejects out-of-range or non-numeric days", async () => {
    for (const bad of ["0", "366", "abc", "1.5"]) {
      expect((await get(`${url}?days=${bad}`, as("admin-token"))).statusCode).toBe(400);
    }
  });
});

describe("me", () => {
  it("requires a token", async () => {
    expect((await get("/api/me")).statusCode).toBe(401);
  });
  it("returns the user and role, nothing else", async () => {
    const res = await get("/api/me", { authorization: "Bearer user-token" });
    expect(res.json()).toEqual({ id: "u1", email: "u@x.com", emailVerified: true, username: null, role: "user" });
  });
});

describe("docs", () => {
  it("serves Scalar and an OpenAPI spec outside production", async () => {
    expect((await get("/docs/")).statusCode).toBe(200);
    const spec = (await get("/docs/openapi.json")).json();
    expect(spec.paths["/api/admin/ping"].get.security).toEqual([{ bearerAuth: [] }]);
  });
  it("is not served in production", async () => {
    const prod = { ...config, NODE_ENV: "production" as const };
    const app = await buildApp(prod, services);
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBe(404);
  });
});

describe("cors", () => {
  it("allows only the configured origin", async () => {
    const ok = await get("/health", { origin: "https://example.github.io" });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://example.github.io");
    const bad = await get("/health", { origin: "https://evil.example" });
    // Allow-list: a foreign origin gets no CORS header at all, so browsers block it.
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
