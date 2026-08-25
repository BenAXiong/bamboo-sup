/**
 * Technical views as generated SVG: side, top and a transverse section.
 *
 * This is a VIEW of the model, never a source of truth. It reads solved geometry
 * and a waterline and draws them; it computes no physics of its own.
 *
 * Everything is drawn in the world frame, after heel and trim have been applied,
 * so a heeled board looks heeled and the waterline stays where the water is.
 */

import type { CulmGeometry, Station } from "../geometry/culm.js";
import { rotate, UPRIGHT, type Attitude, type Vec3 } from "../physics/attitude.js";

export interface ViewOptions {
  attitude?: Attitude;
  waterlineZ?: number;
  /** Longitudinal position of the transverse section. Defaults to mid-hull. */
  sectionAtX?: number;
  widthPx?: number;
  title?: string;
  subtitle?: string;
}

interface Pt {
  a: number;
  b: number;
}

/** A culm's world-frame stations, with tangents rotated to match. */
interface WorldStation {
  p: Vec3;
  t: Vec3;
  r: number;
  bodyX: number;
}

function toWorld(geom: CulmGeometry, attitude: Attitude): WorldStation[] {
  return geom.stations.map((st: Station) => ({
    p: rotate({ x: st.x_mm, y: st.y_mm, z: st.z_mm }, attitude),
    t: rotate(st.tangent, attitude),
    r: st.r_mm,
    bodyX: st.x_mm,
  }));
}

/**
 * Silhouette of a tube projected onto a plane.
 *
 * Orthographically, the outline is the centreline offset by the radius along the
 * in-plane normal to the projected axis. Where the axis points nearly at the
 * viewer the projected tangent collapses, and the previous usable normal is
 * carried forward rather than letting the outline spin.
 */
function silhouette(
  stations: WorldStation[],
  project: (p: Vec3) => Pt,
  projectDir: (v: Vec3) => Pt,
): { upper: Pt[]; lower: Pt[] } {
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  let normal: Pt = { a: 0, b: 1 };

  for (const st of stations) {
    const c = project(st.p);
    const d = projectDir(st.t);
    const len = Math.hypot(d.a, d.b);
    if (len > 1e-6) normal = { a: -d.b / len, b: d.a / len };
    upper.push({ a: c.a + normal.a * st.r, b: c.b + normal.b * st.r });
    lower.push({ a: c.a - normal.a * st.r, b: c.b - normal.b * st.r });
  }
  return { upper, lower };
}

interface Panel {
  label: string;
  /** Outline polygons in view coordinates, plus optional circles for sections. */
  polygons: Pt[][];
  circles: { c: Pt; r: number }[];
  /** Waterline height in the panel's vertical axis, if the panel has one. */
  waterlineB?: number;
  /** Axis names for the caption. */
  axes: string;
}

const PANEL_GAP = 40;
const MARGIN = 44;

export function renderViews(geoms: CulmGeometry[], options: ViewOptions = {}): string {
  const attitude = options.attitude ?? UPRIGHT;
  const width = options.widthPx ?? 900;
  const world = geoms.map((g) => toWorld(g, attitude));

  const sectionX =
    options.sectionAtX ??
    (Math.min(...geoms.map((g) => g.x_aft_mm)) + Math.max(...geoms.map((g) => g.x_fore_mm))) / 2;

  // Side view: x to the right, z up. SVG y grows downward, so b is negated later.
  const side: Panel = {
    label: "side",
    axes: "x / z",
    polygons: world.map((w) => {
      const s = silhouette(w, (p) => ({ a: p.x, b: p.z }), (v) => ({ a: v.x, b: v.z }));
      return [...s.upper, ...s.lower.slice().reverse()];
    }),
    circles: [],
    waterlineB: options.waterlineZ,
  };

  // Top view: x to the right, y up the page.
  const top: Panel = {
    label: "top",
    axes: "x / y",
    polygons: world.map((w) => {
      const s = silhouette(w, (p) => ({ a: p.x, b: p.y }), (v) => ({ a: v.x, b: v.y }));
      return [...s.upper, ...s.lower.slice().reverse()];
    }),
    circles: [],
  };

  // Transverse section: y to the right, z up, cut at one longitudinal station.
  const front: Panel = {
    label: `section at x = ${sectionX.toFixed(0)} mm`,
    axes: "y / z",
    polygons: [],
    circles: world
      .map((w) => sectionCircle(w, sectionX))
      .filter((c): c is { c: Pt; r: number } => c !== undefined),
    waterlineB: options.waterlineZ,
  };

  return compose([side, top, front], width, options);
}

/** The culm's section where it crosses a given body-frame station, in world y-z. */
function sectionCircle(
  stations: WorldStation[],
  bodyX: number,
): { c: Pt; r: number } | undefined {
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1] as WorldStation;
    const b = stations[i] as WorldStation;
    if ((a.bodyX <= bodyX && bodyX <= b.bodyX) || (b.bodyX <= bodyX && bodyX <= a.bodyX)) {
      const span = b.bodyX - a.bodyX;
      const t = span !== 0 ? (bodyX - a.bodyX) / span : 0;
      return {
        c: { a: a.p.y + t * (b.p.y - a.p.y), b: a.p.z + t * (b.p.z - a.p.z) },
        r: a.r + t * (b.r - a.r),
      };
    }
  }
  return undefined;
}

