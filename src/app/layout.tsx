import type { Metadata } from "next";
import "./globals.css";
import { resolveLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Routy",
  description: "Hundespaziergang-Routenplaner",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const locale = await resolveLocale(user?.locale);
  const theme = user?.theme && user.theme !== "auto" ? user.theme : undefined;

  return (
    <html lang={locale} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
