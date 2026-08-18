import pkg from "../../package.json";

/** package.json keeps a full semver-shaped version (e.g. "0.13.0"); trim the trailing ".0" patch for display. */
export const APP_VERSION = pkg.version;
export const APP_VERSION_DISPLAY = APP_VERSION.replace(/\.0$/, "");
