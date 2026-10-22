// Runs before anything else so the splash screen already has the user's theme (dark or light)
// and accent colour. The app saves these to localStorage every time they change.
(function () {
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("helm-boot") || "null");
  } catch (e) {
    saved = null;
  }
  var light = saved ? saved.theme === "light" : window.matchMedia("(prefers-color-scheme: light)").matches;
  var root = document.documentElement;
  root.dataset.theme = light ? "light" : "dark";
  root.style.setProperty("--splash-bg", light ? "#efefec" : "#0c0d0f");
  root.style.setProperty("--splash-track", light ? "#dcdcd7" : "#25262b");
  if (saved && /^#[0-9a-f]{6}$/i.test(saved.accent || "")) root.style.setProperty("--splash-accent", saved.accent);
})();
