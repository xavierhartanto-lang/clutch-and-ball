(function () {
  const STORAGE_KEY = 'cab-theme';

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function updateToggleButton() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    var light = getTheme() === 'light';
    btn.setAttribute('aria-pressed', light ? 'true' : 'false');
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    btn.textContent = light ? 'Dark' : 'Light';
  }

  function toggleTheme() {
    var next = getTheme() === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      localStorage.setItem(STORAGE_KEY, 'light');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    applyTheme(next);
    updateToggleButton();
  }

  function init() {
    applyTheme(getTheme());

    if (document.querySelector('.theme-toggle')) {
      updateToggleButton();
      document.querySelectorAll('.theme-toggle').forEach(function (btn) {
        btn.addEventListener('click', toggleTheme);
      });
      return;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', toggleTheme);

    var nav = document.querySelector('header.site-top-bar nav') || document.querySelector('nav');
    if (nav) {
      nav.appendChild(btn);
    } else {
      var wrap = document.createElement('div');
      wrap.className = 'theme-toggle-floating';
      wrap.appendChild(btn);
      document.body.insertBefore(wrap, document.body.firstChild);
    }
    updateToggleButton();
  }

  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      applyTheme(getTheme());
      updateToggleButton();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
