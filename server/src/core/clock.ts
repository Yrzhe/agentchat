/**
 * Minimal swappable clock for the core layer.
 *
 * `core/*` previously called `Date.now()` directly, defeating the platform's
 * `now()` abstraction and making deterministic tests harder. Going through
 * this module lets tests pin time without threading a `Clock` parameter
 * through every function. (Codex review MED #11)
 *
 * Usage:
 *
 *     import { now } from "../clock";
 *     const ts = now();              // production: Date.now()
 *
 *     // in tests:
 *     setClock(() => 1_700_000_000_000);
 *     // ... assertions ...
 *     resetClock();
 */

type Tick = () => number;

let _now: Tick = () => Date.now();

export function now(): number {
  return _now();
}

export function setClock(tick: Tick): void {
  _now = tick;
}

export function resetClock(): void {
  _now = () => Date.now();
}
