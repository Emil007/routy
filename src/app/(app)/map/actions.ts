"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { renameNode, setHomeNode } from "@/lib/nodes";

export async function renameNodeAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("nodeId"));
  const name = String(formData.get("name") || "").trim();
  if (!id || !name) return;
  renameNode(id, name);
  revalidatePath("/map");
}

export async function setHomeNodeAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  setHomeNode(id);
  revalidatePath("/map");
}
