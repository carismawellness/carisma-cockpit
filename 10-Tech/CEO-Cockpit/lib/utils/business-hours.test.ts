/**
 * Unit tests for the business-hours speed-to-lead helper.
 *
 * Run:  node --experimental-strip-types --test lib/utils/business-hours.test.ts
 *
 * Malta DST: CET (UTC+1) winter, CEST (UTC+2) summer. June 2026 = summer (UTC+2),
 * so Malta 09:00 = 07:00Z and 19:00 = 17:00Z. 2026-06-15 is a Monday.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { businessMinutesBetween, stlBucketOf, median, mean } from "./business-hours.ts";

const Z = (iso: string) => new Date(iso);
// allow tiny float noise from ms→min division
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("same day, within hours → 30 min", () => {
  // Mon 09:00 → 09:30 Malta
  assert.ok(close(businessMinutesBetween(Z("2026-06-15T07:00:00Z"), Z("2026-06-15T07:30:00Z")), 30));
});

test("created before open → clock starts at 09:00", () => {
  // Mon 07:30 (before open) → 09:15 Malta = 15 business minutes
  assert.ok(close(businessMinutesBetween(Z("2026-06-15T05:30:00Z"), Z("2026-06-15T07:15:00Z")), 15));
});

test("after close spills to next morning (overnight skipped)", () => {
  // Mon 18:55 → Tue 09:05 Malta = 5 + 5 = 10
  assert.ok(close(businessMinutesBetween(Z("2026-06-15T16:55:00Z"), Z("2026-06-16T07:05:00Z")), 10));
});

test("weekend skip: Sat 18:55 → Mon 09:05 = 10 (Sunday closed)", () => {
  // Sat 2026-06-20 18:55 → Mon 2026-06-22 09:05 Malta
  assert.ok(close(businessMinutesBetween(Z("2026-06-20T16:55:00Z"), Z("2026-06-22T07:05:00Z")), 10));
});

test("Sunday arrival starts Monday open", () => {
  // Sun 2026-06-21 12:00 → Mon 09:10 Malta = 10
  assert.ok(close(businessMinutesBetween(Z("2026-06-21T10:00:00Z"), Z("2026-06-22T07:10:00Z")), 10));
});

test("multi-day: Mon 09:00 → Wed 09:00 = two full 10h days = 1200 min", () => {
  assert.ok(close(businessMinutesBetween(Z("2026-06-15T07:00:00Z"), Z("2026-06-17T07:00:00Z")), 1200));
});

test("response before creation → 0", () => {
  assert.equal(businessMinutesBetween(Z("2026-06-15T08:00:00Z"), Z("2026-06-15T07:00:00Z")), 0);
});

test("sub-minute response → 0.5 min", () => {
  assert.ok(close(businessMinutesBetween(Z("2026-06-15T07:00:00Z"), Z("2026-06-15T07:00:30Z")), 0.5));
});

test("entirely on Sunday → 0", () => {
  // Sun 10:00 → 14:00 Malta
  assert.equal(businessMinutesBetween(Z("2026-06-21T08:00:00Z"), Z("2026-06-21T12:00:00Z")), 0);
});

test("DST spring-forward weekend handled (Sat CET → Mon CEST) = 120 min", () => {
  // Sat 2026-03-28 18:00 CET (UTC+1) = 17:00Z → window 18:00-19:00 = 60 min
  // Sun 2026-03-29 closed; clocks spring forward.
  // Mon 2026-03-30 09:00 CEST (UTC+2) = 07:00Z → 10:00 CEST = 08:00Z → 60 min
  assert.ok(close(businessMinutesBetween(Z("2026-03-28T17:00:00Z"), Z("2026-03-30T08:00:00Z")), 120));
});

test("stlBucketOf classification + SLA boundaries", () => {
  assert.equal(stlBucketOf(null, false), "pending");
  assert.equal(stlBucketOf(0, true), "<5");
  assert.equal(stlBucketOf(4.99, true), "<5");
  assert.equal(stlBucketOf(5, true), "5-30");
  assert.equal(stlBucketOf(29.9, true), "5-30");
  assert.equal(stlBucketOf(30, true), "30-60");
  assert.equal(stlBucketOf(59.9, true), "30-60");
  assert.equal(stlBucketOf(60, true), "60-240");
  assert.equal(stlBucketOf(239, true), "60-240");
  assert.equal(stlBucketOf(240, true), ">240");
  assert.equal(stlBucketOf(9999, true), ">240");
});

test("median + mean", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), 0);
});
