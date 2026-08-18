import type { Metadata, Viewport } from "next";
import "./globals.css";
import { resolveLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/session";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Routy",
  description: "Hundespaziergang-Routenplaner",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2e6b49",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const locale = await resolveLocale(user?.locale);
  const theme = user?.theme && user.theme !== "auto" ? user.theme : undefined;

  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
