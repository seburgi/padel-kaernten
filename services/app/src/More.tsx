// Mehr: on a phone, what is not one of the two halves of the app sits
// behind the tab bar's third tab, as on iOS (Seb, 2026-10-28). Each row
// is a page of its own; wide screens reach the same pages from the head.
// Dein Name comes first, then the pages; under them the venues one drives
// to (Seb, 2026-10-30) and the line that Mitteilungen are on (Seb,
// 2026-10-29).
import { Icon } from "@burgstaller/web/icons";
import type { IconName } from "@burgstaller/web/icons";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { card } from "./ui";

/** The pages the tab Mehr stands for, so it is marked on them too. */
export const MORE = ["/more", "/whats-new", "/help", "/feedback", "/invites", "/profile"];

export function More({
  unread,
  canInvite,
  name,
  venues,
  push,
}: {
  unread: number;
  canInvite: boolean;
  name?: string;
  venues?: ReactNode;
  push?: ReactNode;
}) {
  const rows: { to: string; label: string; icon: IconName; note?: string }[] = [
    { to: "/profile", label: "Dein Name", icon: "pencil", note: name || undefined },
    {
      to: "/whats-new",
      label: "Neuigkeiten",
      icon: "sparkle",
      note: unread > 0 ? `${unread} ungelesen` : undefined,
    },
    { to: "/help", label: "Hilfe", icon: "info" },
    { to: "/feedback", label: "Dein Feedback", icon: "feedback" },
    { to: "/groups", label: "Gruppen finden", icon: "search" },
    ...(canInvite ? [{ to: "/invites", label: "Einladen", icon: "mail" as const }] : []),
  ];
  return (
    <main>
      <h1 className="mt-2 mb-4 text-2xl font-semibold">Mehr</h1>
      <ul className={`${card} m-0 list-none divide-y divide-line p-0`}>
        {rows.map((row) => (
          <li key={row.to}>
            <Link
              to={row.to}
              className="flex min-h-(--size-control-touch) items-center gap-3 px-4 py-3 text-ink hover:bg-hover"
            >
              <Icon name={row.icon} size={22} className="text-accent-text" />
              <span className="flex-1 font-medium">{row.label}</span>
              {row.note && (
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[13px] font-semibold text-accent-text">
                  {row.note}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {venues}
      {push}
    </main>
  );
}
