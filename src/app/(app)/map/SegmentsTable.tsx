"use client";

import { useMemo, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { NodeRow } from "@/lib/nodes";
import type { SegmentRow } from "@/lib/segments";
import { canEdit } from "@/lib/ownership";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { deleteSegmentAction } from "./actions";

type SortKey = "start" | "end" | "length" | "duration" | "usage" | "creator";

export function SegmentsTable({
  locale,
  segments,
  nodes,
  usage,
  userNames,
  currentUser,
}: {
  locale: Locale;
  segments: SegmentRow[];
  nodes: NodeRow[];
  usage: Record<number, number>;
  userNames: Record<number, string>;
  currentUser: { id: number; role: "admin" | "user" };
}) {
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  function nodeName(id: number): string {
    return nodesById.get(id)?.name || `#${id}`;
  }
  function creatorName(id: number | null): string {
    return id !== null ? (userNames[id] ?? `#${id}`) : "–";
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const withKeys = segments.map((s) => ({
      segment: s,
      start: nodeName(s.startNodeId),
      end: nodeName(s.endNodeId),
      length: s.lengthM,
      duration: s.durationMin,
      usage: usage[s.id] ?? 0,
      creator: creatorName(s.submittedBy),
    }));
    withKeys.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), locale);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return withKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, sortKey, sortDir, nodesById, usage, userNames, locale]);

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function renderTh(sortKeyValue: SortKey, label: string) {
    return (
      <th key={sortKeyValue} style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort(sortKeyValue)}>
        {label}
        {sortIndicator(sortKeyValue)}
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {renderTh("start", t(locale, "route.start"))}
            {renderTh("end", t(locale, "route.destination"))}
            {renderTh("length", t(locale, "import.length"))}
            {renderTh("duration", t(locale, "import.duration"))}
            {renderTh("usage", t(locale, "map.usageHeading"))}
            {renderTh("creator", t(locale, "map.createdBy"))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ segment: s, start, end, creator }) => (
            <tr key={s.id}>
              <td>{start}</td>
              <td>{end}</td>
              <td>
                {(s.lengthM / 1000).toFixed(2)} {t(locale, "common.km")}
              </td>
              <td>
                {s.durationMin} {t(locale, "common.min")}
              </td>
              <td>{t(locale, "map.usageCount", { count: usage[s.id] ?? 0 })}</td>
              <td>{creator}</td>
              <td>
                {canEdit(currentUser, s.submittedBy) && (
                  <div className="btn-row">
                    <ConfirmSubmitForm
                      action={deleteSegmentAction}
                      confirmMessage={t(locale, "map.deleteConfirm")}
                      hiddenName="segmentId"
                      hiddenValue={s.id}
                      buttonLabel={t(locale, "map.delete")}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
