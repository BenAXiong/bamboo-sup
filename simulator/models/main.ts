/**
 * Public models site: landing (boats / houses), a page per category, and one
 * model page with three big buttons, a discreet scenery switch (cycles through the
 * model's own sceneries, then none) and a part card on glass. The phone's back
 * button closes an open card or note before it leaves the page. Chinese first, English on request. Hash routes:
 *   #/  #/boats  #/houses  #/m/<model id>
 * URL params: ?still (no tips, no turntable, no analytics; for screenshots)  ?from=<tag> (QR source, for analytics)
 */
import type { Material, Mesh } from "three";

import modelsJson from "./content/models.json";
import partsJson from "./content/parts.json";
import siteJson from "./content/site.json";
import { initAnalytics, trackEvent, trackView } from "../src/site/analytics.js";
import { PartStage } from "../src/site/focus.js";
import type { ModelId } from "../src/site/modelBuild.js";
import { extractPiece, measure, pieceCount } from "../src/site/partPick.js";
import { type Pick, type Scenery, Viewer } from "../src/site/viewer.js";

type Lang = "zh" | "en";
interface ModelInfo {
  id: ModelId; cat: "boats" | "houses"; zh: string; en: string; amis: string; sub_zh: string; sub_en: string;
  /** false: listed, but tapping it only shows a "still being made" note. */
  ready: boolean;
  /** Sceneries offered, first one shown on opening; "studio" (no scenery) is always last. */
  scenes?: Scenery[];
}
interface PartInfo { zh: string; en: string; amis: string; note_zh: string; note_en: string }
const MODELS = modelsJson as ModelInfo[];
const PARTS = partsJson as Record<string, PartInfo>;
const CATS = siteJson.categories as Record<"boats" | "houses", { zh: string; en: string; amis: string }>;

const params = new URLSearchParams(location.search);
const STILL = params.has("still");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- words
const WORDS = {
  zh: {
    home: "Ciowayan 工作坊 · 3D 模型", homeLead: "點一下，選一個來看。",
    boats: "船", houses: "房子", boatsSub: "竹船、竹製立槳板", housesSub: "阿美族茅草屋、茅草棚",
    back: "返回",
    apart: "拆開", together: "組合", spin: "轉一轉", reset: "回到原位",
    bg: "背景", loading: "載入中…", tip: "點一下零件，看名字和大小",
    scenes: { studio: "無背景", shore: "海邊", sea: "海上" }, wip: "製作中", wipNote: "這個模型還在設計中，完成後就可以看了。", ok: "好",
    size: "大小", count: "數量", close: "關閉", lang: "EN",
    about: "約", long: "長", thick: "粗", m: "公尺", cm: "公分",
  },
  en: {
    home: "Ciowayan workshop · 3D models", homeLead: "Tap one to look at it.",
    boats: "Boats", houses: "Houses", boatsSub: "Bamboo boat, bamboo paddleboard", housesSub: "Amis thatched house, shelter",
    back: "Back",
    apart: "Take apart", together: "Put together", spin: "Turn", reset: "Start view",
    bg: "Scenery", loading: "Loading…", tip: "Tap a part to see its name and size",
    scenes: { studio: "No scenery", shore: "Shore", sea: "At sea" }, wip: "In progress", wipNote: "This model is still being designed. You can look at it once it is ready.", ok: "OK",
    size: "Size", count: "How many", close: "Close", lang: "中文",
    about: "about", long: "long", thick: "thick", m: "m", cm: "cm",
  },
} as const;

