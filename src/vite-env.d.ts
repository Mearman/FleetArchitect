/// <reference types="vite/client" />

/** Short commit hash the bundle was built from (injected at build time). */
declare const __BUILD_HASH__: string;
/** Release tag when HEAD is exactly tagged, otherwise "" (build time). */
declare const __BUILD_TAG__: string;
/** GitHub OWNER/REPO slug parsed from the git remote (build time). */
declare const __BUILD_REPO__: string;
