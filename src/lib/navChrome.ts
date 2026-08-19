/** Nav chrome visibility for browser vs Android admin WebView (`client=app`). */
export function navChromeVisibility(embedded: boolean): {
  showHeaderChrome: boolean;
  showUserbar: boolean;
} {
  if (embedded) {
    return { showHeaderChrome: false, showUserbar: false };
  }
  return { showHeaderChrome: true, showUserbar: true };
}
