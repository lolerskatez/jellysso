/* client-guide.js — CSP-safe JS for the Jellyfin Client Setup Guide */
document.addEventListener('DOMContentLoaded', function () {

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.platform-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.platform-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.platform-panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panel = document.getElementById('panel-' + tab.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Copy-to-clipboard pills ────────────────────────────────────────────────
  document.querySelectorAll('.copy-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var url = pill.dataset.url;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function () {
        var orig = pill.innerHTML;
        pill.innerHTML = '<i class="fas fa-check"></i> Copied!';
        pill.classList.add('copied');
        setTimeout(function () {
          pill.innerHTML = orig;
          pill.classList.remove('copied');
        }, 1800);
      }).catch(function () {
        // Fallback for older browsers / HTTP
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        var orig = pill.innerHTML;
        pill.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(function () { pill.innerHTML = orig; }, 1800);
      });
    });
  });

  // ── Accordion sections (common issues) ────────────────────────────────────
  document.querySelectorAll('.issue-header').forEach(function (header) {
    header.addEventListener('click', function () {
      header.closest('.issue-group').classList.toggle('open');
    });
  });

  // ── Accordion sections (setup sections) ───────────────────────────────────
  document.querySelectorAll('.section-header').forEach(function (header) {
    header.addEventListener('click', function () {
      header.closest('.section-group').classList.toggle('open');
    });
  });

});
