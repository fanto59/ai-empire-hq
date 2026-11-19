import assert from "node:assert/strict";
import { test } from "node:test";
import { depthOf, screenToTile, tileDiamond, tileToScreen } from "./iso";

test("tileToScreen and screenToTile round-trip tile centers", () => {
  for (let col = 0; col < 10; col++) {
    for (let row = 0; row < 10; row++) {
      const center = tileToScreen({ col: col + 0.5, row: row + 0.5 });
      assert.deepEqual(screenToTile(center), { col, row });
    }
  }
});

test("depth grows toward the viewer", () => {
  assert.ok(depthOf({ col: 2, row: 3 }) > depthOf({ col: 1, row: 3 }));
  assert.ok(depthOf({ col: 2, row: 3 }) > depthOf({ col: 2, row: 2 }));
});

test("tileDiamond returns four corners, top first", () => {
  const [top, right, bottom, left] = tileDiamond({ col: 0, row: 0 });
  assert.deepEqual(top, { x: 0, y: 0 });
  assert.deepEqual(right, { x: 32, y: 16 });
  assert.deepEqual(bottom, { x: 0, y: 32 });
  assert.deepEqual(left, { x: -32, y: 16 });
});
