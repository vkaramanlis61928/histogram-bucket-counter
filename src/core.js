/**
 * HistogramBucketCounter
 *
 * Maintains a fixed set of boundary-defined buckets and increments the
 * appropriate bucket for each recorded value. Counts per bucket are returned
 * on demand.
 *
 * Boundary model (single, clearly-stated interpretation):
 *   - A bucket is defined by an exclusive lower bound (lo) and inclusive upper
 *     bound (hi): a value v is assigned to bucket i if lo[i] < v <= hi[i].
 *   - The first bucket has lo = -Infinity (so any value <= its hi lands there).
 *   - The last bucket has hi = +Infinity (so any value > its lo lands there).
 *   - Internal boundaries are the lower bounds of buckets 1..n-1. Between two
 *     adjacent buckets i and i+1, boundary[i] is the dividing line: values
 *     <= boundary[i] go to bucket i, values > boundary[i] go to bucket i+1.
 *
 * We store the internal boundaries as a sorted Float64Array and binary-search
 * them. This is O(log n) per record and O(n) per snapshot, which is the right
 * trade-off for a high-write, occasional-snapshot workload. If the caller
 * needed frequent snapshots with rare writes, an array of plain numbers and a
 * linear scan would be simpler and equally fast for small n — but the brief
 * emphasises recording values, so we optimise that path.
 */

export class HistogramBucketCounter {
  /**
   * @param {number[]} boundaries Internal cut points between buckets.
   *        Must contain at least one element. They must be strictly ascending
   *        and finite. A value v is placed as follows: find the last index i
   *        such that boundaries[i] < v; if no such i exists, v goes to bucket 0;
   *        if i === boundaries.length - 1, v goes to bucket boundaries.length
   *        (the final, open-ended bucket); otherwise v goes to bucket i + 1.
   *        Equivalently, with n boundaries there are n + 1 buckets and the rule
   *        is `bucket = count of boundaries strictly less than v`.
   * @throws {TypeError} If boundaries is not an array of finite numbers or is empty.
   * @throws {RangeError} If boundaries are not strictly ascending.
   */
  constructor(boundaries) {
    if (!Array.isArray(boundaries) || boundaries.length === 0) {
      throw new TypeError('boundaries must be a non-empty array of finite numbers');
    }
    for (const b of boundaries) {
      if (typeof b !== 'number' || !Number.isFinite(b)) {
        throw new TypeError('every boundary must be a finite number');
      }
    }
    for (let i = 1; i < boundaries.length; i++) {
      if (!(boundaries[i - 1] < boundaries[i])) {
        throw new RangeError('boundaries must be strictly ascending');
      }
    }

    // Float64Array for cache-friendly, typed storage of the cut points.
    this._boundaries = new Float64Array(boundaries);
    // Int32 counts: histogram counts are non-negative integers; this is enough
    // for any realistic workload and avoids float rounding surprises.
    this._counts = new Int32Array(boundaries.length + 1);
    this._total = 0;
  }

  /**
   * Number of buckets (always boundaries.length + 1).
   * @returns {number}
   */
  get size() {
    return this._counts.length;
  }

  /**
   * Total number of values recorded so far.
   * @returns {number}
   */
  get total() {
    return this._total;
  }

  /**
   * Record a single value into the appropriate bucket.
   *
   * NaN is rejected: a NaN value does not belong in any bucket and silently
   * dropping it would hide a caller bug. ±Infinity is accepted and routed to
   * the first or last bucket respectively — the boundary model already defines
   * those as -Infinity / +Infinity open ends.
   *
   * @param {number} value
   * @returns {number} The index of the bucket that was incremented, so callers
   *                   can react to placement without a second lookup.
   * @throws {TypeError} If value is NaN.
   */
  record(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new TypeError('value must be a number (NaN is not allowed)');
    }

    // Binary search for the number of boundaries strictly less than value.
    // This equals the target bucket index.
    let lo = 0;
    let hi = this._boundaries.length; // exclusive upper bound for the count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._boundaries[mid] < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const bucket = lo;
    this._counts[bucket]++;
    this._total++;
    return bucket;
  }

  /**
   * Record many values at once. Equivalent to calling record() for each.
   *
   * @param {Iterable<number>} values
   * @returns {number} The number of values recorded.
   */
  recordMany(values) {
    let n = 0;
    for (const v of values) {
      this.record(v);
      n++;
    }
    return n;
  }

  /**
   * Return a snapshot of the bucket counts as a plain array of numbers.
   *
   * We return a fresh array each call so the caller cannot mutate internal
   * state. Returns number[] (not Int32Array) to match the idiomatic JS
   * expectation for count snapshots and to avoid surprising type checks.
   *
   * @returns {number[]}
   */
  counts() {
    return Array.from(this._counts);
  }

  /**
   * Reset all counts to zero. Boundaries are unchanged.
   */
  reset() {
    this._counts.fill(0);
    this._total = 0;
  }
}
