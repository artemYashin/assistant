import test from "node:test";
import assert from "node:assert/strict";
import { zoomAtPoint } from "../src/image-zoom.js";
const image = { width: 1000, height: 800 };
const viewport = { width: 500, height: 400 };
test("wheel zoom preserves the image point under the cursor after panning", () => {
  const view = { zoom: 2, pan: { x: 30, y: -20 } };
  const point = { x: 90, y: 40 };
  const next = zoomAtPoint(view, 1.5, point, 1, image, viewport, 8);
  assert.equal(
    (point.x - next.pan.x) / next.zoom,
    (point.x - view.pan.x) / view.zoom,
  );
  assert.equal(
    (point.y - next.pan.y) / next.zoom,
    (point.y - view.pan.y) / view.zoom,
  );
  assert.deepEqual(
    zoomAtPoint(next, 1 / 1.5, point, 1, image, viewport, 8),
    view,
  );
});
test("zoom limit does not shift the image when the scale cannot increase", () => {
  const view = { zoom: 8, pan: { x: 50, y: 20 } };
  assert.deepEqual(
    zoomAtPoint(view, 2, { x: 80, y: 40 }, 1, image, viewport, 8),
    view,
  );
});
test("zooming below fit recenters the image instead of leaving it offscreen", () => {
  const next = zoomAtPoint(
    { zoom: 2, pan: { x: 90, y: 50 } },
    0.01,
    { x: 200, y: 100 },
    0.4,
    image,
    viewport,
    8,
  );
  assert.equal(next.zoom, 0.25);
  assert.equal(next.pan.x, 0);
  assert.equal(next.pan.y, 0);
});
