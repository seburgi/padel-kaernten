// The head every page starts with, the same on every screen (Seb,
// 2026-11-06): a way back where there is one, the title with an action
// beside it, and one grey line on what the page shows.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { link } from "./ui";

export function PageHead({
  title,
  back,
  action,
  children,
}: {
  title: ReactNode;
  /** Where "←" leads, and what it says. */
  back?: { to: string; label: string };
  /** Beside the title, on the right: a link such as Verwalten. */
  action?: ReactNode;
  /** The grey line under the title. */
  children?: ReactNode;
}) {
  return (
    <div className="mt-2 mb-4">
      {back && (
        <Link to={back.to} className={`${link} text-sm`}>
          ← {back.label}
        </Link>
      )}
      <div className={`flex items-baseline justify-between gap-3 ${back ? "mt-1" : ""}`}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {action && <div className="shrink-0 text-sm">{action}</div>}
      </div>
      {children && <p className="mt-1 text-ink-muted">{children}</p>}
    </div>
  );
}
