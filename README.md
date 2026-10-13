# histogram-bucket-counter

A small ESM library that maintains a fixed set of boundary-defined histogram
buckets, increments the right bucket for each recorded value, and returns
per-bucket counts on demand.

```js
import { HistogramBucketCounter } from 'histogram-bucket-counter';

const hist = new HistogramBucketCounter([10, 20, 30]);
// Four buckets: (-inf,10], (10,20], (20,30], (30,+inf)
hist.record(5);    // bucket 0
hist.record(15);   // bucket 1
hist.record(25);   // bucket 2
hist.record(35);   // bucket 3
hist.record(10);   // bucket 0 (upper bound is inclusive)

hist.counts();     // [2, 1, 1, 1]
hist.total;        // 5
hist.reset();
hist.counts();     // [0, 0, 0, 0]
```

## Exports

- `HistogramBucketCounter` (class) — the only export.

Constructor: `new HistogramBucketCounter(boundaries)` where `boundaries` is a
non-empty array of finite, strictly-ascending numbers. With `n` boundaries
there are `n + 1` buckets; a value `v` lands in bucket `k`, where `k` is the
count of boundaries strictly less than `v`.

Methods and properties:

- `record(value)` → `number` (bucket index incremented). Throws `TypeError` on
  `NaN` or non-number input. Accepts `±Infinity`.
- `recordMany(values)` → `number` (count recorded). Accepts any iterable.
- `counts()` → `number[]`, a fresh snapshot of per-bucket counts.
- `reset()` → void. Clears counts, keeps boundaries.
- `size` → `number`, bucket count.
- `total` → `number`, values recorded since construction or last reset.

## Why this exists

For services that ingest a stream of measurements (latency, payload size,
queue depth) and only occasionally need a snapshot, a pre-allocated histogram
with fixed cut points is cheaper and simpler than a streaming quantile
estimator. The trade-off: bucket edges are fixed at construction time. If you
need to change edges, build a new counter — there is no rebucketing.

Internally, cut points are stored in a `Float64Array` and located by binary
search, so recording is `O(log n)` and snapshots are `O(n)`. This favours the
write-heavy path, which is the case the brief calls out.

## The awkward edge

Boundary semantics are the one decision to internalise: each bucket's **upper**
bound is **inclusive** and its **lower** bound is **exclusive**. A value
equal to a boundary goes to the bucket on the **lower** side. So with
boundaries `[10, 20, 30]`, the value `20` lands in bucket 1 (`(10, 20]`),
not bucket 2. The first bucket is open at `-Infinity` and the last is open at
`+Infinity`, so `±Infinity` are always accepted and routed to the ends. `NaN`
is rejected, because it belongs to no bucket and silently dropping it would
mask caller bugs.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

