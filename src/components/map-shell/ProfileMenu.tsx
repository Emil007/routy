"use client";

import { t, type Locale } from "@/lib/i18n";
import { useMapShell } from "./MapShellContext";
import { logoutAction } from "@/app/actions";

/**
 * Profil-Menü (runder Knopf oben rechts, kein 5. Dock-Chip). Bis J5 sind die Ziele
 * die alten Seiten mit NavBar; Javascript-Verlinkung über window.location hält den
 * Server-Render-Ausweg offen. Logout bleibt im Profil (Browser).
 */
export function ProfileMenu({
  locale,
  displayName,
  isAdmin,
  embedded,
}: {
  locale: Locale;
  displayName: string;
  isAdmin: boolean;
  embedded: boolean;
}) {
  const { profileOpen, setProfileOpen, setStage, mode } = useMapShell();

  function nav(path: string) {
    setProfileOpen(false);
    window.location.href = path;
  }

  return (
    <>
      <button
        type="button"
        className="map-fab map-profile-fab"
        aria-label={t(locale, "shell.profile")}
        aria-expanded={profileOpen}
        onClick={() => {
          if (embedded) return;
          setProfileOpen(!profileOpen);
          if (profileOpen) setStage("peek");
        }}
      >
        <span>{displayName.charAt(0).toUpperCase()}</span>
      </button>

      {profileOpen && (
        <div className="map-dialog profile-menu">
          <button type="button" className="menu-item" onClick={() => nav("/stats")}>
            {t(locale, "nav.stats")}
          </button>
          <button type="button" className="menu-item" onClick={() => nav("/settings")}>
            {t(locale, "nav.settings")}
          </button>
          {isAdmin && (
            <button type="button" className="menu-item" onClick={() => nav("/admin")}>
              {t(locale, "nav.admin")}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="menu-item" onClick={() => nav("/admin/track-geometry")}>
              {t(locale, "admin.trackGeometryHeading")}
            </button>
          )}
          <div className="profile-menu-row">
            <span className="chip">{displayName}</span>
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary btn-compact">
                {t(locale, "nav.logout")}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
