/**
 * Troubleshooting page — accordion + tab interactions
 * No inline handlers (CSP-compliant)
 */
document.addEventListener('DOMContentLoaded', function () {

  // ── Accordion ──────────────────────────────────────────────
  document.querySelectorAll('.issue-header').forEach(function (header) {
    header.addEventListener('click', function () {
      header.closest('.issue-group').classList.toggle('open');
    });
  });

  // ── Platform tabs ──────────────────────────────────────────
  document.querySelectorAll('.platform-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.platform-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      document.querySelectorAll('.platform-panel').forEach(function (p) {
        p.classList.remove('active');
      });
      tab.classList.add('active');
      var panel = document.getElementById('panel-' + tab.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Copy server URL ────────────────────────────────────────
  var pill = document.getElementById('serverUrlPill');
  if (pill) {
    pill.addEventListener('click', function () {
      var url = pill.dataset.url;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function () {
        var orig = pill.innerHTML;
        pill.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(function () { pill.innerHTML = orig; }, 1800);
      });
    });
  }

});
