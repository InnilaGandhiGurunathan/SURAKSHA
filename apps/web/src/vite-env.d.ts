/// <reference types="vite/client" />

/**
 * Build-time constants injected by `vite.config.ts` (`define`).
 *
 * They are declared here so the code that reads them stays type-safe, and so a
 * build without the define still fails loudly instead of silently printing
 * "undefined" as the app version.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
