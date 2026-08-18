"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { renameNode, setHomeNode, deleteNode, getNode } from "@/lib/nodes";
import { deleteSegment, getSegment } from "@/lib/segments";
import { nodeUsedByActiveRoute, segmentUsedByActiveRoute } from "@/lib/activeRoute";
import { canEdit } from "@/lib/ownership";

export async function renameNodeAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("nodeId"));
  const name = String(formData.get("name") || "").trim();
  if (!id || !name) return;
  const node = getNode(id);
  if (!node || !canEdit(user, node.createdBy)) {
    redirect("/map?deleteError=not_owner");
  }
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
  const user = await requireUser();
  const id = Number(formData.get("segmentId"));
  if (!id) return;
  const segment = getSegment(id);
  if (!segment || !canEdit(user, segment.submittedBy)) {
    redirect("/map?deleteError=not_owner");
  }
  const relatedIds = segment ? [segment.id, ...(segment.reverseOf !== null ? [segment.reverseOf] : [])] : [id];
  if (segmentUsedByActiveRoute(relatedIds)) {
    redirect("/map?deleteError=segment_active");
  }
  deleteSegment(id);
  revalidatePath("/map");
}

export async function deleteNodeAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  const node = getNode(id);
  if (!node || !canEdit(user, node.createdBy)) {
    redirect("/map?deleteError=not_owner");
  }
  if (nodeUsedByActiveRoute(id)) {
    redirect("/map?deleteError=node_active");
  }
  deleteNode(id);
  revalidatePath("/map");
}
