import test from "node:test";
import assert from "node:assert/strict";
import { zoomAtPoint } from "../src/image-zoom.js";
test("wheel zoom preserves the image point under the cursor after panning", () => {
  const view = { zoom: 2, pan: { x: 30, y: -20 } };
  const point = { x: 90, y: 40 };
  const next = zoomAtPoint(view, 1.5, point, 8);
  assert.equal(
    (point.x - next.pan.x) / next.zoom,
    (point.x - view.pan.x) / view.zoom,
  );
  assert.equal(
    (point.y - next.pan.y) / next.zoom,
    (point.y - view.pan.y) / view.zoom,
  );
  assert.deepEqual(zoomAtPoint(next, 1 / 1.5, point, 8), view);
});
test("zoom limit does not shift the image when the scale cannot increase", () => {
  const view = { zoom: 8, pan: { x: 50, y: 20 } };
  assert.deepEqual(zoomAtPoint(view, 2, { x: 80, y: 40 }, 8), view);
});
test("zoom keeps cursor anchored while the image is smaller than the viewport", () => {
  const view = { zoom: 0.5, pan: { x: 0, y: 0 } };
  const point = { x: 75, y: -40 };
  const next = zoomAtPoint(view, 1.2, point, 8);
  assert.notEqual(next.pan.x, 0);
  assert.notEqual(next.pan.y, 0);
  assert.ok(
    Math.abs((point.x - next.pan.x) / next.zoom - point.x / view.zoom) < 1e-10,
  );
  assert.ok(
    Math.abs((point.y - next.pan.y) / next.zoom - point.y / view.zoom) < 1e-10,
  );
  const smaller = zoomAtPoint(next, 0.01, point, 8);
  assert.equal(smaller.zoom, 0.25);
  assert.ok(
    Math.abs((point.x - smaller.pan.x) / smaller.zoom - point.x / view.zoom) <
      1e-10,
  );
});
