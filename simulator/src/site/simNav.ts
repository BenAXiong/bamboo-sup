/**
 * Small top bar shared by the experiment viewers under /sim/ (hut, raft, SUP):
 * one link to each, plus the public models site. Injected by each viewer's
 * main.ts; the links are relative, so it works under any repo name.
 */
const LINKS = [
  { id: "hut", label: "Hut", href: "../hut/" },
  { id: "raft", label: "Raft", href: "../raft/" },
  { id: "sup", label: "SUP", href: "../sup/" },
  { id: "models", label: "Models ↗", href: "../../models/" },
] as const;

export function mountSimNav(current: "hut" | "raft" | "sup"): void {
  if (new URLSearchParams(location.search).has("still")) return;
  const nav = document.createElement("nav");
  nav.id = "sim-nav";
  nav.innerHTML = LINKS.map(
    (l) => `<a href="${l.href}"${l.id === current ? ' aria-current="page"' : ""}>${l.label}</a>`,
  ).join("");
  const css = document.createElement("style");
  css.textContent = `
    #sim-nav { position: fixed; left: 50%; bottom: max(10px, env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 50;
      display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(30, 24, 18, 0.72); backdrop-filter: blur(6px);
      font: 600 13px system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.18); }
    #sim-nav a { color: #f3ece1; text-decoration: none; padding: 6px 12px; border-radius: 999px; white-space: nowrap; }
    #sim-nav a:hover { background: rgba(255,255,255,0.12); }
    #sim-nav a[aria-current] { background: #f3ece1; color: #2a2118; }
  `;
  document.head.appendChild(css);
  document.body.appendChild(nav);
}
