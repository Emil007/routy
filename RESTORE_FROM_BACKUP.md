# Restore Routy from a backup

This runbook describes how to restore the SQLite database from a local backup file. Test this on a non-production copy before relying on it in an emergency.

## Prerequisites

- Docker Compose stack stopped or ready for a brief outage
- A backup file from `./data/backups/routy-YYYY-MM-DD.db` or a manual admin download

## Steps

1. **Stop the container**

   ```bash
   docker compose stop routy
   ```

2. **Back up the current (possibly corrupted) database**

   ```bash
   cp data/routy.db "data/routy.db.before-restore-$(date +%F-%H%M)"
   ```

3. **Copy the chosen backup into place**

   ```bash
   cp data/backups/routy-2026-08-19.db data/routy.db
   ```

   Replace the filename with your actual backup.

4. **Start the container and verify**

   ```bash
   docker compose start routy
   docker compose logs -f routy
   ```

   Confirm startup logs show no `PRAGMA quick_check` errors and that `/api/health` returns `"status": "ok"`.

5. **Smoke test in the UI**

   - Sign in
   - Open the map and confirm nodes/segments load
   - Confirm an active route or recent walk history looks correct

## Notes

- Backups are full SQLite snapshots; restoring replaces the entire database.
- Sessions and in-memory route suggestion tokens from before the backup are lost after restore — users may need to sign in again or re-suggest a route.
- Automatic backups are written daily to `./data/backups/` and rotated after 14 days.
