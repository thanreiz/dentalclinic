"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * /book is a fixed frame like the staff shell: the page never scrolls, only the step content does.
 * Height follows the visual viewport, so on iOS the frame shrinks above the on-screen keyboard and the
 * pinned action bar stays visible (dvh alone does not react to the keyboard there).
 */
export default function BookShell({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (vv.scale > 1.01) return; // pinch-zoomed: leave the layout alone
      setHeight(Math.round(vv.height));
      if (window.scrollY !== 0) window.scrollTo(0, 0); // iOS nudges the page when the keyboard opens
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div
      id="book-shell"
      style={height ? { height } : undefined}
      className="relative flex h-dvh flex-col overflow-hidden bg-canvas"
    >
      <a
        href="#book-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to form
      </a>
      {children}
    </div>
  );
}
