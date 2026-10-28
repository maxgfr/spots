/**
 * Tags: the label inks. Each has a name, an ink and a glyph, printed on every
 * label of its places, and doubles as a filter on the map.
 */
import { useEffect, useState } from "preact/hooks";
import { l, plural, tr } from "../../i18n";
import { TAG_COLORS, type Tag, type TagColor } from "../../store/model";
import { addTag, deleteTag, places, tags, updateTag } from "../../store/store";
import { INKS } from "../../ui/colors";
import { Icon, TAG_ICONS, TagGlyph } from "../../ui/icons";
import { inkStyle, ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";

const COLOR_NAMES: Record<TagColor, ReturnType<typeof l>> = {
  vermilion: l("Tangerine", "Mandarine"),
  cobalt: l("Sky", "Ciel"),
  mustard: l("Mustard", "Moutarde"),
  green: l("Bottle green", "Vert bouteille"),
  plum: l("Plum", "Prune"),
  teal: l("Teal", "Bleu canard"),
  rose: l("Rose", "Rose"),
  ink: l("Ink", "Encre"),
};

export function Tags() {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    requestSnap("full");
  }, []);

  const counts = new Map<string, number>();
  for (const p of places.value)
    for (const id of p.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const create = () => {
    const used = new Set(tags.value.map((t) => t.color));
    const t = addTag({
      name: tr(l("New tag", "Nouveau tag")),
      color: TAG_COLORS.find((c) => !used.has(c)) ?? "ink",
      icon: "pin",
    });
    setOpen(t.id);
  };

  return (
    <div class="stack">
      <ScreenHead title={tr(l("Tags", "Tags"))} />
      <ul class="menu-list">
        {tags.value.map((t) => {
          const n = counts.get(t.id) ?? 0;
          return (
            <li key={t.id}>
              <button
                type="button"
                class="menu-item"
                aria-expanded={open === t.id}
                onClick={() => setOpen(open === t.id ? null : t.id)}
              >
                <span class="mini" style={{ ...inkStyle(INKS[t.color]), "--size": "34px" }}>
                  <TagGlyph icon={t.icon} size={18} />
                </span>
                <span class="menu-text">
                  <strong>{t.name}</strong>
                  <span>
                    {n} {plural(n, l("place", "lieu"), l("places", "lieux"))}
                  </span>
                </span>
                <Icon name="down" />
              </button>
              {open === t.id && <TagEditor tag={t} count={n} onDone={() => setOpen(null)} />}
            </li>
          );
        })}
      </ul>
      <button type="button" class="btn block" onClick={create}>
        <Icon name="plus" size={18} />
        {tr(l("New tag", "Nouveau tag"))}
      </button>
    </div>
  );
}

function TagEditor({ tag, count, onDone }: { tag: Tag; count: number; onDone: () => void }) {
  const [name, setName] = useState(tag.name);
  return (
    <div class="stack" style={{ padding: "14px 18px 18px", borderBottom: "1px solid var(--rule)" }}>
      <label class="field">
        <span class="label">{tr(l("Name", "Nom"))}</span>
        <input
          class="input"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={() =>
            name.trim() && name.trim() !== tag.name && updateTag(tag.id, { name: name.trim() })
          }
        />
      </label>
      <div class="field">
        <span class="label">{tr(l("Ink", "Encre"))}</span>
        <fieldset class="swatches">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              class="swatch"
              style={inkStyle(INKS[c])}
              aria-pressed={tag.color === c}
              aria-label={tr(COLOR_NAMES[c])}
              title={tr(COLOR_NAMES[c])}
              onClick={() => updateTag(tag.id, { color: c })}
            />
          ))}
        </fieldset>
      </div>
      <div class="field">
        <span class="label">{tr(l("Glyph", "Pictogramme"))}</span>
        <fieldset class="glyphs" style={inkStyle(INKS[tag.color])}>
          {Object.keys(TAG_ICONS).map((k) => (
            <button
              key={k}
              type="button"
              class="glyph"
              aria-pressed={tag.icon === k}
              aria-label={k}
              onClick={() => updateTag(tag.id, { icon: k })}
            >
              <TagGlyph icon={k} size={20} />
            </button>
          ))}
        </fieldset>
      </div>
      <div class="row">
        <button
          type="button"
          class="btn shell"
          onClick={() => {
            if (name.trim() && name.trim() !== tag.name) updateTag(tag.id, { name: name.trim() });
            onDone();
          }}
        >
          {tr(l("Done", "Terminé"))}
        </button>
        <button
          type="button"
          class="btn danger"
          onClick={() => {
            deleteTag(tag.id);
            toast(
              count > 0
                ? tr(
                    l(
                      "Tag deleted. Its places keep their other tags.",
                      "Tag supprimé. Ses lieux gardent leurs autres tags.",
                    ),
                  )
                : tr(l("Tag deleted", "Tag supprimé")),
            );
          }}
        >
          <Icon name="trash" size={17} />
          {tr(l("Delete", "Supprimer"))}
        </button>
      </div>
    </div>
  );
}
