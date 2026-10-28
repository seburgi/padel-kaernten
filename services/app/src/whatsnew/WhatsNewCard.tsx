// A small card under the head while something new is unread. Never a
// dialog: what's new never stands in the way.
import { Link } from "react-router";
import { card, link } from "../ui";
import { useReleaseNotes } from "./useReleaseNotes";

export function WhatsNewCard() {
  const { unread, markRead } = useReleaseNotes();
  if (unread.length === 0) return null;
  return (
    <div
      role="status"
      className={`${card} mb-3 flex items-center justify-between gap-2 py-1 pr-1 pl-4`}
    >
      <p className="text-sm">
        {unread.length === 1 ? "Eine Neuigkeit" : `${unread.length} Neuigkeiten`} seit deinem
        letzten Besuch.{" "}
        <Link to="/whats-new" className={link}>
          Ansehen
        </Link>
      </p>
      <button
        type="button"
        aria-label="Wegklicken"
        onClick={() => void markRead()}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-hover"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
