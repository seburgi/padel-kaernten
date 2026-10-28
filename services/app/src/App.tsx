// The app's frame: the head with What's new and the feedback button on every
// screen, and the screens by path (react-router). Inviting is Seb's alone.
import { FeedbackButton, FeedbackLayer, YourNotes } from "@burgstaller/web/feedback";
import { InstallHint, UpdateNote } from "@burgstaller/web/pwa";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { api, call } from "./api/client";
import { Courts } from "./courts/Courts";
import { Invitations } from "./invitations/Invitations";
import { link } from "./ui";
import { WhatsNew } from "./whatsnew/WhatsNew";
import { WhatsNewCard } from "./whatsnew/WhatsNewCard";

const APP = "Padel Kärnten";

export function App() {
  const { pathname: path } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const canInvite = me.data?.canInvite ?? false;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-[env(safe-area-inset-top)]">
      <header className="flex items-start justify-between gap-3 pt-6 pb-2">
        <div>
          <Link
            to="/"
            className="text-[clamp(1.6rem,5vw,2.1rem)] leading-tight font-semibold tracking-tight"
          >
            Padel Kärnten
          </Link>
          <p className="mt-1 text-ink-muted">
            Wo ist noch ein Platz frei? Alle Anlagen auf einen Blick.
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-1">
          {canInvite && path !== "/invites" && (
            <Link to="/invites" className={`${link} px-2 text-sm`}>
              Einladen
            </Link>
          )}
          {path !== "/whats-new" && (
            <Link to="/whats-new" className={`${link} px-2 text-sm`}>
              Neu
            </Link>
          )}
          <FeedbackButton />
        </nav>
      </header>
      {path !== "/whats-new" && <WhatsNewCard />}
      <Routes>
        <Route path="/" element={<Courts />} />
        {/* Seb sees the page; anyone else lands on the courts. */}
        <Route path="/invites" element={canInvite ? <Invitations /> : <Courts />} />
        {/* The page's address until 2026-10-28; links to it keep working. */}
        <Route path="/einladen" element={<Navigate to="/invites" replace />} />
        <Route path="/whats-new" element={<WhatsNew />} />
        <Route path="/feedback" element={<YourNotes app={APP} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FeedbackLayer
        app={APP}
        release={import.meta.env.VITE_COMMIT}
        path={path}
        notesHref="/feedback"
      />
      <UpdateNote label="Eine neue Version ist da." />
      <InstallHint app={APP} />
    </div>
  );
}
