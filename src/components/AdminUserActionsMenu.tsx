"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";

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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="actions-menu" ref={rootRef}>
      <button
        type="button"
        className="actions-menu-trigger"
        aria-label={labels.menu}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className="actions-menu-panel" role="menu">
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
      )}
    </div>
  );
}
