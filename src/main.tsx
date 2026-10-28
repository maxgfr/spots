import { render } from "preact";
import { App } from "./app/App";
import { startSync } from "./sync/sync";

const root = document.getElementById("app");
if (root) render(<App />, root);

startSync();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
