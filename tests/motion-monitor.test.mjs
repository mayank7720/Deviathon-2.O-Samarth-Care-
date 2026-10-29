import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionMonitor, validateMotionSummary } from '../lib/motion-monitor.mjs';

const feed = (monitor, from, to, vector) => {
  for (let timestamp = from; timestamp < to; timestamp += 50)
    monitor.ingest({ timestamp, ...vector });
};

test('sensor interruption cannot count as sustained quiet after an impact', () => {
  const monitor = createMotionMonitor();
  feed(monitor, 0, 2000, { x: 0, y: 0, z: 9.80665 });
  monitor.ingest({ timestamp: 2000, x: 35, y: 0, z: 10 });
  feed(monitor, 2050, 7000, { x: 9.80665, y: 0, z: 0 });
  feed(monitor, 18000, 24000, { x: 9.80665, y: 0, z: 0 });
  const result = monitor.summary();
  assert.equal(result.possibleFall, false);
  assert.equal(result.observationGaps, 1);
  assert.ok(result.longestQuietSeconds < 10);
});

test('continuous impact, orientation change and stillness retain a human-review candidate', () => {
  const monitor = createMotionMonitor();
  feed(monitor, 0, 2000, { x: 0, y: 0, z: 9.80665 });
  monitor.ingest({ timestamp: 2000, x: 35, y: 0, z: 10 });
  feed(monitor, 2050, 19000, { x: 9.80665, y: 0, z: 0 });
  assert.equal(monitor.summary().possibleFall, true);
  assert.equal(validateMotionSummary(monitor.summary()).fallDetected, true);
  assert.equal(validateMotionSummary(monitor.summary()).confirmation, 'unconfirmed');
});

test('startup impact and out-of-order samples cannot invent a pre-impact orientation', () => {
  const monitor = createMotionMonitor();
  monitor.ingest({ timestamp: 0, x: 35, y: 0, z: 10 });
  feed(monitor, 50, 18000, { x: 9.80665, y: 0, z: 0 });
  assert.equal(monitor.ingest({ timestamp: 100, x: 0, y: 0, z: 9.80665 }), false);
  assert.equal(monitor.summary().possibleFall, false);
});

test('validated summary preserves an evaluated rejection for downstream triage', () => {
  const summary = validateMotionSummary({ durationSeconds: 12, sampleCount: 200,
    peakImpactG: 3.2, maxTiltDegrees: 80, longestQuietSeconds: 1, possibleFall: false });
  assert.equal(summary.fallDetected, false);
  assert.equal(summary.detectionEvaluated, true);
});
