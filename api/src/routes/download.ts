import { lookup } from "geoip-country";
import { isIP } from "node:net";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../config.js";
import { hashIp } from "../lib/privacy.js";
import { parseUserAgent } from "../lib/ua.js";
import type { DownloadStore } from "../services/downloads.js";

interface Options {
  config: Config;
  downloads: DownloadStore;
}

export const downloadRoutes: FastifyPluginAsyncZod<Options> = async (app, { config, downloads }) => {
  app.post(
    "/download",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["tracking"],
        summary: "Record a download click (sent as a beacon by the site)",
        description:
          "Always answers 204 for allowed callers, even if storing fails: tracking must never break a download.",
        querystring: z.object({
          // Hostname of document.referrer, extracted by the site's JS.
          ref: z.string().max(100).regex(/^[a-z0-9.-]+$/i).optional(),
          platform: z.enum(["android", "windows"]).default("android"),
        }),
        response: {
          204: z.null().describe("Recorded"),
          403: z.object({ error: z.literal("forbidden") }),
        },
      },
    },
    async (req, reply) => {
      // Cheap abuse filter: browsers always send Origin on cross-origin POSTs. Skipped outside
      // production so Scalar and local pages can be used for testing.
      if (config.NODE_ENV === "production" && req.headers.origin !== config.ALLOWED_ORIGIN) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const { device, family } = parseUserAgent(req.headers["user-agent"]);
      try {
        await downloads.record({
          platform: req.query.platform,
          country: isIP(req.ip) ? (lookup(req.ip)?.country ?? null) : null,
          device,
          uaFamily: family,
          referrer: req.query.ref ?? null,
          ipHash: hashIp(req.ip, config.IP_HASH_SECRET),
        });
      } catch (err) {
        req.log.error({ err }, "failed to record download");
      }
      return reply.code(204).send(null);
    },
  );
};
