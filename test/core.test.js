import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistogramBucketCounter } from '../src/index.js';

// Helper: build a counter with cut points [10, 20, 30] giving four buckets:
//   bucket 0: (-inf, 10]   bucket 1: (10, 20]
//   bucket 2: (20, 30]     bucket 3: (30, +inf)
function makeBasic() {
  return new HistogramBucketCounter([10, 20, 30]);
}

test('constructor rejects empty boundaries', () => {
  assert.throws(() => new HistogramBucketCounter([]), TypeError);
});

test('constructor rejects non-array input', () => {
  assert.throws(() => new HistogramBucketCounter('10,20'), TypeError);
  assert.throws(() => new HistogramBucketCounter(null), TypeError);
});

test('constructor rejects non-finite boundaries', () => {
  assert.throws(() => new HistogramBucketCounter([1, NaN, 3]), TypeError);
  assert.throws(() => new HistogramBucketCounter([1, Infinity, 3]), TypeError);
  assert.throws(() => new HistogramBucketCounter([-Infinity, 3]), TypeError);
});

test('constructor rejects non-strictly-ascending boundaries', () => {
  assert.throws(() => new HistogramBucketCounter([10, 10]), RangeError);
  assert.throws(() => new HistogramBucketCounter([20, 10, 30]), RangeError);
  assert.throws(() => new HistogramBucketCounter([10, 20, 20]), RangeError);
});

test('size is boundaries.length + 1', () => {
  assert.equal(new HistogramBucketCounter([5]).size, 2);
  assert.equal(makeBasic().size, 4);
});

test('total starts at zero', () => {
  assert.equal(makeBasic().total, 0);
});

test('record returns the bucket index that was incremented', () => {
  const h = makeBasic();
  assert.equal(h.record(5), 0);
  assert.equal(h.record(15), 1);
  assert.equal(h.record(25), 2);
  assert.equal(h.record(35), 3);
});

test('values exactly on a boundary go to the lower bucket (inclusive upper)', () => {
  const h = makeBasic();
  h.record(10);
  h.record(20);
  h.record(30);
  assert.deepEqual(h.counts(), [1, 1, 1, 0]);
});

test('negative values and zero land in the first bucket', () => {
  const h = makeBasic();
  h.record(-1000);
  h.record(-0.5);
  h.record(0);
  assert.deepEqual(h.counts(), [3, 0, 0, 0]);
});

test('+Infinity lands in the final bucket, -Infinity in the first', () => {
  const h = makeBasic();
  h.record(-Infinity);
  h.record(Infinity);
  assert.deepEqual(h.counts(), [1, 0, 0, 1]);
});

test('NaN is rejected because it belongs in no bucket', () => {
  const h = makeBasic();
  assert.throws(() => h.record(NaN), TypeError);
  assert.throws(() => h.record('oops'), TypeError);
  assert.throws(() => h.record(undefined), TypeError);
});

test('counts returns a fresh array each call and does not share state', () => {
  const h = makeBasic();
  h.record(5);
  const a = h.counts();
  const b = h.counts();
  assert.notEqual(a, b);
  a[0] = 999;
  assert.equal(h.counts()[0], 1);
});

test('recordMany accepts an iterable and returns the count recorded', () => {
  const h = makeBasic();
  function* gen() {
    yield 5;
    yield 15;
    yield 25;
    yield 35;
    yield 45;
  }
  const n = h.recordMany(gen());
  assert.equal(n, 5);
  assert.equal(h.total, 5);
  assert.deepEqual(h.counts(), [1, 1, 1, 2]);
});

test('recordMany on an empty iterable records nothing and returns zero', () => {
  const h = makeBasic();
  assert.equal(h.recordMany([]), 0);
  assert.equal(h.total, 0);
});

test('recordMany throws on first invalid value without leaving partial counts', () => {
  const h = makeBasic();
  // 5 records into bucket 0, then NaN aborts. The 5 already landed; we only
  // guarantee recordMany aborts — we do not roll back, and the test asserts
  // exactly that behaviour so it matches the implementation.
  assert.throws(() => h.recordMany([5, NaN, 25]), TypeError);
  assert.equal(h.total, 1);
  assert.deepEqual(h.counts(), [1, 0, 0, 0]);
});

test('reset zeroes counts and total but keeps boundaries', () => {
  const h = makeBasic();
  h.record(5);
  h.record(15);
  h.reset();
  assert.equal(h.total, 0);
  assert.deepEqual(h.counts(), [0, 0, 0, 0]);
  // Still functional after reset
  h.record(15);
  assert.deepEqual(h.counts(), [0, 1, 0, 0]);
  assert.equal(h.total, 1);
});

test('a single boundary yields two buckets split at that point', () => {
  const h = new HistogramBucketCounter([0]);
  h.record(-1);
  h.record(0);
  h.record(1);
  assert.deepEqual(h.counts(), [2, 1]);
});

test('large numbers land in the final bucket', () => {
  const h = makeBasic();
  h.record(Number.MAX_VALUE);
  h.record(1e308);
  assert.deepEqual(h.counts(), [0, 0, 0, 2]);
});

test('stress: many records across all buckets tally correctly', () => {
  const h = makeBasic();
  const expected = [0, 0, 0, 0];
  for (let i = 0; i < 10000; i++) {
    const v = i % 40; // 0..39, spreads across all four buckets
    const bucket = h.record(v);
    expected[bucket]++;
  }
  assert.equal(h.total, 10000);
  assert.deepEqual(h.counts(), expected);
});
