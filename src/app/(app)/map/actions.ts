"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { renameNode, setHomeNode, deleteNode } from "@/lib/nodes";
import { deleteSegment } from "@/lib/segments";

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

export async function deleteSegmentAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("segmentId"));
  if (!id) return;
  deleteSegment(id);
  revalidatePath("/map");
}

export async function deleteNodeAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  deleteNode(id);
  revalidatePath("/map");
}
