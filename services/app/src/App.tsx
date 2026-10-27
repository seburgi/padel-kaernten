// The app's frame: the head with the feedback button on every screen, and
// three screens by path. Inviting is Seb's alone.
import { FeedbackButton, FeedbackLayer, YourNotes } from "@burgstaller/web/feedback";
import { InstallHint, UpdateNote } from "@burgstaller/web/pwa";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type MouseEvent } from "react";
import { api, call } from "./api/client";
import { Courts } from "./courts/Courts";
import { Invitations } from "./invitations/Invitations";
import { link } from "./ui";

const APP = "Padel Kärnten";

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return [
    path,
    (to) => {
      history.pushState(null, "", to);
      setPath(to);
      window.scrollTo(0, 0);
    },
  ];
}

export function App() {
  const [path, go] = usePath();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const canInvite = me.data?.canInvite ?? false;
  const nav = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    go(to);
  };
  const screen =
    path === "/einladen" && canInvite ? (
      <Invitations />
    ) : path === "/feedback" ? (
      <YourNotes app={APP} />
    ) : (
      <Courts />
    );

  return (
    <div className="mx-auto max-w-3xl px-4 pt-[env(safe-area-inset-top)]">
      <header className="flex items-start justify-between gap-3 pt-6 pb-2">
        <div>
          <a
            href="/"
            onClick={nav("/")}
            className="text-[clamp(1.6rem,5vw,2.1rem)] leading-tight font-semibold tracking-tight"
          >
            Padel Kärnten
          </a>
          <p className="mt-1 text-ink-muted">
            Wo ist noch ein Platz frei? Alle Anlagen auf einen Blick.
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-1">
          {canInvite && path !== "/einladen" && (
            <a href="/einladen" onClick={nav("/einladen")} className={`${link} px-2 text-sm`}>
              Einladen
            </a>
          )}
          <FeedbackButton />
        </nav>
      </header>
      {screen}
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
