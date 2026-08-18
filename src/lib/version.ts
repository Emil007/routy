import pkg from "../../package.json";

/** Versioning convention: 0.<PR number> — this round is PR #10, hence 0.10.
 * package.json keeps a full semver-shaped "0.10.0"; trim the trailing ".0" patch for display. */
export const APP_VERSION = pkg.version;
export const APP_VERSION_DISPLAY = APP_VERSION.replace(/\.0$/, "");
