// Chống FOUC: set theme trước first paint, đồng bộ logic với ThemeProvider.
// File riêng (không inline trong index.html) để CSP không cần script-src 'unsafe-inline' (SEC-3).
(function () {
  try {
    var t = localStorage.getItem('educenter-theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
