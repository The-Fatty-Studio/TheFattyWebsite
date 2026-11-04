import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";

export type Platform = "android" | "windows";

export interface DownloadEvent {
  platform: Platform;
  country: string | null;
  device: string;
  uaFamily: string;
  referrer: string | null;
  ipHash: string;
}

/** Persists one download click against the current release of its platform. */
export interface DownloadStore {
  record(event: DownloadEvent): Promise<void>;
}

const RELEASE_CACHE_MS = 60_000;

export function createSupabaseDownloads(config: Config): DownloadStore {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cached = new Map<Platform, { id: string | null; at: number }>();

  async function currentReleaseId(platform: Platform): Promise<string | null> {
    const hit = cached.get(platform);
    if (hit && Date.now() - hit.at < RELEASE_CACHE_MS) return hit.id;
    const { data } = await supabase
      .from("releases")
      .select("id")
      .eq("platform", platform)
      .eq("is_current", true)
      .maybeSingle();
    cached.set(platform, { id: data?.id ?? null, at: Date.now() });
    return data?.id ?? null;
  }

  return {
    async record(e) {
      const { error } = await supabase.from("download_events").insert({
        release_id: await currentReleaseId(e.platform),
        country: e.country,
        device: e.device,
        ua_family: e.uaFamily,
        referrer: e.referrer,
        ip_hash: e.ipHash,
      });
      if (error) throw new Error(error.message);
    },
  };
}
