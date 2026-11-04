// Edit these when you ship a new APK.
const APK_PATH = 'https://pub-b506b992cfc145749e85bcb90ee6b325.r2.dev/TheFatty-v1.005.apk';
const APK_VERSION = '1.005';
// Base URL of the API for download tracking, e.g. https://thefatty-api.onrender.com. Leave empty to disable.
const API_URL = 'https://thefatty-api.onrender.com';
// Set by update-apk.sh; shown for external (R2) links where the size can't be fetched.
const APK_SIZE_MB = 54;
// Windows build (ZIP). Set by update-windows.sh; while WIN_PATH is empty the Windows button and guide stay hidden.
const WIN_PATH = 'https://pub-b506b992cfc145749e85bcb90ee6b325.r2.dev/TheFatty-Windows-v1.005.zip';
const WIN_VERSION = '1.005';
const WIN_SIZE_MB = 51;

(function () {
  document.querySelectorAll('[data-version]').forEach(function (el) { el.textContent = APK_VERSION; });

  var btn = document.getElementById('dl-btn');
  var meta = document.getElementById('dl-meta');
  var size = document.getElementById('dl-size');
  btn.setAttribute('href', APK_PATH);

  // Windows build: reveal the button, guide and FAQ once a ZIP has been published.
  var winBtn = document.getElementById('dl-win');
  if (WIN_PATH) {
    document.querySelectorAll('[data-win-version]').forEach(function (el) { el.textContent = WIN_VERSION; });
    winBtn.setAttribute('href', WIN_PATH);
    document.querySelectorAll('[data-win]').forEach(function (el) { el.hidden = false; });
    winBtn.hidden = false;
    if (WIN_SIZE_MB > 0) {
      var winSize = document.getElementById('dl-win-size');
      winSize.textContent = WIN_SIZE_MB + ' MB (Windows)';
      winSize.hidden = false;
    }
    // On a Windows computer the Windows download comes first.
    if (/Windows/.test(navigator.userAgent) && !/Phone|Mobile/.test(navigator.userAgent)) {
      document.getElementById('dl-row').classList.add('win-first');
    }
  }

  // Wake the free-tier API in the background so it is ready by the time someone clicks Download.
  if (API_URL) {
    try { fetch(API_URL + '/health', { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) {}
  }

  // Count the click. This request is fire-and-forget, so the download never waits on (or breaks with) the API.
  function track(platform) {
    if (!API_URL) return;
    var ref = '';
    try { ref = new URL(document.referrer).hostname; } catch (e) {}
    var query = '?platform=' + platform + (ref && ref.length <= 100 ? '&ref=' + encodeURIComponent(ref) : '');
    try {
      // keepalive lets the request finish even if the browser starts the download or navigates away.
      fetch(API_URL + '/api/download' + query,
        { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  btn.addEventListener('click', function () {
    if (!btn.classList.contains('unavailable')) track('android');
  });
  winBtn.addEventListener('click', function () { track('windows'); });

  // Check the APK exists and show its size. If it's missing, say so instead of giving a dead download.
  // External URLs (e.g. a GitHub Release) can't be checked from the browser because of CORS.
  if (/^https?:\/\//.test(APK_PATH)) {
    if (APK_SIZE_MB > 0) {
      size.textContent = APK_SIZE_MB + ' MB';
      size.hidden = false;
    }
    return;
  }

  fetch(APK_PATH, { method: 'HEAD' }).then(function (res) {
    if (!res.ok) throw new Error('missing');
    var bytes = parseInt(res.headers.get('content-length'), 10);
    if (bytes > 0) {
      size.textContent = (bytes / 1048576).toFixed(0) + ' MB';
      size.hidden = false;
    }
  }).catch(function () {
    btn.classList.add('unavailable');
    btn.removeAttribute('download');
    btn.setAttribute('aria-disabled', 'true');
    meta.textContent = 'APK coming soon';
  });
})();
