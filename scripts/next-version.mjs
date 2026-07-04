/**
 * Print the git tag semantic-release WILL cut for the current commit, without
 * releasing. The CI build job runs this in dry-run and feeds the result to Vite
 * as `NEXT_RELEASE_TAG`, so the deployed top-bar shows the upcoming version
 * (e.g. `v1.41.0`) instead of the un-tagged commit hash — the build runs on the
 * feat commit in parallel with the real release, and both analyse the same
 * commits, so the version matches.
 *
 * Dry-run skips `prepare`/`publish`/`success`/`fail`, so the changelog + git
 * plugins never run: nothing is committed, no tag is created, no write perms are
 * needed. Prints an empty string when no release is due (a `test:`/`chore:`
 * commit) or on any error — the header then falls back to the commit hash.
 */
import semanticRelease from "semantic-release";

try {
  const results = await semanticRelease({ dryRun: true });
  const next = Array.isArray(results)
    ? results.find((r) => r && r.nextRelease)
    : undefined;
  process.stdout.write(next?.nextRelease?.gitTag ?? "");
} catch {
  process.stdout.write("");
}
