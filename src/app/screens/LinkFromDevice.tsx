/**
 * Joining a sync from inside the app: scan the pairing QR code another device shows (the
 * phone's camera app would open the link in the browser, and on iOS an app added to the
 * Home Screen keeps its storage apart from the browser's), or paste its link. Either way
 * the payload goes to the Pair screen, which asks for the code.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { l, tr } from "../../i18n";
import { readPairLink } from "../../sync/pair";
import { Icon } from "../../ui/icons";
import { go } from "../state";

type Text = ReturnType<typeof l>;

/** Why the camera could not be used. */
type CameraProblem = "denied" | "none" | "busy" | "unavailable";

const CAMERA_ERRORS: Record<CameraProblem, Text> = {
  denied: l(
    "Camera access was refused. Allow the camera for this site in your browser's settings, or paste the link below.",
    "L'accès à l'appareil photo a été refusé. Autorise-le pour ce site dans les réglages du navigateur, ou colle le lien ci-dessous.",
  ),
  none: l(
    "No camera was found on this device. Paste the link below instead.",
    "Aucun appareil photo n'a été trouvé sur cet appareil. Colle plutôt le lien ci-dessous.",
  ),
  busy: l(
    "The camera could not be started: another app may be using it. Close it and try again, or paste the link below.",
    "L'appareil photo n'a pas pu démarrer : une autre app l'utilise peut-être. Ferme-la et réessaie, ou colle le lien ci-dessous.",
  ),
  unavailable: l(
    "This browser cannot use the camera here. Paste the link below instead.",
    "Ce navigateur ne peut pas utiliser l'appareil photo ici. Colle plutôt le lien ci-dessous.",
  ),
};

const NOT_A_LINK = l(
  "This is not a spots pairing link. On the other device, open GitHub sync, press “Link a phone” and copy its link.",
  "Ce n'est pas un lien d'appairage spots. Sur l'autre appareil, ouvre la sync GitHub, appuie sur « Connecter un téléphone » et copie son lien.",
);

class CameraError extends Error {
  constructor(readonly problem: CameraProblem) {
    super(`Camera: ${problem}`);
  }
}

function problemOf(err: unknown): CameraProblem {
  if (err instanceof CameraError) return err.problem;
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "none";
  return "busy";
}

/** The app's address, which a pairing link must point to. */
function appBase(): string {
  return location.origin + location.pathname;
}

/** The text of the QR code in the video frame, or null when none is found. */
type Decode = (video: HTMLVideoElement) => Promise<string | null>;

/** The part of the Barcode Detection API used here; not in TypeScript's DOM types yet. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats?(): Promise<string[]>;
}

/** The browser's own QR reader when it has one, otherwise jsQR, loaded only now. */
async function makeDecoder(): Promise<Decode> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? ["qr_code"];
      if (formats.includes("qr_code")) {
        const detector = new Native({ formats: ["qr_code"] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {}
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!ctx || !w || !h) return null;
    // Small enough to decode a few times a second on a phone, large enough for a dense code.
    const scale = Math.min(1, 960 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

/** How often a frame is read. */
const SCAN_EVERY_MS = 200;

/**
 * The camera preview, reading frames until a pairing QR code shows up. The camera stops
 * when it is found, when the scanner is closed and when it leaves the screen.
 */
function Scanner({
  onFound,
  onFail,
  onClose,
}: {
  onFound: (payload: string) => void;
  onFail: (problem: CameraProblem) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [scanning, setScanning] = useState(false);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("unavailable");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const v = video.current;
        if (stopped || !v) return stop();
        v.srcObject = stream;
        await v.play().catch(() => {});
        const decode = await makeDecoder();
        if (stopped) return;
        setScanning(true);
        const tick = async () => {
          if (stopped) return;
          const text = await decode(v).catch(() => null);
          if (stopped) return;
          if (text) {
            const payload = readPairLink(text, appBase());
            if (payload) {
              stop();
              onFound(payload);
              return;
            }
            setWrong(true);
          }
          timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
        };
        void tick();
      } catch (err) {
        if (stopped) return;
        stop();
        onFail(problemOf(err));
      }
    })();
    return stop;
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section class="scan stack" aria-label={tr(l("Camera", "Appareil photo"))}>
      <video
        ref={video}
        class="scan-video"
        autoplay
        muted
        playsInline
        aria-label={tr(l("Camera preview", "Aperçu de l'appareil photo"))}
      />
      <p class="small" role="status" style={{ margin: 0 }}>
        {wrong
          ? tr(
              l(
                "This QR code is not a spots pairing code. Point the camera at the one shown in GitHub sync on the other device.",
                "Ce QR code n'est pas un code d'appairage spots. Vise celui affiché dans la sync GitHub de l'autre appareil.",
              ),
            )
          : scanning
            ? tr(
                l(
                  "Point the camera at the QR code shown on the other device.",
                  "Vise le QR code affiché sur l'autre appareil.",
                ),
              )
            : tr(l("Starting the camera…", "Démarrage de l'appareil photo…"))}
      </p>
      <button ref={closeButton} type="button" class="btn" onClick={onClose}>
        <Icon name="close" size={17} />
        {tr(l("Close the camera", "Fermer l'appareil photo"))}
      </button>
    </section>
  );
}

