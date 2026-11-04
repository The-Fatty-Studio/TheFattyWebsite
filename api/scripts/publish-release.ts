// Usage: npm run release -- <path-to-apk-or-zip> <version> [notes] [--platform android|windows] [--dry-run]
// Uploads the build to Cloudflare R2, records it in `releases` and marks it current for its platform
// (android: the .apk, windows: the .zip).
// Progress goes to stderr; the final stdout line is JSON ({ url, sizeBytes }) for update-apk.sh.
import "dotenv/config";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, statSync } from "node:fs";
import { z } from "zod";

const env = z
  .object({
    SUPABASE_URL: z.string().url().regex(/^https?:\/\//),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_PUBLIC_URL: z.string().url().regex(/^https?:\/\//).transform((u) => u.replace(/\/+$/, "")),
  })
  .safeParse(process.env);

const log = (msg: string) => console.error(msg);
const fail = (msg: string): never => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

if (!env.success) {
  fail(`missing/invalid in api/.env: ${env.error.issues.map((i) => i.path.join(".")).join(", ")}`);
}
const cfg = env.data!;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const platformAt = args.indexOf("--platform");
const platform = platformAt >= 0 ? args[platformAt + 1] : "android";
if (platform !== "android" && platform !== "windows") fail(`--platform must be android or windows, got: ${platform}`);
const positional = args.filter((a, i) => a !== "--dry-run" && a !== "--platform" && (platformAt < 0 || i !== platformAt + 1));
const [apkPath, version, notes] = positional;

if (!apkPath || !version) fail("usage: npm run release -- <path> <version> [notes] [--platform android|windows] [--dry-run]");
if (!/^\d+(\.\d+){1,2}$/.test(version!)) fail(`version must look like 1.1 or 1.1.2, got: ${version}`);

let sizeBytes = 0;
try {
  sizeBytes = statSync(apkPath!).size;
} catch {
  fail(`file not found: ${apkPath}`);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY },
  // R2 does not support the SDK's newer default checksums.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const isWindows = platform === "windows";
const key = isWindows ? `TheFatty-Windows-v${version}.zip` : `TheFatty-v${version}.apk`;
const url = `${cfg.R2_PUBLIC_URL}/${key}`;

// Checks that run in both modes, so --dry-run proves credentials and schema without uploading.
try {
  await s3.send(new HeadBucketCommand({ Bucket: cfg.R2_BUCKET }));
  log("R2 bucket reachable.");
} catch (e) {
  fail(`cannot access R2 bucket "${cfg.R2_BUCKET}": ${(e as Error).message}`);
}

const existing = await supabase.from("releases").select("id").eq("platform", platform).eq("version", version!).maybeSingle();
if (existing.error) fail(`cannot read releases (did you run the migrations?): ${existing.error.message}`);
if (existing.data) fail(`${platform} version ${version} already exists in releases; use a new version number`);
log("Supabase reachable, version is new.");

if (dryRun) {
  log(`Dry run OK. Would upload ${(sizeBytes / 1048576).toFixed(1)} MB to ${url}`);
  process.exit(0);
}

log(`Uploading ${key} (${(sizeBytes / 1048576).toFixed(1)} MB)...`);
await new Upload({
  client: s3,
  params: {
    Bucket: cfg.R2_BUCKET,
    Key: key,
    Body: createReadStream(apkPath!),
    ContentType: isWindows ? "application/zip" : "application/vnd.android.package-archive",
    ContentDisposition: `attachment; filename="${isWindows ? "TheFatty-Windows.zip" : "TheFatty.apk"}"`,
    CacheControl: "public, max-age=31536000, immutable", // versioned key, never overwritten
  },
}).done();

// The partial unique index allows one current release, so clear the old one before setting the new one.
const inserted = await supabase
  .from("releases")
  .insert({ version, platform, r2_key: key, size_bytes: sizeBytes, notes: notes ?? null, is_current: false })
  .select("id")
  .single();
if (inserted.error) fail(`uploaded to R2 but could not record the release: ${inserted.error.message}`);

const cleared = await supabase.from("releases").update({ is_current: false }).eq("platform", platform).eq("is_current", true);
if (cleared.error) fail(`release ${version} recorded but could not clear the old current: ${cleared.error.message}`);

const marked = await supabase.from("releases").update({ is_current: true }).eq("id", inserted.data!.id);
if (marked.error) fail(`release ${version} recorded but could not mark it current: ${marked.error.message}`);

log("Release recorded and marked current.");
console.log(JSON.stringify({ url, sizeBytes }));