let lang: Lang = "zh";
try {
  const saved = localStorage.getItem("models-lang");
  if (saved === "en" || saved === "zh") lang = saved;
} catch { /* storage blocked */ }
if (params.get("lang") === "en") lang = "en";
const W = () => WORDS[lang];
const other = (): Lang => (lang === "zh" ? "en" : "zh");
/** Second name under the main one: in Chinese mode only the Amis name is shown; in English mode the Chinese one too. */
const secondName = (names: { zh: string; en: string }) => (lang === "zh" ? "" : names.zh);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------------------------------------------------------------- pages
type Route = { name: "home" } | { name: "cat"; cat: "boats" | "houses"; wip?: boolean } | { name: "model"; id: ModelId };
function parse(): Route {
  const h = location.hash.replace(/^#/, "");
  const m = /^\/m\/([\w-]+)/.exec(h);
  const model = m ? MODELS.find((x) => x.id === m[1]) : undefined;
  if (model?.ready) return { name: "model", id: model.id };
  if (model) return { name: "cat", cat: model.cat, wip: true };
  if (h === "/boats" || h === "/houses") return { name: "cat", cat: h.slice(1) as "boats" | "houses" };
  return { name: "home" };
}

const thumb = (id: string) => `./thumbs/${id}.jpg`;
function card(href: string, pic: string, name: string, otherName: string, sub: string, amis = "", wip = false): string {
  return `<a class="card${wip ? " wip" : ""}" href="${href}"${wip ? ' data-wip="1"' : ""}>
    <div class="pic" style="background-image:url('${pic}')">${wip ? `<span class="badge">${esc(W().wip)}</span>` : ""}</div>
    <div class="txt"><div class="name">${esc(name)}</div>${amis ? `<div class="amis">${esc(amis)}</div>` : ""}<div class="other">${esc(otherName)}</div><div class="sub">${esc(sub)}</div></div>
  </a>`;
}

function renderHome(): void {
  const w = W();
  const b = CATS.boats;
  const h = CATS.houses;
  // Keep each half whole on a narrow phone: wrap only at the middle dot.
  $("title").innerHTML = w.home.split(" · ").map((part) => `<span style="white-space:nowrap">${esc(part)}</span>`).join(" · ");
  $("page").innerHTML = `<p class="lead">${w.homeLead}</p><div class="cards two">
    ${card("#/houses", thumb("amis-house"), h[lang], secondName(h), w.housesSub, h.amis)}
    ${card("#/boats", thumb("palafang"), b[lang], secondName(b), w.boatsSub, b.amis)}
  </div>`;
}

function renderCat(cat: "boats" | "houses"): void {
  $("title").textContent = CATS[cat][lang];
  const list = MODELS.filter((m) => m.cat === cat);
  $("page").innerHTML = `<div class="cards">
    ${list.map((m) => card(`#/m/${m.id}`, thumb(m.id), m[lang], secondName(m), lang === "zh" ? m.sub_zh : m.sub_en, m.amis, !m.ready)).join("")}
  </div>`;
}

// ---------------------------------------------------------------- model page
let viewer: Viewer | null = null;
let stage: PartStage | null = null;
let current: ModelId | null = null;
let spinning = !STILL;

function ensureViewer(): Viewer {
  if (viewer) return viewer;
  const v = new Viewer($<HTMLCanvasElement>("scene"), { still: STILL });
  v.onUserTurn = () => {
    hideTip();
    if (spinning) setSpin(false);
  };
  v.onPick = (p) => {
    hideTip();
    if (p) openFocus(p);
  };
  viewer = v;
  if (STILL) (window as unknown as { __viewer: Viewer }).__viewer = v;
  return v;
}

const scenesOf = (id: ModelId | null): Scenery[] => {
  const own = MODELS.find((m) => m.id === id)?.scenes ?? ["shore"];
  return [...own.filter((s) => s !== "studio"), "studio"];
};
function showScenery(): void {
  const s = viewer?.scenery ?? "shore";
  $("bg-label").textContent = W().scenes[s];
  $("bg").setAttribute("aria-pressed", String(s !== "studio"));
  $("bg").setAttribute("aria-label", `${W().bg}: ${W().scenes[s]}`);
}

function setSpin(on: boolean): void {
  spinning = on;
  viewer?.setAutoRotate(on);
  $("spin").setAttribute("aria-pressed", String(on));
}

function labelButtons(): void {
  const w = W();
  $("explode-label").textContent = viewer?.exploded ? w.together : w.apart;
  $("spin-label").textContent = w.spin;
  $("reset-label").textContent = w.reset;
  showScenery();
  $("back").setAttribute("aria-label", w.back);
  $("close").setAttribute("aria-label", w.close);
}

let tipTimer = 0;
function showTip(): void {
  if (STILL) return;
  const t = $("tip");
  t.textContent = W().tip;
  t.hidden = false;
  t.style.opacity = "1";
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(hideTip, 6000);
}
function hideTip(): void {
  $("tip").style.opacity = "0";
}

function openModel(id: ModelId): void {
  const info = MODELS.find((m) => m.id === id)!;
  $("title").textContent = info[lang];
  const v = ensureViewer();
  $("scene").hidden = false;
  $("bar").hidden = false;
  $("bg").hidden = false;
  v.resize();
  if (current !== id) {
    $("loading").textContent = W().loading;
    $("loading").hidden = false;
    // Let the loading note paint before the (blocking) build.
    setTimeout(() => {
      // Keep "no scenery" if the visitor chose it; otherwise the model's own first scenery.
      if (v.scenery !== "studio") v.setScenery(scenesOf(id)[0]!);
      v.load(id);
      current = id;
      $("loading").hidden = true;
      setSpin(spinning);
      labelButtons();
      v.start();
      showTip();
      (window as unknown as { __ready: boolean }).__ready = true;
    }, 30);
  } else {
    v.start();
  }
  labelButtons();
}

function leaveModel(): void {
  closeFocus(false);
  viewer?.stop();
  $("scene").hidden = true;
  $("bar").hidden = true;
  $("bg").hidden = true;
  $("tip").hidden = true;
  $("loading").hidden = true;
}

// ---------------------------------------------------------------- part card
function fmtLen(mm: number): string {
  const w = W();
  if (mm >= 1000) return `${(Math.round(mm / 100) / 10).toString()} ${w.m}`;
  return `${Math.max(1, Math.round(mm / 10))} ${w.cm}`;
}
function sizeText(e: { long: number; mid: number; short: number }): string {
  const w = W();
  if (e.mid < e.long * 0.3) {
    // Thickness = the smallest extent: a culm with a bow rise is still only as thick as its girth.
    const t = fmtLen(e.short);
    return lang === "zh" ? `${w.long}${w.about} ${fmtLen(e.long)}，${w.thick}${w.about} ${t}` : `${w.about} ${fmtLen(e.long)} ${w.long}, ${t} ${w.thick}`;
  }
  const dims = e.short < e.mid * 0.3 ? [e.long, e.mid] : [e.long, e.mid, e.short];
  return `${w.about} ${dims.map(fmtLen).join(" × ")}`;
}

let focusKey = "";
function openFocus(p: Pick): void {
  const v = viewer!;
  const geom = extractPiece(p.mesh, p.faceIndex);
  const size = measure(geom);
  const meshes = v.meshesWithKey(p.key);
  const counts = meshes.map(pieceCount);
  const count = counts.some((c) => c === 0) ? 0 : counts.reduce((a, b) => a + b, 0);
  const part = PARTS[p.key];
  const fallback = p.key.replace(/^\w+:/, "");
  const w = W();
  const name = part ? part[lang] : fallback;
  const otherName = part ? secondName(part) : "";
  const note = part ? (lang === "zh" ? part.note_zh : part.note_en) : "";
  $("info").innerHTML = `<h2>${esc(name)}</h2>
    ${part?.amis ? `<div class="amis">${esc(part.amis)}</div>` : ""}
    ${otherName ? `<div class="other">${esc(otherName)}</div>` : ""}
    <dl><dt>${w.size}</dt><dd>${esc(sizeText(size))}</dd>${count > 1 ? `<dt>${w.count}</dt><dd>${count}</dd>` : ""}</dl>
    ${note ? `<p>${esc(note)}</p>` : ""}`;
  $("focus").hidden = false;
  pushOverlay();
  v.stop();
  stage ??= new PartStage($<HTMLCanvasElement>("part"));
  stage.show(geom, p.mesh.material as Material, size.mid < size.long * 0.3 ? size.axis : undefined);
  focusKey = p.key;
  trackEvent("part", { model: current ?? "", part: p.key });
}

// ---------------------------------------------------------------- overlays and the back button
// An open card or note adds a history entry, so the phone's back button closes it
// instead of leaving the model.
function pushOverlay(): void {
  if (!(history.state as { overlay?: boolean } | null)?.overlay) history.pushState({ overlay: true }, "");
}
/** Close whatever overlay is open, through history when it added an entry. */
function dismiss(): void {
  if ((history.state as { overlay?: boolean } | null)?.overlay) history.back();
  else closeOverlays();
}
function closeOverlays(): void {
  closeFocus();
  $("note").hidden = true;
}
window.addEventListener("popstate", () => {
  if (!(history.state as { overlay?: boolean } | null)?.overlay) closeOverlays();
});

function showWip(): void {
  const w = W();
  $("note-text").textContent = w.wipNote;
  $("note-ok").textContent = w.ok;
  $("note").hidden = false;
  pushOverlay();
}
$("page").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a[data-wip]");
  if (!a) return;
  e.preventDefault();
  showWip();
  trackEvent("wip", { model: a.getAttribute("href")?.replace("#/m/", "") ?? "" });
});
$("note-ok").addEventListener("click", dismiss);
$("note").addEventListener("click", (e) => {
  if (e.target === $("note")) dismiss();
});

function closeFocus(restart = true): void {
  if ($("focus").hidden) return;
  $("focus").hidden = true;
  stage?.clear();
  focusKey = "";
  if (restart) viewer?.start();
}

// ---------------------------------------------------------------- wiring
$("back").addEventListener("click", () => {
  const r = parse();
  if (r.name === "model") location.hash = `#/${MODELS.find((m) => m.id === r.id)!.cat}`;
  else location.hash = "#/";
});
$("lang").addEventListener("click", () => {
  lang = other();
  try {
    localStorage.setItem("models-lang", lang);
  } catch { /* storage blocked */ }
  trackEvent("language", { lang });
  route();
});
$("explode").addEventListener("click", () => {
  if (!viewer) return;
  viewer.setExploded(!viewer.exploded);
  trackEvent(viewer.exploded ? "apart" : "together", { model: current ?? "" });
  labelButtons();
});
$("spin").addEventListener("click", () => {
  setSpin(!spinning);
  trackEvent("turn", { model: current ?? "", on: spinning });
});
$("reset").addEventListener("click", () => {
  closeFocus();
  viewer?.resetView();
  labelButtons();
  trackEvent("reset", { model: current ?? "" });
});
$("bg").addEventListener("click", () => {
  if (!viewer) return;
  const list = scenesOf(current);
  const next = list[(list.indexOf(viewer.scenery) + 1) % list.length]!;
  viewer.setScenery(next);
  showScenery();
  trackEvent("scenery", { model: current ?? "", scenery: next });
});
$("close").addEventListener("click", dismiss);
$("focus").addEventListener("click", (e) => {
  if (e.target === $("focus")) dismiss();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (!$("focus").hidden || !$("note").hidden)) dismiss();
});
window.addEventListener("resize", () => {
  if (focusKey) stage?.resize();
});

function route(): void {
  const r = parse();
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  $("lang").textContent = W().lang;
  $("back").hidden = r.name === "home";
  window.scrollTo(0, 0);
  if (r.name === "model") {
    $("page").hidden = true;
    openModel(r.id);
    const info = MODELS.find((m) => m.id === r.id)!;
    document.title = `${info[lang]} · ${W().home}`;
    trackView(`/m/${r.id}`, info.en);
    return;
  }
  leaveModel();
  $("page").hidden = false;
  if (r.name === "cat") {
    renderCat(r.cat);
    trackView(`/${r.cat}`, r.cat);
    // A link straight to an unfinished model: its category, with the note on top.
    if (r.wip) showWip();
  } else {
    renderHome();
    trackView("/", "home");
  }
  document.title = $("title").textContent ?? W().home;
}

initAnalytics(siteJson.umami);
window.addEventListener("hashchange", route);
route();
