import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { type FastifyError } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { authPlugin, type AuthService } from "./plugins/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { downloadRoutes } from "./routes/download.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { profileRoutes } from "./routes/profile.js";
import { reviewRoutes } from "./routes/reviews.js";
import type { AnalyticsStore } from "./services/analytics.js";
import type { CommunityStore } from "./services/community.js";
import type { DownloadStore } from "./services/downloads.js";

export interface Services {
  auth: AuthService;
  downloads: DownloadStore;
  analytics: AnalyticsStore;
  community: CommunityStore;
}

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

export async function buildApp(config: Config, { auth, downloads, analytics, community }: Services) {
  const prod = config.NODE_ENV === "production";

  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            redact: ["req.headers.authorization", "req.headers.cookie"],
            serializers: {
              // Only method and path: no client IP (privacy) and no query string (it can hold a
              // one-time OAuth code).
              req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split("?")[0] }),
            },
          },
    // Trust only the proxy hops we actually have. `true` would believe a client-supplied
    // X-Forwarded-For and let anyone forge their IP (rate limits, IP hash).
    trustProxy: (_addr: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
  });

  // Server-side failures are logged in full but the client only ever sees a generic answer: a
  // database or library message can name tables, constraints or internals.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err: error }, "request failed");
      return reply.code(500).send({ error: "internal" });
    }
    return reply.code(status).send({
      error: status === 429 ? "rate_limited" : "bad_request",
      message: status === 400 ? "Invalid request" : error.message,
    });
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const docsEnabled = !prod;
  if (docsEnabled) {
    await app.register(swagger, {
      openapi: {
        info: { title: "The Fatty API", version: "0.1.0" },
        components: {
          securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
        },
      },
      transform: jsonSchemaTransform,
    });
  }

  // Strict CSP for everything the API serves (the admin pages). No inline scripts or styles.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: prod ? [] : null, // plain-http localhost must keep working
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    // The download beacon and /health are called from the GitHub Pages origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // CORS is only for the public, cookie-less endpoints. Credentials are deliberately not allowed,
  // so a page on another site can never make the browser send the session cookies.
  await app.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(authPlugin, { auth, config });

  // API answers default to no-store (they can hold personal data); a route may opt in to short
  // public caching (the public review list). The pages this API serves are revalidated and kept out
  // of search results: the website's own pages live on GitHub Pages.
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      if (!reply.hasHeader("cache-control")) reply.header("Cache-Control", "no-store");
    } else if (/^\/(admin|community|shared)(\/|$)/.test(req.url)) {
      reply.header("Cache-Control", "no-cache");
      reply.header("X-Robots-Tag", "noindex, nofollow");
    }
  });

  if (docsEnabled) {
    // Scalar needs inline scripts, so it alone gets no CSP, and only outside production.
    await app.register(async (docs) => {
      docs.addHook("onSend", async (_req, reply) => {
        reply.removeHeader("content-security-policy");
      });
      await docs.register(scalar, { routePrefix: "/docs" });
    });
  }

  await app.register(fastifyStatic, { root: PUBLIC_DIR, index: "index.html", cacheControl: false });

  await app.register(healthRoutes);
  await app.register(downloadRoutes, { prefix: "/api", config, downloads });
  await app.register(authRoutes, { prefix: "/api/auth", auth, config });
  await app.register(meRoutes, { prefix: "/api", community });
  await app.register(profileRoutes, { prefix: "/api", community });
  await app.register(reviewRoutes, { prefix: "/api", community });
  await app.register(adminRoutes, { prefix: "/api/admin", analytics, community });

  return app;
}
