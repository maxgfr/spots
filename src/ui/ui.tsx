/**
 * Shared pieces: the mini label (a place's tag and state, as on the map),
 * screen headers, toasts with an undo, and small helpers.
 */
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { back } from "../app/state";
import { l, tr } from "../i18n";
import type { Place, PlaceState, Tag } from "../store/model";
import { mainTag } from "../store/store";
import { INKS, type Ink, UNTAGGED } from "./colors";
import { Icon, type IconName, TagGlyph } from "./icons";

export function inkStyle(ink: Ink): Record<string, string> {
  return { "--fill": ink.fill, "--on": ink.on };
}

export function tagInk(tag: Tag | undefined): Ink {
  return tag ? INKS[tag.color] : UNTAGGED;
}

/** A place's label as the interface draws it: tag ink, tag glyph, state shape. */
export function Mini({
  place,
  size = 32,
}: {
  place: Pick<Place, "state" | "tagIds">;
  size?: number;
}) {
  const tag = mainTag(place as Place);
  return (
    <span
      class={`mini state-${place.state}`}
      style={{ ...inkStyle(tagInk(tag)), "--size": `${size}px` }}
      aria-hidden="true"
    >
      <TagGlyph icon={tag?.icon ?? "pin"} size={Math.round(size * 0.52)} />
    </span>
  );
}

export function ScreenHead({
  title,
  onBack,
  noBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  /** For a screen the top bar already closes (the menu). */
  noBack?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="screen-head" style={noBack ? { marginLeft: 0 } : undefined}>
      {!noBack && (
        <button
          type="button"
          class="icon-btn"
          onClick={onBack ?? (() => back())}
          aria-label={tr(l("Back", "Retour"))}
        >
          <Icon name="back" />
        </button>
      )}
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      class="icon-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
    >
      <Icon name={icon} />
    </button>
  );
}

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let toastSeq = 0;

/** Shows a short message, with an optional action (an undo), for a few seconds. */
export function toast(text: string, action?: Toast["action"], ms = 4500): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value.slice(-2), { id, text, ...(action ? { action } : {}) }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div class="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                toasts.value = toasts.value.filter((x) => x.id !== t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Copies text, with a toast either way. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(tr(l("Copied", "Copié")));
  } catch {
    toast(
      tr(
        l(
          "Could not copy: select the text and copy it",
          "Copie impossible : sélectionne le texte et copie-le",
        ),
      ),
    );
  }
}

export function downloadText(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATES: { id: PlaceState; label: ReturnType<typeof l> }[] = [
  { id: "try", label: l("To try", "À tester") },
  { id: "visited", label: l("Visited", "Visité") },
  { id: "favorite", label: l("Favourite", "Favori") },
];

/**
 * A place's state, chosen by the shapes its label takes on the map: a ring to
 * try, filled once visited, a second ring for a favourite.
 */
export function StateToggles({
  value,
  ink,
  onChange,
}: {
  value: PlaceState;
  ink: Ink;
  onChange: (s: PlaceState) => void;
}) {
  return (
    <fieldset class="states" style={inkStyle(ink)} aria-label={tr(l("State", "État"))}>
      {STATES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
        >
          <span class={`shape shape-${s.id}`} aria-hidden="true" />
          {tr(s.label)}
        </button>
      ))}
    </fieldset>
  );
}
