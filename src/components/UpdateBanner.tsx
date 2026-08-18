"use client";

import { useSyncExternalStore } from "react";

const DISMISS_KEY = "routy-update-dismissed";
const DISMISS_EVENT = "routy-update-dismiss-changed";

function subscribe(callback: () => void) {
  window.addEventListener(DISMISS_EVENT, callback);
  return () => window.removeEventListener(DISMISS_EVENT, callback);
}

function getSnapshot() {
  return localStorage.getItem(DISMISS_KEY);
}

function getServerSnapshot() {
  return null;
}

export function UpdateBanner({
  latestVersion,
  url,
  message,
  dismissLabel,
}: {
  latestVersion: string;
  url: string;
  message: string;
  dismissLabel: string;
}) {
  const dismissedVersion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (dismissedVersion === latestVersion) return null;

  return (
    <div className="alert alert-success" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.8rem" }}>
      <span>
        {message}{" "}
        <a href={url} target="_blank" rel="noopener noreferrer">
          {latestVersion}
        </a>
      </span>
      <button
        type="button"
        className="btn-secondary"
        style={{ padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, latestVersion);
          window.dispatchEvent(new Event(DISMISS_EVENT));
        }}
      >
        {dismissLabel}
      </button>
    </div>
  );
}
