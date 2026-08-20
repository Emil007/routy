"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRef, useState, useEffect, useLayoutEffect } from "react";

type Props = {
  userId: number;
  isSelf: boolean;
  isActive: boolean;
  labels: {
    edit: string;
    lock: string;
    unlock: string;
    impersonate: string;
    delete: string;
    deleteConfirm: string;
    menu: string;
  };
  toggleActiveAction: (formData: FormData) => void | Promise<void>;
  impersonateAction: (formData: FormData) => void | Promise<void>;
  deleteUserAction: (formData: FormData) => void | Promise<void>;
};

export function AdminUserActionsMenu({
  userId,
  isSelf,
  isActive,
  labels,
  toggleActiveAction,
  impersonateAction,
  deleteUserAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function updateCoords() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onReposition() {
      updateCoords();
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const panel =
    open && coords ? (
      <div
        ref={panelRef}
        className="actions-menu-panel actions-menu-panel-fixed"
        role="menu"
        style={{ top: coords.top, right: coords.right }}
      >
        <Link href={`/admin/${userId}`} className="actions-menu-item" role="menuitem" onClick={() => setOpen(false)}>
          {labels.edit}
        </Link>
        {!isSelf && (
          <>
            <form action={toggleActiveAction}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="active" value={isActive ? "0" : "1"} />
              <button type="submit" className="actions-menu-item" role="menuitem">
                {isActive ? labels.lock : labels.unlock}
              </button>
            </form>
            <form action={impersonateAction}>
              <input type="hidden" name="userId" value={userId} />
              <button type="submit" className="actions-menu-item" role="menuitem">
                {labels.impersonate}
              </button>
            </form>
            <form
              action={deleteUserAction}
              onSubmit={(e) => {
                if (!window.confirm(labels.deleteConfirm)) e.preventDefault();
                else setOpen(false);
              }}
            >
              <input type="hidden" name="userId" value={userId} />
              <button type="submit" className="actions-menu-item actions-menu-item-danger" role="menuitem">
                {labels.delete}
              </button>
            </form>
          </>
        )}
      </div>
    ) : null;

  return (
    <div className="actions-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="actions-menu-trigger"
        aria-label={labels.menu}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
