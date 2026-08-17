"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { deleteWalkLogEntry } from "@/lib/segments";

export async function deleteWalkAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("walkId"));
  if (!id) return;
  deleteWalkLogEntry(id, user.id);
  revalidatePath("/stats");
}
