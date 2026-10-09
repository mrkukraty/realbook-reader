// Pure page-turn math. All functions are worklet-safe (marked 'worklet') so they can run on the UI thread.
import type { FlipMode } from './spread';

export function clamp(v: number, a: number, b: number): number {
  'worklet';
  return Math.min(b, Math.max(a, v));
}

/** Swipe: progress t (0..1) proportional to horizontal drag distance. */
export function tFromSwipe(dx: number, pw: number, mode: FlipMode): number {
  'worklet';
  return clamp(Math.abs(dx) / (pw * (mode === 'double' ? 1.2 : 0.8)), 0, 1);
}

/**
 * Leaf rotation in degrees (rotateY magnitude, hinge at the spine).
 * single: forward leaf = current page 0 -> 90 (edge-on); backward leaf = previous page 90 -> 0.
 * double: leaf turns 0 -> 180 across the spine.
 */
export function leafAngle(t: number, mode: FlipMode, dir: 1 | -1): number {
  'worklet';
  if (mode === 'double') return t * 180;
  return dir === 1 ? t * 90 : (1 - t) * 90;
}

/** Darkening of the leaf as it turns away from the light (0..maxDark). */
export function leafShade(angleDeg: number, maxDark = 0.45): number {
  'worklet';
  const a = ((angleDeg % 180) + 180) % 180;
  return Math.sin((a * Math.PI) / 180) * maxDark;
}

/** Opacity of the shadow cast onto the page beneath. Peaks mid-turn. */
export function castShadow(t: number, strength = 0.6): number {
  'worklet';
  return Math.sin(clamp(t, 0, 1) * Math.PI) * strength;
}

/** velocity in t-units per second, positive = toward completion. */
export function decideRelease(t: number, velocity: number, threshold = 0.35, flick = 0.9): boolean {
  'worklet';
  if (velocity > flick && t > 0.03) return true;
  if (velocity < -flick) return false;
  return t > threshold;
}

/** Remaining duration (ms) for an animation from t to target, scaled by speed setting. */
export function remainingDuration(t: number, target: 0 | 1, base: number, speed: number): number {
  'worklet';
  const dist = Math.abs(target - t);
  return Math.max(60, (base * dist) / clamp(speed, 0.25, 4));
}

/** Tap zones: left 30% = back, right 30% = forward, middle toggles chrome. */
export function tapZone(x: number, width: number): -1 | 0 | 1 {
  'worklet';
  if (x < width * 0.3) return -1;
  if (x > width * 0.7) return 1;
  return 0;
}
