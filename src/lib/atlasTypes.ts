import type { RouteDisplay } from "@/lib/routeDisplay";
import type { NodeRow } from "@/lib/nodes";
import type { SegmentRow } from "@/lib/segments";
import type { AtlasMode, ExploreTool } from "@/lib/mapMode";

export type { AtlasMode, ExploreTool };
/** Sheet-Stufe, §7.3. */
export type AtlasStage =
  | "hidden"
  | "peek"
  | "half"
  | "full"
  | "profile"
  | "stats"
  | "settings"
  | "web"
  | "editMenu"
  | "node"
  | "segment";

export type BackResult =
  | { type: "web-history" }
  | { type: "apply"; stage: AtlasStage; mode?: AtlasMode; clearTool: boolean }
  | { type: "confirm"; confirm: "stop-route" | "stop-roam" }
  | { type: "pass" };

/** Seriellisierbares Bootstrap-Payload für die Atlas-Hülle (kein besser-sqlite3-Import) — §4.1. */
export interface AtlasBootstrap {
  locale: string;
  userId: number;
  role: "admin" | "user";
  displayName: string;
  theme: string;
  homeNodeId: number | null;
  walkSpeedKmh: number;
  mergeRadiusM: number;
  nodes: NodeRow[];
  segments: SegmentRow[];
  canonicalSegmentIds: number[];
  usage: Record<number, number>;
  userNames: Record<number, string>;
  segmentConditions: { id: number; segmentId: number; reason: string; expiresAt: string }[];
  personalAvoidSegmentIds: number[];
  goldenSegmentIds: number[];
  disconnectedSegmentIds: number[];
  deleteError: string | null;
  // Route / Planen
  activeRoute: RouteDisplay | null;
  activeNickname: string | null;
  favorites: { id: number; name: string; shareToken: string | null; display: RouteDisplay }[];
  segmentGeometries: Record<number, [number, number][]>;
  segmentNames: Record<number, string | null>;
  usingNetworkFallback: boolean;
  /** Startmodus aus dem Query (§7.1), null = Standard. */
  requestedMode: AtlasMode | null;
  // Papierkorb (volle Zeilen, wie sie listDeletedNodes/listDeletedSegments liefern)
  deletedNodes: { id: number; name: string | null; lat: number; lng: number; deletedBy: number | null; deletedAt: string | null }[];
  deletedSegments: { id: number; name: string | null; submittedBy: number | null; deletedAt: string | null }[];
}
