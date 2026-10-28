/**
 * Icons, drawn from Lucide (one stroke, one weight). TAG_ICONS are the glyphs a
 * tag can carry, printed on its labels; UI_ICONS are the interface's own.
 * Only the icons listed here end up in the bundle.
 */
import {
  AudioLines,
  Baby,
  BedDouble,
  Beer,
  BookOpen,
  CakeSlice,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  Cloud,
  CloudOff,
  Coffee,
  Copy,
  Croissant,
  Download,
  Dumbbell,
  Ellipsis,
  ExternalLink,
  Fish,
  Gift,
  Globe,
  HardDriveDownload,
  Heart,
  IceCreamCone,
  type IconNode,
  Landmark,
  Layers,
  Link,
  List,
  Loader,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Martini,
  Menu,
  MessageSquareText,
  Mic,
  Moon,
  Mountain,
  Navigation,
  Palette,
  Pencil,
  Pizza,
  Plus,
  RefreshCw,
  Sailboat,
  Salad,
  Search,
  Send,
  Settings,
  Share2,
  ShoppingBag,
  Soup,
  Sparkles,
  Square,
  Stamp,
  Star,
  Store,
  Sun,
  Tag,
  Tent,
  Trash,
  Trees,
  Undo2,
  Upload,
  Utensils,
  WavesHorizontal,
  WifiOff,
  Wine,
  X,
} from "lucide";

/** The glyphs a tag can carry, by key (the key is what a Tag stores). */
export const TAG_ICONS: Record<string, IconNode> = {
  utensils: Utensils,
  soup: Soup,
  pizza: Pizza,
  fish: Fish,
  salad: Salad,
  croissant: Croissant,
  cake: CakeSlice,
  "ice-cream": IceCreamCone,
  coffee: Coffee,
  wine: Wine,
  cocktail: Martini,
  beer: Beer,
  shop: ShoppingBag,
  store: Store,
  gift: Gift,
  landmark: Landmark,
  camera: Camera,
  palette: Palette,
  book: BookOpen,
  cinema: Clapperboard,
  music: AudioLines,
  park: Trees,
  mountain: Mountain,
  beach: WavesHorizontal,
  boat: Sailboat,
  camp: Tent,
  hotel: BedDouble,
  sport: Dumbbell,
  kids: Baby,
  heart: Heart,
  star: Star,
  pin: MapPin,
};

const UI_ICONS = {
  search: Search,
  plus: Plus,
  close: X,
  back: ChevronLeft,
  next: ChevronRight,
  down: ChevronDown,
  menu: Menu,
  locate: LocateFixed,
  list: List,
  map: MapIcon,
  edit: Pencil,
  trash: Trash,
  share: Share2,
  link: Link,
  copy: Copy,
  check: Check,
  upload: Upload,
  download: Download,
  sparkles: Sparkles,
  mic: Mic,
  stop: Square,
  route: Navigation,
  external: ExternalLink,
  tag: Tag,
  cloud: Cloud,
  "cloud-off": CloudOff,
  sync: RefreshCw,
  sun: Sun,
  moon: Moon,
  globe: Globe,
  offline: WifiOff,
  layers: Layers,
  undo: Undo2,
  settings: Settings,
  more: Ellipsis,
  stamp: Stamp,
  "state-try": CircleDashed,
  "state-visited": CircleCheck,
  "state-favorite": Heart,
  ask: MessageSquareText,
  send: Send,
  spinner: Loader,
  keep: HardDriveDownload,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof UI_ICONS | "github";

/** GitHub's mark, which Lucide no longer ships. Filled, unlike the stroked icons. */
const GITHUB_PATH =
  "M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z";

function nodeChildren(node: IconNode) {
  return node.map(([tag, attrs], i) => {
    const Tag = tag as "path";
    return <Tag key={i} {...(attrs as Record<string, string>)} />;
  });
}

export function Icon({
  name,
  size = 20,
  class: cls,
}: {
  name: IconName;
  size?: number;
  class?: string;
}) {
  if (name === "github") {
    return (
      <svg
        class={cls ? `icon ${cls}` : "icon"}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={GITHUB_PATH} />
      </svg>
    );
  }
  return <Svg node={UI_ICONS[name]} size={size} {...(cls ? { cls } : {})} />;
}

export function TagGlyph({ icon, size = 18 }: { icon: string; size?: number }) {
  return <Svg node={TAG_ICONS[icon] ?? MapPin} size={size} />;
}

function Svg({ node, size, cls }: { node: IconNode; size: number; cls?: string }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {nodeChildren(node)}
    </svg>
  );
}

/** An icon as standalone SVG markup, for drawing it onto the map's labels. */
export function iconSvg(icon: string, color: string, px: number): string {
  const node = TAG_ICONS[icon] ?? MapPin;
  const parts = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${parts}</svg>`;
}
