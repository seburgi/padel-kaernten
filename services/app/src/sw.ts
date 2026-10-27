/// <reference lib="webworker" />
import { serveShell } from "@burgstaller/web/sw";

serveShell({ app: "padel" });
