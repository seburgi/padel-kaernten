// The app's frame: the head with What's new and the feedback button on every
// screen, Plätze and Spielen, and the screens by path (react-router). The
// page Einladen is Seb's alone; members invite into their groups.
import { FeedbackButton, FeedbackLayer, YourNotes } from "@burgstaller/web/feedback";
import { InstallHint, UpdateNote } from "@burgstaller/web/pwa";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { api, call } from "./api/client";
import { Availability } from "./availability/Availability";
import { Courts } from "./courts/Courts";
import { Group } from "./groups/Group";
import { Groups, NewGroup } from "./groups/Groups";
import { Play } from "./groups/Play";
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
  const playing = ["/play", "/groups", "/availability"].some((p) => path.startsWith(p));

  return (
    <div className="mx-auto max-w-3xl px-4 pt-[env(safe-area-inset-top)]">
      <header className="pt-6 pb-2">
        <div className="flex items-start justify-between gap-3">
          <Link
            to="/"
            className="text-[clamp(1.6rem,5vw,2.1rem)] leading-tight font-semibold tracking-tight"
          >
            Padel Kärnten
          </Link>
          <div className="flex shrink-0 items-center gap-1">
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
          </div>
        </div>
        {path === "/" && (
          <p className="mt-1 text-ink-muted">
            Wo ist noch ein Platz frei? Alle Anlagen auf einen Blick.
          </p>
        )}
        {/* The two halves of the app: free courts, and playing together. */}
        <nav className="mt-3 flex gap-1 rounded-xl bg-sunken p-1" aria-label="Bereiche">
          {[
            { to: "/", label: "Plätze", on: path === "/" },
            { to: "/play", label: "Spielen", on: playing },
          ].map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={tab.on ? "page" : undefined}
              className="flex h-9 flex-1 items-center justify-center rounded-lg text-sm font-semibold text-ink-muted aria-[current=page]:bg-card aria-[current=page]:text-ink aria-[current=page]:shadow-sm"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      {path !== "/whats-new" && <WhatsNewCard />}
      <Routes>
        <Route path="/" element={<Courts />} />
        {/* Seb sees the page; anyone else lands on the courts. */}
        <Route path="/invites" element={canInvite ? <Invitations /> : <Courts />} />
        {/* The page's address until 2026-10-28; links to it keep working. */}
        <Route path="/einladen" element={<Navigate to="/invites" replace />} />
        <Route path="/play" element={<Play />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/new" element={<NewGroup />} />
        <Route path="/groups/:id" element={<Group />} />
        <Route path="/availability" element={<Availability />} />
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
