/**
 * Theme initialiser — loaded early in <body> from the navigation partial.
 * Reads the saved preference from localStorage and applies data-theme to <html>
 * before the page content renders, preventing a flash of the wrong theme.
 *
 * Called from admin-settings.js via window.applyTheme(t) after the user saves.
 */
(function () {
  function applyTheme(t) {
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      // 'auto' — follow system preference
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
  }

  // Expose globally so admin-settings.js can call it immediately after a save
  window.applyTheme = applyTheme;

  // Apply on load
  var saved = localStorage.getItem('app-theme') || 'auto';
  applyTheme(saved);

  // Re-apply if system preference changes while the page is open (only relevant for 'auto')
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if ((localStorage.getItem('app-theme') || 'auto') === 'auto') {
        applyTheme('auto');
      }
    });
  }
})();
