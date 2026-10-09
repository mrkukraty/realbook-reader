import type { PerfMode } from '../../settings/types';

export interface PerfProfile {
  id: PerfMode;
  /** how many spreads around the current one keep rendered pages cached */
  cacheRadius: number;
  /** 'flip' = 3D leaf, 'fade' = flat crossfade */
  transition: 'flip' | 'fade';
  /** curvature/darkening gradients on the leaf */
  curl: boolean;
  /** extra specular strip on the leaf */
  specular: boolean;
  /** cast shadow on the page underneath */
  cast: boolean;
  /** multiplier on shadow opacity */
  shadowScale: number;
  /** show paper grain overlay */
  grain: boolean;
  /** base turn duration in ms at speed 1 */
  duration: number;
}

export const PERF_PROFILES: Record<PerfMode, PerfProfile> = {
  balanced: { id: 'balanced', cacheRadius: 2, transition: 'flip', curl: true, specular: false, cast: true, shadowScale: 0.85, grain: true, duration: 750 },
  lightweight: { id: 'lightweight', cacheRadius: 1, transition: 'fade', curl: false, specular: false, cast: false, shadowScale: 0.4, grain: false, duration: 220 },
  high: { id: 'high', cacheRadius: 4, transition: 'flip', curl: true, specular: true, cast: true, shadowScale: 1.15, grain: true, duration: 900 },
};

export function perfProfile(mode: PerfMode | undefined): PerfProfile {
  return PERF_PROFILES[mode ?? 'balanced'] ?? PERF_PROFILES.balanced;
}
