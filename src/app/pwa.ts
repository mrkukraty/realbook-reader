/// <reference types="vite-plugin-pwa/client" />
import { isTauri } from '../storage/desktop/native';

/**
 * Registers the offline service worker (autoUpdate). No-op inside the Tauri shell (assets are
 * already bundled) and when service workers are unavailable. Call once from main.tsx.
 */
export async function registerPWA(): Promise<void> {
  if (isTauri() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}
