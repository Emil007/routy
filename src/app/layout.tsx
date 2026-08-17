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

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
