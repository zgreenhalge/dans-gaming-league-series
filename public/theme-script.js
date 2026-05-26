try {
  var s = localStorage.getItem('dgls-theme');
  var t = s === 'dark' || s === 'light' ? s : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
} catch (e) {}