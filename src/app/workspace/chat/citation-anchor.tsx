"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { ChatCitation } from "@/lib/chat/citations";
import styles from "./chat.module.css";

type CitationAnchorProps = Readonly<{
  label: string;
  citation: ChatCitation | undefined;
  children: ReactNode;
  /** Props react-markdown forwards from the mdast `link` (we render a `button`, not `a`). */
  anchorProps: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">;
}>;

const POPOVER_GAP_PX = 6;

/** Brief delay so the pointer can cross the gap between the inline link and the portaled popover without dismissing. */
const HOVER_LEAVE_TO_POPOVER_MS = 160;

function isTargetInsideCitationUi(
  target: Node | null,
  zone: HTMLSpanElement | null,
  popover: HTMLDivElement | null,
): boolean {
  if (!target) {
    return false;
  }
  if (zone?.contains(target)) {
    return true;
  }
  if (popover?.contains(target)) {
    return true;
  }
  return false;
}

/**
 * Inline citation control: looks like a link, behaves like a button (no `#` navigation).
 * Popover is portaled to `document.body` so it is not clipped by chat scroll/stacking.
 */
export function CitationAnchor({
  label,
  citation,
  children,
  anchorProps,
}: CitationAnchorProps) {
  const panelId = useId();
  const zoneRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hoverDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [panelBox, setPanelBox] = useState<{ top: number; left: number } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const open = hoverOpen || pinnedOpen;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const cancelHoverDismissTimer = useCallback(() => {
    if (hoverDismissTimerRef.current !== null) {
      clearTimeout(hoverDismissTimerRef.current);
      hoverDismissTimerRef.current = null;
    }
  }, []);

  const scheduleHoverDismiss = useCallback(() => {
    cancelHoverDismissTimer();
    hoverDismissTimerRef.current = setTimeout(() => {
      hoverDismissTimerRef.current = null;
      setHoverOpen(false);
    }, HOVER_LEAVE_TO_POPOVER_MS);
  }, [cancelHoverDismissTimer]);

  useEffect(() => () => cancelHoverDismissTimer(), [cancelHoverDismissTimer]);

  const measurePanel = useCallback(() => {
    const zone = zoneRef.current;
    if (!zone) {
      return;
    }
    const anchor = zone.getBoundingClientRect();
    setPanelBox({
      top: anchor.bottom + POPOVER_GAP_PX,
      left: anchor.left,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    measurePanel();
    window.addEventListener("scroll", measurePanel, true);
    window.addEventListener("resize", measurePanel);
    return () => {
      window.removeEventListener("scroll", measurePanel, true);
      window.removeEventListener("resize", measurePanel);
    };
  }, [open, measurePanel]);

  const closeAll = useCallback(() => {
    cancelHoverDismissTimer();
    setHoverOpen(false);
    setPinnedOpen(false);
    setPanelBox(null);
  }, [cancelHoverDismissTimer]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAll();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (isTargetInsideCitationUi(target, zoneRef.current, popoverRef.current)) {
        return;
      }
      closeAll();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, closeAll]);

  const {
    onClick: anchorOnClick,
    className: anchorClassName,
    href: _href,
    target: _target,
    rel: _rel,
    download: _download,
    ping: _ping,
    type: _anchorType,
    ...restAnchor
  } = anchorProps as AnchorHTMLAttributes<HTMLAnchorElement>;

  const handleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    measurePanel();
    setPinnedOpen((previous) => !previous);
    anchorOnClick?.(
      event as unknown as React.MouseEvent<HTMLAnchorElement>,
    );
  };

  const popover =
    portalReady &&
    open &&
    panelBox &&
    typeof document !== "undefined" ? (
      <div
        ref={popoverRef}
        id={panelId}
        className={styles.citationPopover}
        role="dialog"
        aria-label={`Source ${label}`}
        tabIndex={-1}
        onMouseEnter={() => {
          cancelHoverDismissTimer();
          setHoverOpen(true);
        }}
        onMouseLeave={() => {
          if (!pinnedOpen) {
            setHoverOpen(false);
          }
        }}
        style={{
          position: "fixed",
          top: panelBox.top,
          left: panelBox.left,
          zIndex: 10_000,
        }}
      >
        <p className={styles.citationPopoverHeading}>
          {citation?.heading ?? `Source ${label}`}
        </p>
        <div className={styles.citationPopoverBody}>
          {citation?.snippet ?? "No preview is available for this citation."}
        </div>
      </div>
    ) : null;

  return (
    <span
      ref={zoneRef}
      className={styles.citationHoverZone}
      onMouseEnter={() => {
        cancelHoverDismissTimer();
        measurePanel();
        setHoverOpen(true);
      }}
      onMouseLeave={() => {
        scheduleHoverDismiss();
      }}
    >
      <button
        type="button"
        {...(restAnchor as ButtonHTMLAttributes<HTMLButtonElement>)}
        className={`${styles.citationLink} ${anchorClassName ?? ""}`.trim()}
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={handleButtonClick}
      >
        {children}
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </span>
  );
}
