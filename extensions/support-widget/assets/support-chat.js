(function () {
  "use strict";

  var doc = document;
  var mount = doc.getElementById("vs-support-chat");
  if (!mount || mount.getAttribute("data-ready")) return;
  mount.setAttribute("data-ready", "true");

  var src = mount.getAttribute("data-app-src");
  var wantOpen = false;
  var script = null;

  function start() {
    window.VanishedSupportChat.start(mount, wantOpen);
    wantOpen = false;
  }

  function load(open) {
    if (open) wantOpen = true;
    if (window.VanishedSupportChat) return start();
    if (script || !src) return;
    script = doc.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = function () { if (wantOpen) start(); };
    script.onerror = function () { script = null; };
    doc.head.appendChild(script);
  }

  var launcher = doc.createElement("button");
  launcher.type = "button";
  launcher.className = "vs-chat__launcher";
  launcher.setAttribute("data-vs-placeholder", "");
  launcher.setAttribute("aria-label", "Open support chat");
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.4L4 21.5V6a2 2 0 0 1 0-2zm0 2v11.6L7.6 15H20V6H4zm3 3h10v2H7V9zm0-3h10v2H7V6z" transform="translate(0 1)"/></svg>' +
    '<span class="vs-chat__launcher-label">Help</span>';
  launcher.addEventListener("click", function () { load(true); });
  launcher.addEventListener("pointerenter", function () { load(false); }, { once: true });
  launcher.addEventListener("focus", function () { load(false); }, { once: true });
  mount.appendChild(launcher);

  doc.addEventListener("click", function (e) {
    var trigger = e.target && e.target.closest && e.target.closest("[data-vs-open-chat]");
    if (trigger) {
      e.preventDefault();
      load(true);
    }
  });

  try {
    var saved = JSON.parse(window.sessionStorage.getItem("vs-chat-v1") || "null");
    if (saved && saved.open) load(true);
  } catch (e) { /* storage unavailable */ }

  /* Stay above the theme's sticky buy bar when it's visible. */
  function updateOffset() {
    var bar = doc.querySelector(".vpn-sticky-buy");
    var offset = 0;
    if (bar && !bar.classList.contains("is-hidden")) {
      var style = window.getComputedStyle(bar);
      if (style.display !== "none" && style.visibility !== "hidden") offset = bar.getBoundingClientRect().height;
    }
    mount.style.setProperty("--vs-bottom-extra", offset + "px");
  }
  updateOffset();
  window.addEventListener("resize", updateOffset, { passive: true });
  window.addEventListener("scroll", updateOffset, { passive: true });
  var bar = doc.querySelector(".vpn-sticky-buy");
  if (bar && window.MutationObserver) {
    new MutationObserver(updateOffset).observe(bar, { attributes: true, attributeFilter: ["class", "style"] });
  }
})();
