import { redirect } from "next/navigation";

export default async function RoutePage() {
  // Lesezeichen bleiben; /route ist ab J2 nur noch ein Alias auf die Atlas-Karte im Planen-Modus.
  redirect("/map?mode=plan");
}
