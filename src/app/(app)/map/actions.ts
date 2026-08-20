"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setUserHomeNode, deleteNode, getNode, restoreNode, purgeNode } from "@/lib/nodes";
import { deleteSegment, getSegment, restoreSegment, purgeSegment } from "@/lib/segments";
import { nodeUsedByActiveRoute, segmentUsedByActiveRoute } from "@/lib/activeRoute";
import { canEdit } from "@/lib/ownership";
import { logActivity } from "@/lib/activityLog";

export async function setHomeNodeAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  const node = getNode(id);
  if (!node || node.deletedAt) return;
  setUserHomeNode(user.id, id);
  logActivity(user.id, "set_home", "node", id, { name: node.name });
  revalidatePath("/map");
  revalidatePath("/route");
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
  logActivity(user.id, "delete", "segment", id, { name: segment.name });
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
  logActivity(user.id, "delete", "node", id, { name: node.name });
  revalidatePath("/map");
}

export async function restoreNodeAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  const node = getNode(id);
  if (!node || !canEdit(user, node.createdBy)) return;
  restoreNode(id);
  logActivity(user.id, "restore", "node", id, { name: node.name });
  revalidatePath("/map");
}

export async function purgeNodeAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("nodeId"));
  if (!id) return;
  const node = getNode(id);
  if (!node || !canEdit(user, node.createdBy)) return;
  purgeNode(id);
  logActivity(user.id, "purge", "node", id, { name: node.name });
  revalidatePath("/map");
}

export async function restoreSegmentAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("segmentId"));
  if (!id) return;
  const segment = getSegment(id);
  if (!segment || !canEdit(user, segment.submittedBy)) return;
  restoreSegment(id);
  logActivity(user.id, "restore", "segment", id, { name: segment.name });
  revalidatePath("/map");
}

export async function purgeSegmentAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("segmentId"));
  if (!id) return;
  const segment = getSegment(id);
  if (!segment || !canEdit(user, segment.submittedBy)) return;
  purgeSegment(id);
  logActivity(user.id, "purge", "segment", id, { name: segment.name });
  revalidatePath("/map");
}
