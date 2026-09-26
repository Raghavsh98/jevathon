"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

// The <html> class is the source of truth: an inline script sets it before
// first paint, so React reads it rather than owning it.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);

  const set = (next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme", next);
    listeners.forEach((listener) => listener());
  };

  return (
    <div className="flex items-center rounded-full border border-[var(--line)] p-[2px]">
      {(["light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-label={`${option} mode`}
          aria-pressed={theme === option}
          onClick={() => set(option)}
          className="flex h-6 w-6 items-center justify-center rounded-full transition-colors"
          style={{
            background: theme === option ? "var(--fill)" : "transparent",
            color: theme === option ? "var(--foreground)" : "var(--faint)",
          }}
        >
          {option === "light" ? <SunIcon /> : <MoonIcon />}
        </button>
      ))}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
