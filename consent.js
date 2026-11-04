// Small bottom banner asking first-time visitors to accept the Terms of Service. It never blocks the page
// (so search engines and readers see everything), but the game download waits for a yes. The choice is kept in a
// plain first-party cookie (no localStorage). Bump TERMS_VERSION when terms.html changes materially.
(function () {
  var TERMS_VERSION = '2026-11-04';
  var COOKIE = 'fatty_terms';

  function accepted() {
    return document.cookie.split('; ').indexOf(COOKIE + '=' + TERMS_VERSION) !== -1;
  }
  function remember() {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + TERMS_VERSION + '; Max-Age=31536000; Path=/; SameSite=Lax' + secure;
  }

  if (accepted()) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var overlay = el('div', 'consent');
  var box = el('div', 'consent-box');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Terms of Service');
  box.tabIndex = -1;

  var text = el('p', 'consent-text');
  text.setAttribute('aria-live', 'polite');
  var intro = el('strong', null, 'Terms of Service. ');
  var body = document.createTextNode('By using this site you agree to our terms and privacy notice, and accept that the game is installed at your own risk. ');
  var link = el('a', null, 'Read the terms');
  link.href = 'terms.html';
  text.appendChild(intro);
  text.appendChild(body);
  text.appendChild(link);

  var actions = el('div', 'consent-actions');
  var yes = el('button', 'consent-btn consent-yes', 'I agree');
  yes.type = 'button';
  var no = el('button', 'consent-btn', 'I do not agree');
  no.type = 'button';
  actions.appendChild(yes);
  actions.appendChild(no);

  box.appendChild(text);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    document.removeEventListener('click', gateDownload, true);
    overlay.remove();
  }

  function nudge(message) {
    if (message) {
      text.textContent = message;
      text.className = 'consent-text warn';
    }
    overlay.classList.remove('consent-shake');
    void overlay.offsetWidth; // restart the animation
    overlay.classList.add('consent-shake');
  }

  yes.addEventListener('click', function () {
    remember();
    close();
  });

  no.addEventListener('click', function () {
    no.hidden = true;
    nudge('You can keep reading, but you need to agree to the terms before you can download the game.');
    yes.focus();
  });

  // The download button does nothing until the terms are accepted.
  function gateDownload(e) {
    var t = e.target.closest && e.target.closest('#dl-btn, #dl-win');
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    no.hidden = true;
    nudge('Please agree to the terms to download the game.');
    yes.focus();
  }
  document.addEventListener('click', gateDownload, true);
})();
