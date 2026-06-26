/// <reference types="vite/client" />

/** Short commit hash the bundle was built from (injected at build time). */
declare const __BUILD_HASH__: string;
/** Release tag when HEAD is exactly tagged, otherwise "" (build time). */
declare const __BUILD_TAG__: string;
/** GitHub OWNER/REPO slug parsed from the git remote (build time). */
declare const __BUILD_REPO__: string;
/** ISO timestamp of the release tag, or the commit when untagged (build time). */
declare const __BUILD_DATE__: string;

// `postcss-preset-mantine` ships only a bare `declare module "...";` (opaque
// `any`), so the default import resolves to `any` and any call is an unsafe
// call. Declare the real shape here so the vite PostCSS config is type-checked.
declare module "postcss-preset-mantine" {
  import type { Plugin } from "postcss";

  interface PostcssPresetMantineOptions {
    /** Default `data-mantine-color-scheme` emitted by the preset's mixins. */
    colorScheme?: "light" | "dark";
    /** Root font size in px for the rem-to-px converter. */
    rem?: number;
    /** Enable automatic rem conversion on values without a unit. */
    autoRem?: boolean;
  }

  /** The Mantine PostCSS preset: nested, mixins, rem/em, light-dark, color-mix. */
  const postcssPresetMantine: (options?: PostcssPresetMantineOptions) => Plugin;
  export default postcssPresetMantine;
}
