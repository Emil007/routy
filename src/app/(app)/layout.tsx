import { requireUser, isImpersonating } from "@/lib/session";
import { resolveLocale } from "@/lib/locale";
import { AppChrome } from "@/components/map-shell/AppChrome";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await resolveLocale(user.locale);
  const impersonating = await isImpersonating();
  const embedded = user.client === "app";

  return (
    <div className="app-frame">
      <AppChrome
        locale={locale}
        embedded={embedded}
        displayName={user.displayName}
        isAdmin={user.role === "admin"}
        impersonating={impersonating}
      >
        {children}
      </AppChrome>
    </div>
  );
}
