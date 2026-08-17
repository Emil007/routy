"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { renameNode, setHomeNode, deleteNode } from "@/lib/nodes";
import { deleteSegment, getSegment } from "@/lib/segments";
import { nodeUsedByActiveRoute, segmentUsedByActiveRoute } from "@/lib/activeRoute";

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
  const segment = getSegment(id);
  const relatedIds = segment ? [segment.id, ...(segment.reverseOf !== null ? [segment.reverseOf] : [])] : [id];
  if (segmentUsedByActiveRoute(relatedIds)) {
    redirect("/map?deleteError=segment_active");
  }
  deleteSegment(id);
  revalidatePath("/map");
}

export async function deleteNodeAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  if (nodeUsedByActiveRoute(id)) {
    redirect("/map?deleteError=node_active");
  }
  deleteNode(id);
  revalidatePath("/map");
}
