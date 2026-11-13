"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const interval = window.setInterval(callback, 60_000);
  return () => window.clearInterval(interval);
}

function getDate() {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long", day: "numeric", month: "long", timeZone: "America/Mexico_City",
  }).format(new Date());
}

export function LocalDate() {
  return useSyncExternalStore(subscribe, getDate, () => "Los Chanchitos");
}
