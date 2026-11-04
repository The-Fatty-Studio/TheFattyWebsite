import { z } from "zod";

const httpUrl = z.string().url().regex(/^https?:\/\//, "must start with http:// or https://");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Exact origin of the static site, e.g. https://the-fatty-studio.github.io (no path, no trailing slash)
  ALLOWED_ORIGIN: httpUrl,
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Public anon/publishable key. Used server-side only, to sign users in against Supabase Auth.
  SUPABASE_ANON_KEY: z.string().min(1),
  // Public origin of THIS API (admin pages and session cookies live here). Defaults to localhost.
  PUBLIC_URL: httpUrl.optional(),
  // How many reverse proxies sit in front of the app. Render appends the real client IP to
  // X-Forwarded-For and does not strip what the client sent, so only the rightmost hop is trusted.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  // Secret key for hashing IPs. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  IP_HASH_SECRET: z.string().min(16),
});

export type Config = Omit<z.infer<typeof schema>, "PUBLIC_URL"> & { PUBLIC_URL: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === "production" && !data.PUBLIC_URL?.startsWith("https://")) {
    // Without this the API would silently fall back to localhost and break cookies and CSRF checks.
    throw new Error("Invalid environment configuration: PUBLIC_URL (must be https:// in production)");
  }
  // Normalised to an origin (no path/trailing slash) so it can be compared with the Origin header.
  const publicUrl = new URL(data.PUBLIC_URL ?? `http://localhost:${data.PORT}`).origin;
  return { ...data, PUBLIC_URL: publicUrl };
}
