// Bottom tab bar + "More" sheet shared by the main pages.
// Usage: <script src="/tabbar.js" data-tab="today"></script>  (today | work | us | more)
// Pages that need the whole screen for a chat can call window.SevenTabbar.hide() / .show().
(function () {
  const script = document.currentScript;
  const active = script?.dataset.tab || "";

  // Let content run under the iPhone home indicator; the bar pads itself.
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && !/viewport-fit/.test(vp.content)) vp.content += ", viewport-fit=cover";

  const TABS = [
    { key: "today", href: "/today.html", label: "Today",
      icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
    { key: "work", href: "/argue.html", label: "Work it out",
      icon: '<path d="M7 8h10M7 12h6"/><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>' },
    { key: "us", href: "/us.html", label: "Us",
      icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>' },
    { key: "more", href: "#more", label: "More",
      icon: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>' }
  ];

  const MORE = [
    { href: "/report.html", label: "Marriage Report", hint: "Your seven-season forecast" },
    { href: "/insights.html", label: "What Seven noticed", hint: "Every insight from discovery" },
    { href: "/seasons.html", label: "Our Season", hint: "Where you are in the journey" },
    { href: "/decide.html", label: "Big Decisions", hint: "Work through a decision together" },
    { href: "/moc-board.html", label: "MOC Board", hint: "Your trusted counselors" },
    { href: "/timeline.html", label: "Our Timeline", hint: "Milestones and moments" },
    { href: "/onboarding.html", label: "My Discovery", hint: "Your ten discovery conversations" },
    { href: "/final-interview.html", label: "Final Interview", hint: "Your joint session with Seven" },
    { href: "/premarital.html", label: "Premarital Sessions", hint: "For engaged couples", track: "premarital" }
  ];

  const css = `
    :root { --tabbar-h: calc(58px + env(safe-area-inset-bottom)); }
    body.has-tabbar { padding-bottom: var(--tabbar-h) !important; }
    body.has-tabbar .topbar-nav { display: none !important; }
    .s7-tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; display: flex;
      background: rgba(255,255,255,0.96); backdrop-filter: saturate(180%) blur(12px); -webkit-backdrop-filter: saturate(180%) blur(12px);
      border-top: 1px solid #E0D9D0; padding-bottom: env(safe-area-inset-bottom); }
    body.tabbar-hidden .s7-tabbar { display: none; }
    body.tabbar-hidden.has-tabbar { padding-bottom: 0 !important; }
    .s7-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
      height: 58px; color: #8C8178; text-decoration: none; font: 500 0.68rem "Inter", -apple-system, sans-serif;
      background: none; border: none; cursor: pointer; -webkit-tap-highlight-color: transparent; position: relative; }
    .s7-tab svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .s7-tab[data-key="more"] svg { fill: currentColor; stroke: none; }
    .s7-tab.active { color: #1C2B3A; }
    .s7-tab.active svg { stroke-width: 2.1; }
    .s7-tab.active::after { content: ""; position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: #C4963A; }
    .s7-sheet-backdrop { position: fixed; inset: 0; background: rgba(28,43,58,0.35); z-index: 950; opacity: 0; pointer-events: none; transition: opacity .2s; }
    .s7-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 960; background: #FAF8F4; border-radius: 18px 18px 0 0;
      max-height: 82vh; overflow-y: auto; transform: translateY(100%); transition: transform .25s ease;
      padding: 0.5rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom)); font-family: "Inter", -apple-system, sans-serif; }
    .s7-sheet.open { transform: none; }
    .s7-sheet-backdrop.open { opacity: 1; pointer-events: auto; }
    .s7-grabber { width: 38px; height: 5px; border-radius: 3px; background: #E0D9D0; margin: 0.4rem auto 1rem; }
    .s7-sheet h3 { font: 600 1.4rem "Cormorant Garamond", Georgia, serif; color: #1C2B3A; margin: 0 0 0.75rem; }
    .s7-sheet a, .s7-sheet button.s7-row { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 0.85rem 1rem;
      background: white; border: 1px solid #E0D9D0; border-radius: 12px; margin-bottom: 0.5rem; text-decoration: none; cursor: pointer; font: inherit; }
    .s7-sheet .s7-label { color: #1C2B3A; font-size: 0.95rem; font-weight: 500; }
    .s7-sheet .s7-hint { color: #8C8178; font-size: 0.78rem; margin-top: 2px; }
    .s7-sheet .s7-signout .s7-label { color: #A0453A; }
  `;

  function svg(paths) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`; }

  function mount() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    document.body.classList.add("has-tabbar");

    const bar = document.createElement("nav");
    bar.className = "s7-tabbar";
    bar.setAttribute("aria-label", "Main");
    bar.innerHTML = TABS.map(t => t.key === "more"
      ? `<button class="s7-tab${active === t.key ? " active" : ""}" data-key="more" type="button">${svg(t.icon)}<span>${t.label}</span></button>`
      : `<a class="s7-tab${active === t.key ? " active" : ""}" data-key="${t.key}" href="${t.href}"${active === t.key ? ' aria-current="page"' : ""}>${svg(t.icon)}<span>${t.label}</span></a>`
    ).join("");
    document.body.appendChild(bar);

    const backdrop = document.createElement("div");
    backdrop.className = "s7-sheet-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "s7-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "More");
    const track = localStorage.getItem("7s_track");
    sheet.innerHTML = `<div class="s7-grabber"></div><h3>More</h3>` +
      MORE.filter(m => !m.track || m.track === track)
        .map(m => `<a href="${m.href}"><span class="s7-label">${m.label}</span><span class="s7-hint">${m.hint}</span></a>`).join("") +
      `<button class="s7-row s7-signout" type="button"><span class="s7-label">Sign out</span><span class="s7-hint">Or switch to another account</span></button>`;
    document.body.append(backdrop, sheet);

    const open = () => { backdrop.classList.add("open"); sheet.classList.add("open"); };
    const close = () => { backdrop.classList.remove("open"); sheet.classList.remove("open"); };
    bar.querySelector('[data-key="more"]').addEventListener("click", open);
    backdrop.addEventListener("click", close);
    sheet.querySelector(".s7-signout").addEventListener("click", async () => {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
      localStorage.clear();
      location.href = "/login.html";
    });
  }

  window.SevenTabbar = {
    hide() { document.body.classList.add("tabbar-hidden"); },
    show() { document.body.classList.remove("tabbar-hidden"); }
  };

  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
