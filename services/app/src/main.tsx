import "./styles.css";
import { appReady } from "@burgstaller/web/boot";
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
// The boot screen goes once the first screen and its data are there.
appReady(() => queryClient.isFetching() + queryClient.isMutating());
