// The app's frame: the head with What's new, Hilfe and the feedback button on every
// screen, Plätze and Spielen, and the screens by path (react-router). On a
// phone Plätze, Wann kann ich?, Spielen and Mehr (Neu, Hilfe, Einladen) sit
// in the kit's tab bar at the bottom instead (standards/frontend/navigation.md;
// Wann kann ich? a tab of its own, Seb 2026-10-29). The
// page Einladen is Seb's alone; members invite into their groups.
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
import { BestFits } from "./games/BestFits";
import { Fits } from "./games/Fits";
import { Game } from "./games/Game";
import { Upcoming } from "./games/Upcoming";
import { Waiting } from "./games/Waiting";
import { Group } from "./groups/Group";
import { Groups, NewGroup } from "./groups/Groups";
import { Play, Profile } from "./groups/Play";
import { FirstSteps } from "./help/FirstSteps";
import { Help } from "./help/Help";
import { Welcome } from "./help/Welcome";
import { useKeepPush } from "./push/push";
import { PushCard } from "./push/PushCard";
import { Invitations } from "./invitations/Invitations";
import { MORE, More } from "./More";
import { link } from "./ui";
import { WhatsNew } from "./whatsnew/WhatsNew";
import { WhatsNewCard } from "./whatsnew/WhatsNewCard";
import { useReleaseNotes } from "./whatsnew/useReleaseNotes";

const APP = "Padel Kärnten";
// The tab Wann kann ich?: a clock, which the kit's set has not.
const CLOCK = ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M12 7v5l3 2"];

export function App() {
  const { pathname: path, search, hash, key } = useLocation();
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
  // Opening the app at its bare address, someone in a group starts on
  // Spielen, where what waits for them is (Seb, 2026-10-29); anyone else,
  // and a tap on Plätze later, stays on the courts. "default" is the
  // router's key for the entry the app opened on.
  const opening = path === "/" && key === "default";
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
    enabled: opening,
  });
  const toPlay = opening && (groups.data?.some((g) => g.how === "member") ?? false);
  const deciding = opening && groups.isPending;
  useKeepPush();
  const playing = ["/play", "/groups", "/availability", "/games"].some((p) => path.startsWith(p));
  const when = path === "/availability";

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
              <Link to="/invites" className={`${link} hidden px-1.5 text-sm md:inline`}>
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
        {/* The sections, as in the tab bar on a phone (without Mehr, whose
            pages sit in the head here). */}
        <nav className="mt-3 hidden gap-1 rounded-xl bg-sunken p-1 md:flex" aria-label="Bereiche">
          {[
            { to: "/", label: "Plätze", on: path === "/" },
            { to: "/availability", label: "Wann kann ich?", on: when },
            { to: "/play", label: "Spielen", on: playing && !when },
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
      {/* The card stays on the two first screens only, so it never pushes
          the others down (Seb, 2026-10-29); Mehr and Neu in the head say
          the rest. */}
      {["/", "/play"].includes(path) && !newHere && <WhatsNewCard />}
      {welcomeFirst ? (
        <Navigate to={`/welcome?next=${encodeURIComponent(path + search + hash)}`} replace />
      ) : toPlay ? (
        <Navigate to="/play" replace />
      ) : deciding ? (
        <div aria-busy="true" aria-label="Lädt" />
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
                start={<FirstSteps />}
                waiting={(invites, n) => <Waiting invites={invites} invited={n} />}
                games={
                  <>
                    <PushCard where="play" />
                    <Upcoming />
                    <BestFits />
                  </>
                }
              />
            }
          />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/new" element={<NewGroup />} />
          <Route
            path="/groups/:id"
            element={
              <Group
                games={(id) => (
                  <>
                    <BestFits key={`fits-${id}`} group={id} />
                    <Upcoming key={id} group={id} />
                  </>
                )}
              />
            }
          />
          <Route path="/groups/:id/fits" element={<Fits />} />
          <Route path="/games/:id" element={<Game notify={<PushCard where="game" />} />} />
          <Route path="/availability" element={<Availability />} />
          <Route
            path="/more"
            element={
              <More
                unread={unread.length}
                canInvite={canInvite}
                name={me.data?.name}
                push={<PushCard where="more" />}
              />
            }
          />
          <Route path="/profile" element={<Profile />} />
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
            { to: "/availability", label: "Wann kann ich?", icon: CLOCK, on: when },
            { to: "/play", label: "Spielen", icon: "calendar", on: playing && !when },
            {
              to: "/more",
              label: "Mehr",
              icon: "more",
              on: MORE.includes(path),
              dot: unread.length > 0,
            },
          ]}
        />
      )}
      <UpdateNote label="Eine neue Version ist da." />
      <div className="mt-4 pb-4">
        <InstallHint app={APP} />
      </div>
    </div>
  );
}
