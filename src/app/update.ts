/**
 * New versions: the service worker serves the app from its cache, so an open page keeps
 * running the version it started with even once a newer worker has taken over. When that
 * happens the page reloads by itself if nothing would be lost (a pairing link being opened,
 * or a page just opened and not touched yet), and offers a reload otherwise. The worker is
 * asked to look for a new version whenever the app comes back to the front, so a phone that
 * stays open in the background still finds one.
 */
import { l, tr } from "../i18n";
import { toast } from "../ui/ui";
import { href, type Route, route } from "./state";

/** How long after opening a page that was not touched may reload without asking. */
export const FRESH_MS = 10_000;

export interface UpdateMoment {
  /** A worker already controlled the page when it loaded: this is an update, not the first install. */
  wasControlled: boolean;
  /** The screen shown. */
  route: Route["name"];
  /** Milliseconds since the page loaded. */
  sinceLoad: number;
  /** The user pressed or typed something on the page. */
  interacted: boolean;
}

/**
 * What to do when a new worker takes control: nothing on the first install (the page already
 * runs the newest code), reload when nothing would be lost, otherwise offer a reload.
 */
export function updateAction(m: UpdateMoment): "none" | "reload" | "offer" {
  if (!m.wasControlled) return "none";
  // An older version may not know how to open the pairing link: the newer one does.
  if (m.route === "pair") return "reload";
  if (m.sinceLoad < FRESH_MS && !m.interacted) return "reload";
  return "offer";
}

/**
 * Reloads on the same screen. A pairing link leaves the address bar once read (see
 * `routeFromLocation`), its payload living on in the route only: it is put back first, so
 * the reloaded page opens it again.
 */
function reloadHere(): void {
  history.replaceState(null, "", href(route.value));
  location.reload();
}

/** Registers the service worker and follows its updates. */
export function watchUpdates(): void {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  const sw = navigator.serviceWorker;
  const wasControlled = sw.controller !== null;
  let interacted = false;
  const touched = () => {
    interacted = true;
  };
  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(type, touched, { capture: true, once: true, passive: true });
  }
  let handled = false;
  sw.addEventListener("controllerchange", () => {
    if (handled) return;
    handled = true;
    const action = updateAction({
      wasControlled,
      route: route.value.name,
      sinceLoad: performance.now(),
      interacted,
    });
    if (action === "reload") reloadHere();
    else if (action === "offer") {
      toast(
        tr(l("A new version is ready", "Une nouvelle version est prête")),
        { label: tr(l("Reload", "Recharger")), run: reloadHere },
        15_000,
      );
    }
  });
  sw.register("./sw.js")
    .then((reg) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
