/**
 * Light analytics through Ben's own Umami (models/content/site.json holds the
 * script address and website id; empty = off). Hash routes are sent as page
 * views by hand. Each phone gets a random anonymous visitor id, kept in
 * localStorage, plus the ?from= tag of the QR code that brought it.
 * No names, no cookies set by this code.
 */
interface UmamiApi {
  track: (a?: unknown, b?: Record<string, unknown>) => void;
  identify?: (a: unknown, b?: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    umami?: UmamiApi;
  }
}

const queue: (() => void)[] = [];
let ready = false;
let enabled = false;
let visitor = "";
let from = "";

function store(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? "";
  } catch {
    return value ?? "";
  }
}

function run(fn: () => void): void {
  if (!enabled) return;
  if (ready && window.umami) fn();
  else queue.push(fn);
}

export function initAnalytics(cfg: { src: string; websiteId: string }): void {
  if (!cfg.src || !cfg.websiteId) return;
  if (location.hostname === "localhost" || new URLSearchParams(location.search).has("still")) return;
  enabled = true;
  visitor = store("models-visitor") || store("models-visitor", crypto.randomUUID?.() ?? String(Math.random()).slice(2));
  const tag = new URLSearchParams(location.search).get("from");
  from = tag ? store("models-from", tag.slice(0, 40)) : store("models-from");
  const s = document.createElement("script");
  s.defer = true;
  s.src = cfg.src;
  s.dataset["websiteId"] = cfg.websiteId;
  s.dataset["autoTrack"] = "false";
  s.onload = () => {
    ready = true;
    window.umami?.identify?.(visitor, { from: from || "direct" });
    for (const fn of queue.splice(0)) fn();
  };
  document.head.appendChild(s);
}

/** A page view for a hash route, e.g. "/boats" or "/m/palafang". */
export function trackView(route: string, title: string): void {
  run(() =>
    window.umami!.track((p: Record<string, unknown>) => ({
      ...p,
      // Sent as a plain path (/ciawolan/models/m/palafang): Umami may drop the #hash part.
      url: `${location.pathname.replace(/\/$/, "")}${route === "/" ? "/" : route}`,
      title,
      data: { visitor, from: from || "direct" },
    })),
  );
}

export function trackEvent(name: string, data: Record<string, string | number | boolean> = {}): void {
  run(() => window.umami!.track(name, { ...data, visitor, from: from || "direct" }));
}