/** The "Link from another device" section of a device not synced yet. */
export function LinkFromDevice() {
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const scanButton = useRef<HTMLButtonElement>(null);

  const open = (payload: string) => go({ name: "pair", payload });

  const closeScanner = () => {
    setScanning(false);
    // Back to the button that opened it, once it is shown again.
    setTimeout(() => scanButton.current?.focus(), 0);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const payload = readPairLink(pasted, appBase());
    if (!payload) {
      setLinkError(tr(NOT_A_LINK));
      return;
    }
    setLinkError(null);
    open(payload);
  };

  return (
    <section class="stack section" style={{ gap: "10px" }} aria-labelledby="link-from-device">
      <div class="label" id="link-from-device">
        {tr(l("Link from another device", "Connecter depuis un autre appareil"))}
      </div>
      <p class="small muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Already syncing on another device? There, open GitHub sync and press “Link a phone”, then scan its QR code from here.",
            "Déjà synchronisé sur un autre appareil ? Là-bas, ouvre la sync GitHub et appuie sur « Connecter un téléphone », puis scanne son QR code d'ici.",
          ),
        )}
      </p>
      {scanning ? (
        <Scanner
          onFound={open}
          onFail={(problem) => {
            setCameraError(tr(CAMERA_ERRORS[problem]));
            closeScanner();
          }}
          onClose={closeScanner}
        />
      ) : (
        <button
          ref={scanButton}
          type="button"
          class="btn"
          onClick={() => {
            setCameraError(null);
            setScanning(true);
          }}
        >
          <Icon name="camera" size={17} />
          {tr(l("Scan the QR code", "Scanner le QR code"))}
        </button>
      )}
      {cameraError && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {cameraError}
        </p>
      )}
      <form class="stack" style={{ gap: "10px" }} onSubmit={submit}>
        <label class="field">
          <span class="label">{tr(l("Or paste its link", "Ou colle son lien"))}</span>
          <input
            class="input"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            value={pasted}
            onInput={(e) => {
              setPasted(e.currentTarget.value);
              setLinkError(null);
            }}
            placeholder="https://…#pair=…"
            {...(linkError ? { "aria-invalid": true, "aria-describedby": "pair-link-error" } : {})}
          />
        </label>
        {linkError && (
          <p class="error" role="alert" id="pair-link-error" style={{ margin: 0 }}>
            {linkError}
          </p>
        )}
        <button type="submit" class="btn" disabled={pasted.trim() === ""}>
          <Icon name="link" size={17} />
          {tr(l("Open the link", "Ouvrir le lien"))}
        </button>
      </form>
    </section>
  );
}
