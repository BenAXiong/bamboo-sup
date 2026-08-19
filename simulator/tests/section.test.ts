import { describe, expect, it } from "vitest";

import {
  circularSegmentArea,
  culmSectionArea,
  ellipticalSegmentArea,
} from "../src/physics/section.js";

describe("circular segment area", () => {
  const r = 100;

  it("is zero when clear of the water", () => {
    expect(circularSegmentArea(r, 0)).toBe(0);
    expect(circularSegmentArea(r, -5)).toBe(0);
  });

  it("is the full circle when submerged", () => {
    expect(circularSegmentArea(r, 2 * r)).toBeCloseTo(Math.PI * r * r, 9);
    expect(circularSegmentArea(r, 500)).toBeCloseTo(Math.PI * r * r, 9);
  });

  it("is half the circle at the axis", () => {
    expect(circularSegmentArea(r, r)).toBeCloseTo((Math.PI * r * r) / 2, 9);
  });

  it("is symmetric: a segment and its complement fill the circle", () => {
    for (const h of [1, 17, 55, 99, 140, 199]) {
      const sum = circularSegmentArea(r, h) + circularSegmentArea(r, 2 * r - h);
      expect(sum).toBeCloseTo(Math.PI * r * r, 6);
    }
  });

  it("matches the quarter-depth value computed by hand", () => {
    // h = r/2: A = r^2*acos(1/2) - (r/2)*sqrt(3)/2*r = r^2*(pi/3 - sqrt(3)/4)
    const expected = r * r * (Math.PI / 3 - Math.sqrt(3) / 4);
    expect(circularSegmentArea(r, r / 2)).toBeCloseTo(expected, 9);
  });
});

describe("elliptical segment area", () => {
  it("reduces to the circular case when the axes are equal", () => {
    for (const h of [0, 30, 100, 170, 200]) {
      expect(ellipticalSegmentArea(100, 100, h)).toBeCloseTo(circularSegmentArea(100, h), 9);
    }
  });

  it("is the full ellipse when submerged", () => {
    expect(ellipticalSegmentArea(100, 160, 320)).toBeCloseTo(Math.PI * 100 * 160, 9);
  });

  it("is half the ellipse at the axis", () => {
    expect(ellipticalSegmentArea(100, 160, 160)).toBeCloseTo((Math.PI * 100 * 160) / 2, 9);
  });

  it("scales the circular result by the vertical stretch", () => {
    // A tube inclined at 60 degrees: vertical semi-axis is r/cos(60) = 2r.
    const r = 100;
    const b = r / Math.cos(Math.PI / 3);
    // Depth h on the ellipse corresponds to h/k on the circle, k = b/a.
    const h = 90;
    const k = b / r;
    expect(ellipticalSegmentArea(r, b, h)).toBeCloseTo(k * circularSegmentArea(r, h / k), 9);
  });
});

describe("culm section area", () => {
  const a = 100;

  it("displaces the full outside section when sealed", () => {
    expect(culmSectionArea(a, a, 2 * a, 90, 0)).toBeCloseTo(Math.PI * a * a, 9);
  });

  it("loses the bore when fully flooded", () => {
    const inner = 90;
    const expected = Math.PI * a * a - Math.PI * inner * inner;
    expect(culmSectionArea(a, a, 2 * a, inner, 1)).toBeCloseTo(expected, 6);
  });

  it("scales linearly between sealed and flooded", () => {
    const inner = 90;
    const sealed = culmSectionArea(a, a, 2 * a, inner, 0);
    const flooded = culmSectionArea(a, a, 2 * a, inner, 1);
    const half = culmSectionArea(a, a, 2 * a, inner, 0.5);
    expect(half).toBeCloseTo((sealed + flooded) / 2, 9);
  });
});
