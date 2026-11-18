/**
 * The phone's side of a pairing QR code: the link opened here carries the GitHub token,
 * encrypted; the code shown beside the QR on the computer opens it, and the phone connects
 * to the same sync: the same repository file, or the same gist.
 */
import { useEffect, useState } from "preact/hooks";
import { fmt, l, tr } from "../../i18n";
import { GitHubError } from "../../sync/github";
import {
  isCode,
  openPairing,
  type PairAccess,
  PairError,
  type PairErrorCode,
} from "../../sync/pair";
import { connectPaired, link } from "../../sync/sync";
import { Icon } from "../../ui/icons";
import { ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { go } from "../state";
import { errorText } from "./Sync";

const PAIR_ERRORS: Record<PairErrorCode, ReturnType<typeof l>> = {
  "bad-code": l(
    "This is not the code shown under the QR code. Check it and try again.",
    "Ce n'est pas le code affiché sous le QR code. Vérifie-le et réessaie.",
  ),
  expired: l(
    "This QR code has expired. On your computer, open GitHub sync and show a new one.",
    "Ce QR code a expiré. Sur ton ordinateur, ouvre la sync GitHub et affiche-en un nouveau.",
  ),
  malformed: l(
    "This link is incomplete. On your computer, show a new QR code and scan it again.",
    "Ce lien est incomplet. Sur ton ordinateur, affiche un nouveau QR code et scanne-le à nouveau.",
  ),
};

export function Pair({ payload }: { payload: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestSnap("full");
  }, []);

  const linked = link.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!isCode(code)) return;
    setBusy(true);
    setError(null);
    let access: PairAccess | null = null;
    try {
      access = await openPairing(payload, code, Date.now());
      await connectPaired(access);
      toast(tr(l("Linked: your places are coming in", "Connecté : tes lieux arrivent")));
      go({ name: "home" }, { replace: true });
    } catch (err) {
      setError(
        err instanceof PairError
          ? tr(PAIR_ERRORS[err.code])
          : errorText(
              err instanceof GitHubError ? err.code : "server",
              access?.target ? "repo" : "gist",
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="stack" onSubmit={submit}>
      <ScreenHead
        title={tr(l("Link this device", "Connecter cet appareil"))}
        onBack={() => go({ name: "home" }, { replace: true })}
      />
      <p class="muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Type the code shown under the QR code on your computer. This device then joins your sync, on the same GitHub repository or gist.",
            "Tape le code affiché sous le QR code sur ton ordinateur. Cet appareil rejoint alors ta sync, sur le même dépôt ou gist GitHub.",
          ),
        )}
      </p>
      {linked && (
        <div class="notice" role="status">
          {fmt(
            l(
              "This device already syncs with {who}. Linking it replaces that connection; the places on this device are kept.",
              "Cet appareil se synchronise déjà avec {who}. Le connecter remplace cette connexion ; les lieux de cet appareil sont gardés.",
            ),
            { who: linked.login ? `@${linked.login}` : "GitHub" },
          )}
        </div>
      )}
      <label class="field">
        <span class="label">{tr(l("Pairing code", "Code d'appairage"))}</span>
        <input
          class="input pair-input"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellcheck={false}
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
          placeholder="XXXX-XXXX"
        />
      </label>
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" class="btn primary block" disabled={busy || !isCode(code)}>
        <Icon name={busy ? "spinner" : "github"} size={18} {...(busy ? { class: "spin" } : {})} />
        {linked
          ? tr(l("Replace the link", "Remplacer la connexion"))
          : tr(l("Link this device", "Connecter cet appareil"))}
      </button>
    </form>
  );
}
