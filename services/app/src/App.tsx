// The app's frame: the head with What's new, Hilfe and the feedback button on every
// screen, Plätze and Spielen, and the screens by path (react-router). On a
// phone the sections, Neu and Hilfe sit in the kit's tab bar at the bottom
// instead (standards/frontend/navigation.md). The page Einladen is Seb's
// alone; members invite into their groups.
import { FeedbackButton, FeedbackLayer, YourNotes } from "@burgstaller/web/feedback";
import { Icon } from "@burgstaller/web/icons";
import { TabBar } from "@burgstaller/web/nav";
import { InstallHint, UpdateNote } from "@burgstaller/web/pwa";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { api, call } from "./api/client";
import { Availability } from "./availability/Availability";
import { Courts } from "./courts/Courts";
import { Fits } from "./games/Fits";
import { Game } from "./games/Game";
import { Upcoming } from "./games/Upcoming";
import { Group } from "./groups/Group";
import { Groups, NewGroup } from "./groups/Groups";
import { Play } from "./groups/Play";
import { Help } from "./help/Help";
import { Welcome } from "./help/Welcome";
import { useKeepPush } from "./push/push";
import { PushCard } from "./push/PushCard";
import { Invitations } from "./invitations/Invitations";
import { link } from "./ui";
import { WhatsNew } from "./whatsnew/WhatsNew";
import { WhatsNewCard } from "./whatsnew/WhatsNewCard";
import { useReleaseNotes } from "./whatsnew/useReleaseNotes";

const APP = "Padel Kärnten";

export function App() {
  const { pathname: path, search, hash } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const canInvite = me.data?.canInvite ?? false;
  const { unread, markRead } = useReleaseNotes();
  // Someone new sees the welcome once, whatever they opened, and then what
  // they opened (docs/design/help.md). The Hilfe and their notes stay open.
  const newHere = me.data?.welcomed === false;
  const welcomeFirst = newHere && !["/welcome", "/help", "/feedback"].includes(path);
  useKeepPush();
  const playing = ["/play", "/groups", "/availability", "/games"].some((p) => path.startsWith(p));

  return (
    <div className="mx-auto max-w-3xl px-4 pt-[env(safe-area-inset-top)]">
      <header className="pt-6 pb-2">
        <div className="flex items-start justify-between gap-3">
          <Link
            to="/"
            className="text-[clamp(1.4rem,5vw,2.1rem)] leading-tight font-semibold tracking-tight"
          >
            Padel Kärnten
          </Link>
          <div className="flex shrink-0 items-center gap-0.5">
            {canInvite && path !== "/invites" && (
              <Link to="/invites" className={`${link} px-1.5 text-sm`}>
                Einladen
              </Link>
            )}
            {path !== "/whats-new" && (
              <Link to="/whats-new" className={`${link} hidden px-1.5 text-sm md:inline`}>
                Neu
              </Link>
            )}
            {path !== "/help" && (
              <Link
                to="/help"
                aria-label="Hilfe"
                title="Hilfe"
                className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover hover:text-ink md:inline-flex"
              >
                <Icon name="info" size={22} />
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
        <nav className="mt-3 hidden gap-1 rounded-xl bg-sunken p-1 md:flex" aria-label="Bereiche">
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
      {path !== "/whats-new" && !newHere && <WhatsNewCard />}
      {welcomeFirst ? (
        <Navigate to={`/welcome?next=${encodeURIComponent(path + search + hash)}`} replace />
      ) : (
        <Routes>
          <Route path="/" element={<Courts />} />
          {/* Seb sees the page; anyone else lands on the courts. */}
          <Route path="/invites" element={canInvite ? <Invitations /> : <Courts />} />
          {/* The page's address until 2026-10-28; links to it keep working. */}
          <Route path="/einladen" element={<Navigate to="/invites" replace />} />
          <Route
            path="/play"
            element={
              <Play
                games={
                  <>
                    <PushCard where="play" />
                    <Upcoming />
                  </>
                }
              />
            }
          />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/new" element={<NewGroup />} />
          <Route
            path="/groups/:id"
            element={<Group games={(id) => <Upcoming key={id} group={id} />} />}
          />
          <Route path="/groups/:id/fits" element={<Fits />} />
          <Route path="/games/:id" element={<Game notify={<PushCard where="game" />} />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/whats-new" element={<WhatsNew />} />
          <Route path="/help" element={<Help />} />
          <Route path="/welcome" element={<Welcome onWelcome={() => void markRead()} />} />
          <Route path="/feedback" element={<YourNotes app={APP} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <FeedbackLayer
        app={APP}
        release={import.meta.env.VITE_COMMIT}
        path={path}
        notesHref="/feedback"
      />
      {path !== "/welcome" && (
        <TabBar
          link={Link}
          label="Bereiche"
          dotLabel="neu"
          tabs={[
            { to: "/", label: "Plätze", icon: "pin", on: path === "/" },
            { to: "/play", label: "Spielen", icon: "calendar", on: playing },
            {
              to: "/whats-new",
              label: "Neu",
              icon: "sparkle",
              on: path === "/whats-new",
              dot: unread.length > 0,
            },
            { to: "/help", label: "Hilfe", icon: "info", on: path === "/help" },
          ]}
        />
      )}
      <UpdateNote label="Eine neue Version ist da." />
      <InstallHint app={APP} />
    </div>
  );
}
