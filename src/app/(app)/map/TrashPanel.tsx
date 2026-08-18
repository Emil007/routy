import { t, type Locale } from "@/lib/i18n";
import type { NodeRow } from "@/lib/nodes";
import type { SegmentRow } from "@/lib/segments";
import { ConfirmSubmitForm } from "@/components/ConfirmSubmitForm";
import { restoreNodeAction, purgeNodeAction, restoreSegmentAction, purgeSegmentAction } from "./actions";

export function TrashPanel({
  locale,
  deletedNodes,
  deletedSegments,
}: {
  locale: Locale;
  deletedNodes: NodeRow[];
  deletedSegments: SegmentRow[];
}) {
  const isEmpty = deletedNodes.length === 0 && deletedSegments.length === 0;

  return (
    <details className="card">
      <summary style={{ fontSize: "1.1rem", fontWeight: 600, cursor: "pointer" }}>{t(locale, "map.trashHeading")}</summary>
      <p style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{t(locale, "map.autoPurgeNotice")}</p>

      {isEmpty ? (
        <p>{t(locale, "map.trashEmpty")}</p>
      ) : (
        <>
          {deletedNodes.length > 0 && (
            <>
              <h3 style={{ fontSize: "1rem", margin: "0.8rem 0 0.4rem" }}>{t(locale, "map.trashNodesHeading")}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t(locale, "map.nameHeading")}</th>
                      <th>{t(locale, "map.deletedAt")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedNodes.map((n) => (
                      <tr key={n.id}>
                        <td>{n.name || t(locale, "map.unnamedNode")}</td>
                        <td>{n.deletedAt}</td>
                        <td>
                          <div className="btn-row">
                            <form action={restoreNodeAction}>
                              <input type="hidden" name="nodeId" value={n.id} />
                              <button type="submit" className="btn-secondary">
                                {t(locale, "map.restore")}
                              </button>
                            </form>
                            <ConfirmSubmitForm
                              action={purgeNodeAction}
                              confirmMessage={t(locale, "map.purgeConfirm")}
                              hiddenName="nodeId"
                              hiddenValue={n.id}
                              buttonLabel={t(locale, "map.purge")}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {deletedSegments.length > 0 && (
            <>
              <h3 style={{ fontSize: "1rem", margin: "0.8rem 0 0.4rem" }}>{t(locale, "map.trashSegmentsHeading")}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t(locale, "map.nameHeading")}</th>
                      <th>{t(locale, "map.deletedAt")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedSegments.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name || `#${s.id}`}</td>
                        <td>{s.deletedAt}</td>
                        <td>
                          <div className="btn-row">
                            <form action={restoreSegmentAction}>
                              <input type="hidden" name="segmentId" value={s.id} />
                              <button type="submit" className="btn-secondary">
                                {t(locale, "map.restore")}
                              </button>
                            </form>
                            <ConfirmSubmitForm
                              action={purgeSegmentAction}
                              confirmMessage={t(locale, "map.purgeConfirm")}
                              hiddenName="segmentId"
                              hiddenValue={s.id}
                              buttonLabel={t(locale, "map.purge")}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
