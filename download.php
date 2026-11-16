<?php
// Same-domain download: streams the APK / Windows installer from Cloudflare R2, so the link and the
// file name stay on thefatty.ko-solutions.net. The R2 URLs are read from script.js (the release
// scripts keep them current), so nothing here changes per release.
//   download.php?f=android   or   download.php?f=windows

const ALLOWED_HOST_SUFFIXES = ['.r2.dev', '.r2.cloudflarestorage.com'];

function fail(int $code, string $msg): never {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $msg;
    exit;
}

$which = $_GET['f'] ?? '';
$const = ['android' => 'APK_PATH', 'windows' => 'WIN_PATH'][$which] ?? null;
if ($const === null) fail(404, 'Unknown download.');

$js = @file_get_contents(__DIR__ . '/script.js');
if ($js === false || !preg_match("/^const $const = '([^']*)';/m", $js, $m) || $m[1] === '') fail(404, 'Not available yet.');
$url = $m[1];

// Only ever fetch from our own R2 bucket host, never an arbitrary URL.
$parts = parse_url($url);
$host = strtolower($parts['host'] ?? '');
$ok = ($parts['scheme'] ?? '') === 'https';
$okHost = false;
foreach (ALLOWED_HOST_SUFFIXES as $suffix) if (str_ends_with($host, $suffix)) $okHost = true;
if (!$ok || !$okHost) fail(500, 'Download is misconfigured.');

$name = basename($parts['path'] ?? 'download');
if (!preg_match('/^[A-Za-z0-9._-]{1,100}$/', $name)) fail(500, 'Download is misconfigured.');

// No cURL on this host: fall back to a plain redirect so the download still works.
if (!function_exists('curl_init')) {
    header('Location: ' . $url, true, 302);
    exit;
}

@set_time_limit(0);
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) @ob_end_clean();

$range = $_SERVER['HTTP_RANGE'] ?? '';
$headers = [];
if (preg_match('/^bytes=\d*-\d*$/', $range)) $headers[] = 'Range: ' . $range;

$sent = false;
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$sent, $name) {
        $len = strlen($line);
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $s)) {
            $code = (int)$s[1];
            if ($code !== 200 && $code !== 206 && $code !== 416) fail(502, 'Download source unavailable.');
            http_response_code($code);
            header('Content-Disposition: attachment; filename="' . $name . '"');
            header('Accept-Ranges: bytes');
            header('Cache-Control: public, max-age=300');
            header('X-Content-Type-Options: nosniff');
            $sent = true;
        } elseif (preg_match('/^(Content-Length|Content-Range|Content-Type|ETag|Last-Modified):/i', $line)) {
            header(trim($line));
        }
        return $len;
    },
    CURLOPT_WRITEFUNCTION => function ($ch, $data) {
        echo $data;
        flush();
        return strlen($data);
    },
]);
$res = curl_exec($ch);
if ($res === false && !$sent) fail(502, 'Download source unavailable.');
curl_close($ch);
