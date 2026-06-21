// Self-hosted web fonts via @fontsource. Vite bundles the woff2 files into
// dist/assets/ — no CDN, works on GitHub Pages. Import before Mantine styles.
// IBM Plex Mono has no variable build on @fontsource, so the static family is
// imported here (all weights via the package root stylesheet).
import "@fontsource-variable/inter/index.css";
import "@fontsource/ibm-plex-mono/index.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
