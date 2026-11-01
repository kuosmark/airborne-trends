import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectAircraft } from '../src/aircraft-map-projection.ts';

test('projects coordinates consistently with the bundled world outline and keeps world edges visible', () => {
  const [x, y] = projectAircraft(0, 0);
  // Subpixel tolerance in the outline's 800 × 412 SVG coordinate system.
  assert.ok(Math.abs(x - 400) < 0.1);
  assert.ok(Math.abs(y - 202.98) < 0.1);
  for (const [latitude, longitude] of [[90, 0], [-90, 0], [0, 180], [0, -180], [60, 25]]) {
    const [x, y] = projectAircraft(latitude, longitude);
    assert.ok(x >= 0 && x <= 800 && y >= 0 && y <= 412);
  }
  assert.ok(projectAircraft(60, 25)[1] < projectAircraft(0, 25)[1]);
});

test('invalid coordinates cannot create map points', () => {
  assert.equal(projectAircraft(91, 0), null);
  assert.equal(projectAircraft(0, -181), null);
  assert.equal(projectAircraft(NaN, 0), null);
});
