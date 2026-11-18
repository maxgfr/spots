import { render } from "preact";
import { App } from "./app/App";
import { watchUpdates } from "./app/update";
import { startSync } from "./sync/sync";

const root = document.getElementById("app");
if (root) render(<App />, root);

startSync();
watchUpdates();
