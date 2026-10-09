import type { FlipMode } from './spread';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Turn progress t (0..1) when the leaf's free edge follows the pointer.
 * bx = pointer x relative to the book's left edge, pw = page width.
 * dir 1 = forward (leaf on right half), -1 = backward.
 */
export function tFromEdgePointer(bx: number, pw: number, mode: FlipMode, dir: 1 | -1): number {
  if (mode === 'double') {
    const c = dir === 1 ? (bx - pw) / pw : (pw - bx) / pw;
    return Math.acos(clamp(c, -1, 1)) / Math.PI;
  }
  const phi = Math.acos(clamp(bx / pw, -1, 1)) / (Math.PI / 2); // 0 flat .. 1 edge-on
  const f = Math.min(1, phi);
  return dir === 1 ? f : 1 - f;
}

/** Swipe: t proportional to horizontal distance. */
export function tFromSwipe(dx: number, pw: number, mode: FlipMode): number {
  return clamp(Math.abs(dx) / (pw * (mode === 'double' ? 1.2 : 0.8)), 0, 1);
}

/** Leaf angle in degrees for a turn (rotateY magnitude), see Book. */
export function leafAngle(t: number, mode: FlipMode, dir: 1 | -1): number {
  if (mode === 'double') return t * 180;
  return dir === 1 ? t * 90 : (1 - t) * 90;
}

/** x position (px from book left) of the leaf's free edge and which side the cast shadow falls on. */
export function edgeGeometry(angleDeg: number, pw: number, mode: FlipMode, dir: 1 | -1): { x: number; side: 1 | -1 } {
  const c = Math.cos((angleDeg * Math.PI) / 180);
  if (mode === 'single') return { x: pw * c, side: 1 };
  if (dir === 1) return { x: pw + pw * c, side: c >= 0 ? 1 : -1 };
  return { x: pw - pw * c, side: c >= 0 ? -1 : 1 };
}

/** velocity in t-units per ms, positive = toward completion */
export function decideRelease(t: number, velocity: number, threshold = 0.35, flick = 0.0009): boolean {
  if (velocity > flick && t > 0.03) return true;
  if (velocity < -flick) return false;
  return t > threshold;
}
