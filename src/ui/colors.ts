/**
 * The label inks, as hex values for the map (which cannot read CSS variables)
 * and as the text colour that reads on each. The CSS variables in app.css
 * carry the same values for the interface.
 */
import type { TagColor } from "../store/model";

export interface Ink {
  /** The printed fill of a label. */
  fill: string;
  /** Text and glyphs printed on that fill. */
  on: string;
}

/**
 * The keys "vermilion" and "cobalt" are kept for stored tags, but their inks
 * moved off the shell's two colours (the cobalt bar and the vermilion pin
 * button) to a tangerine and a sky blue: colour on the map belongs to tags.
 */
export const INKS: Record<TagColor, Ink> = {
  vermilion: { fill: "#ec7a2c", on: "#16182a" },
  cobalt: { fill: "#4b9be0", on: "#16182a" },
  mustard: { fill: "#f2b731", on: "#16182a" },
  green: { fill: "#1e6b4e", on: "#ffffff" },
  plum: { fill: "#7a2e6e", on: "#ffffff" },
  teal: { fill: "#0f6f78", on: "#ffffff" },
  rose: { fill: "#b8405f", on: "#ffffff" },
  ink: { fill: "#16182a", on: "#ffffff" },
};

/** A label with no tag is printed in slate, a colour no tag takes. */
export const UNTAGGED: Ink = { fill: "#5a6386", on: "#ffffff" };
