/**
 * Runs once when the server process starts (Next.js instrumentation hook).
 * If no account exists yet, prints the one-time setup token to the console —
 * `docker compose logs -f` is how you read it back — so a stranger who
 * reaches the site before you finish setup can't claim the admin account.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { userCount } = await import("./lib/session");
  const { getOrCreateSetupToken } = await import("./lib/setupToken");

  if (userCount() > 0) return;

  const token = getOrCreateSetupToken();
  console.log(`
================================================================
 Routy - first-time setup

 No account exists yet. Enter this setup token on the setup
 screen to create the first (admin) account:

   ${token}

 Run "docker compose logs -f" any time to see this again.
================================================================
`);
}
