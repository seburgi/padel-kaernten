import "./styles.css";
import { endBoot, updating, whenLoaded } from "@burgstaller/web/boot";
import { startUpdates } from "@burgstaller/web/pwa";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([{ path: "*", element: <App /> }]);

startUpdates();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
// The boot screen goes once the first screen and its data are there, on
// every start and not only on the reload for a new release (Seb,
// 2026-10-30: after half an hour unused the gateway and the API wake for up
// to ten seconds, and the app stood there empty meanwhile). It still never
// shows when the data come within its short delay (kit/web's boot.ts). What
// counts is what is read, never what is written: a refresh asks the booking
// sites and takes seconds, and the screen shows the last snapshot meanwhile
// (docs/design/slots.md). updating() only clears the release's mark.
updating();
whenLoaded(
  () => queryClient.isFetching(),
  () => endBoot(),
);