function bounds(panel: Panel): { minA: number; maxA: number; minB: number; maxB: number } {
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  const see = (a: number, b: number) => {
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  };
  for (const poly of panel.polygons) for (const p of poly) see(p.a, p.b);
  for (const c of panel.circles) {
    see(c.c.a - c.r, c.c.b - c.r);
    see(c.c.a + c.r, c.c.b + c.r);
  }
  if (panel.waterlineB !== undefined) see(minA, panel.waterlineB);
  return { minA, maxA, minB, maxB };
}

function compose(panels: Panel[], width: number, options: ViewOptions): string {
  const drawWidth = width - 2 * MARGIN;
  const boxes = panels.map(bounds);

  // One scale across every panel, so proportions can be compared between views.
  const widest = Math.max(...boxes.map((b) => b.maxA - b.minA));
  const scale = drawWidth / widest;

  const heights = boxes.map((b) => Math.max((b.maxB - b.minB) * scale, 8));
  const headerHeight = options.title ? 54 : 0;
  const totalHeight =
    headerHeight +
    MARGIN +
    heights.reduce((s, h) => s + h + PANEL_GAP + 18, 0) +
    MARGIN;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight.toFixed(0)}" ` +
      `width="${width}" height="${totalHeight.toFixed(0)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  parts.push(STYLE);
  parts.push(`<rect width="100%" height="100%" class="bg"/>`);

  if (options.title) {
    parts.push(`<text x="${MARGIN}" y="26" class="title">${escapeXml(options.title)}</text>`);
    if (options.subtitle) {
      parts.push(
        `<text x="${MARGIN}" y="44" class="subtitle">${escapeXml(options.subtitle)}</text>`,
      );
    }
  }

  let cursorY = headerHeight + MARGIN;

  panels.forEach((panel, i) => {
    const box = boxes[i] as ReturnType<typeof bounds>;
    const h = heights[i] as number;
    const x = (a: number) => MARGIN + (a - box.minA) * scale;
    // SVG y grows downward; the model's vertical axes grow upward.
    const y = (b: number) => cursorY + (box.maxB - b) * scale;

    parts.push(`<text x="${MARGIN}" y="${(cursorY - 8).toFixed(1)}" class="label">${escapeXml(panel.label)} &#183; ${panel.axes}</text>`);

    if (panel.waterlineB !== undefined) {
      const wy = y(panel.waterlineB);
      parts.push(
        `<rect x="${MARGIN}" y="${wy.toFixed(1)}" width="${drawWidth}" ` +
          `height="${Math.max(0, cursorY + h - wy).toFixed(1)}" class="water"/>`,
        `<line x1="${MARGIN}" y1="${wy.toFixed(1)}" x2="${(MARGIN + drawWidth).toFixed(1)}" y2="${wy.toFixed(1)}" class="waterline"/>`,
      );
    }

    for (const poly of panel.polygons) {
      const d = poly.map((p, j) => `${j === 0 ? "M" : "L"}${x(p.a).toFixed(2)},${y(p.b).toFixed(2)}`).join("");
      parts.push(`<path d="${d}Z" class="culm"/>`);
    }
    for (const c of panel.circles) {
      parts.push(
        `<ellipse cx="${x(c.c.a).toFixed(2)}" cy="${y(c.c.b).toFixed(2)}" ` +
          `rx="${(c.r * scale).toFixed(2)}" ry="${(c.r * scale).toFixed(2)}" class="culm"/>`,
      );
    }

    // A scale bar beats tick labels for something read at a glance.
    const barMm = niceRound(((box.maxA - box.minA) * 0.25));
    const barPx = barMm * scale;
    const barY = cursorY + h + 14;
    parts.push(
      `<line x1="${MARGIN}" y1="${barY.toFixed(1)}" x2="${(MARGIN + barPx).toFixed(1)}" y2="${barY.toFixed(1)}" class="scalebar"/>`,
      `<text x="${(MARGIN + barPx + 8).toFixed(1)}" y="${(barY + 4).toFixed(1)}" class="caption">${barMm} mm</text>`,
    );

    cursorY += h + PANEL_GAP + 18;
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/** Round a span down to something a person would put on a scale bar. */
function niceRound(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

const STYLE = `<style>
  .bg { fill: #ffffff; }
  .culm { fill: rgba(120, 110, 90, 0.28); stroke: #4a4436; stroke-width: 1.1; stroke-linejoin: round; }
  .water { fill: rgba(70, 130, 180, 0.16); }
  .waterline { stroke: #2f6f9f; stroke-width: 1.2; stroke-dasharray: 6 4; }
  .title { font-size: 15px; font-weight: 600; fill: #1a1a1a; }
  .subtitle, .caption { font-size: 11px; fill: #6a6a6a; }
  .label { font-size: 11px; fill: #6a6a6a; letter-spacing: 0.04em; }
  .scalebar { stroke: #6a6a6a; stroke-width: 1; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #14161a; }
    .culm { fill: rgba(214, 196, 150, 0.22); stroke: #d6c496; }
    .water { fill: rgba(120, 180, 230, 0.15); }
    .waterline { stroke: #7fb6e0; }
    .title { fill: #f0efec; }
    .subtitle, .caption, .label { fill: #9a9a95; }
    .scalebar { stroke: #9a9a95; }
  }
</style>`;

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );
}
