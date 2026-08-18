/** Admins can edit anything; everyone else only what they created. A missing owner (shouldn't happen after the admin-backfill migration) is admin-only. */
export function canEdit(currentUser: { id: number; role: "admin" | "user" }, ownerId: number | null): boolean {
  return currentUser.role === "admin" || ownerId === currentUser.id;
}
