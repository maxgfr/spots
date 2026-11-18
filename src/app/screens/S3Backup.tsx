/**
 * The backup kept in an S3 bucket (AWS or S3-compatible), by hand: set up once
 * with keys that can only read and write that one object, then export or import
 * when asked. Mounted in the Backup section of the Import & export screen.
 */
import { useEffect, useState } from "preact/hooks";
import { l, tr } from "../../i18n";
import { corsConfig, endpointHost, iamPolicy, S3_FILE, S3_REGION, S3Error } from "../../sync/s3";
import {
  exportToS3,
  forgetS3Target,
  importFromS3,
  loadS3Target,
  type S3Link,
  s3Target,
  s3TargetKept,
  setUpS3,
} from "../../sync/s3Backup";
import { Icon } from "../../ui/icons";
import { copyText, toast } from "../../ui/ui";

type Text = ReturnType<typeof l>;

const ERRORS: Record<string, Text> = {
  auth: l(
    "S3 refused these keys. Check both of them, and that they may read and write this file.",
    "S3 refuse ces clés. Vérifie-les toutes les deux, et qu'elles peuvent lire et écrire ce fichier.",
  ),
  "not-found": l(
    "Not found: check the bucket's name, and that the file exists.",
    "Introuvable : vérifie le nom du bucket, et que le fichier existe.",
  ),
  network: l(
    "The bucket could not be reached. Either you are offline, or its CORS configuration does not allow this site: paste the one under “Bucket setup”.",
    "Le bucket est injoignable. Soit tu es hors ligne, soit sa configuration CORS n'autorise pas ce site : colle celle de « Réglages du bucket ».",
  ),
  "bad-config": l(
    "This address does not work: check the endpoint, the region and the bucket, and try path style.",
    "Cette adresse ne marche pas : vérifie l'endpoint, la région et le bucket, et essaie le style chemin.",
  ),
  "not-a-backup": l(
    "This file is not a spots backup. Choose another file key.",
    "Ce fichier n'est pas une sauvegarde spots. Choisis une autre clé de fichier.",
  ),
  server: l(
    "S3 ran into an error. Try again in a moment.",
    "S3 a rencontré une erreur. Réessaie dans un instant.",
  ),
};

function errorText(err: unknown): string {
  const code = err instanceof S3Error ? err.code : "server";
  return tr((ERRORS[code] ?? ERRORS.server) as Text);
}

export function S3Backup() {
  useEffect(() => {
    void loadS3Target();
  }, []);
  const saved = s3Target.value;
  if (saved === undefined) return null;
  return saved ? <Saved saved={saved} /> : <SetUp />;
}

function Field({
  label,
  value,
  onInput,
  placeholder,
  password,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label class="field">
      <span class="label">{label}</span>
      <input
        class="input"
        {...(password ? { type: "password" } : {})}
        autoComplete="off"
        autoCapitalize="off"
        spellcheck={false}
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
        {...(placeholder ? { placeholder } : {})}
      />
    </label>
  );
}

function Snippet({ title, text }: { title: string; text: string }) {
  return (
    <div class="stack" style={{ gap: "6px" }}>
      <div class="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span class="small">{title}</span>
        <button type="button" class="btn" onClick={() => void copyText(text)}>
          <Icon name="copy" size={17} />
          {tr(l("Copy", "Copier"))}
        </button>
      </div>
      <pre
        class="notice"
        style={{ margin: 0, overflowX: "auto", fontSize: "12px", whiteSpace: "pre" }}
      >
        {text}
      </pre>
    </div>
  );
}

function SetUp() {
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [key, setKey] = useState("");
  // Null follows the endpoint (a custom one usually wants path style) until ticked by hand.
  const [pathStyleSet, setPathStyle] = useState<boolean | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathStyle = pathStyleSet ?? endpoint.trim() !== "";
  const ready = bucket.trim() !== "" && accessKeyId.trim() !== "" && secretAccessKey.trim() !== "";

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { exported } = await setUpS3(
        { endpoint, region, bucket, key, pathStyle },
        { accessKeyId, secretAccessKey },
      );
      toast(
        exported
          ? tr(l("Notebook saved to S3", "Carnet enregistré sur S3"))
          : tr(
              l(
                "Bucket saved. It already holds a backup: import it, or export over it.",
                "Bucket enregistré. Il contient déjà une sauvegarde : importe-la, ou exporte par-dessus.",
              ),
            ),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details class="disclose">
      <summary>
        <Icon name="cloud" size={17} />
        {tr(l("Back up to S3", "Sauvegarder sur S3"))}
      </summary>
      <form class="stack" style={{ gap: "10px" }} onSubmit={submit}>
        <p class="small muted" style={{ margin: 0 }}>
          {tr(
            l(
              "Keep the backup in an S3 bucket of yours: AWS, Cloudflare R2, Scaleway, OVH, MinIO or any S3-compatible storage.",
              "Garde la sauvegarde dans un de tes buckets S3 : AWS, Cloudflare R2, Scaleway, OVH, MinIO ou tout stockage compatible S3.",
            ),
          )}
        </p>
        <Field
          label={tr(l("Endpoint (optional)", "Endpoint (facultatif)"))}
          value={endpoint}
          onInput={setEndpoint}
          placeholder={tr(
            l(
              "AWS — or https://…r2.cloudflarestorage.com",
              "AWS — ou https://…r2.cloudflarestorage.com",
            ),
          )}
        />
        <Field
          label={tr(l("Region", "Région"))}
          value={region}
          onInput={setRegion}
          placeholder={`${S3_REGION} · ${tr(l("auto for R2", "auto pour R2"))}`}
        />
        <Field label="Bucket" value={bucket} onInput={setBucket} />
        <Field
          label={tr(l("File key", "Clé du fichier"))}
          value={key}
          onInput={setKey}
          placeholder={S3_FILE}
        />
        <label class="row small" style={{ gap: "8px", alignItems: "center", flexWrap: "nowrap" }}>
          <input
            type="checkbox"
            checked={pathStyle}
            onChange={(e) => setPathStyle(e.currentTarget.checked)}
          />
          {tr(
            l(
              "Path style (endpoint/bucket/key), for most S3-compatible services",
              "Style chemin (endpoint/bucket/clé), pour la plupart des services compatibles S3",
            ),
          )}
        </label>
        <Field
          label={tr(l("Access key ID", "ID de clé d'accès"))}
          value={accessKeyId}
          onInput={setAccessKeyId}
        />
        <Field
          label={tr(l("Secret access key", "Clé d'accès secrète"))}
          value={secretAccessKey}
          onInput={setSecretAccessKey}
          password
        />
        <details>
          <summary class="small">{tr(l("Bucket setup", "Réglages du bucket"))}</summary>
          <div class="stack" style={{ gap: "10px", marginTop: "8px" }}>
            <p class="hint" style={{ margin: 0 }}>
              {tr(
                l(
                  "1. Paste this CORS configuration in the bucket's settings, so that this site may reach it.",
                  "1. Colle cette configuration CORS dans les réglages du bucket, pour que ce site puisse y accéder.",
                ),
              )}
            </p>
            <Snippet title="CORS" text={corsConfig(location.origin)} />
            <p class="hint" style={{ margin: 0 }}>
              {tr(
                l(
                  "2. Create keys for a user with this policy only: it can read and write this one file, nothing else.",
                  "2. Crée des clés pour un utilisateur avec cette seule politique : il peut lire et écrire ce fichier, rien d'autre.",
                ),
              )}
            </p>
            <Snippet
              title={tr(l("IAM policy", "Politique IAM"))}
              text={iamPolicy(bucket.trim(), key)}
            />
          </div>
        </details>
        <p class="hint" style={{ margin: 0 }}>
          {tr(
            l(
              "The keys stay in this browser, encrypted: only request signatures leave this browser.",
              "Les clés restent dans ce navigateur, chiffrées : seules les signatures des requêtes quittent ce navigateur.",
            ),
          )}
        </p>
        {error && (
          <p class="error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <button type="submit" class="btn" disabled={busy || !ready}>
          <Icon name={busy ? "spinner" : "cloud"} size={17} {...(busy ? { class: "spin" } : {})} />
          {tr(l("Save to S3", "Enregistrer sur S3"))}
        </button>
      </form>
    </details>
  );
}

function Saved({ saved }: { saved: S3Link }) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = endpointHost(saved);

  const run = async (what: "export" | "import") => {
    setBusy(what);
    setError(null);
    try {
      if (what === "export") {
        await exportToS3(saved);
        toast(tr(l("Notebook saved to S3", "Carnet enregistré sur S3")));
      } else {
        const n = await importFromS3(saved);
        toast(
          tr(
            n.places === 1
              ? l("Merged 1 place from S3", "1 lieu fusionné depuis S3")
              : l(`Merged ${n.places} places from S3`, `${n.places} lieux fusionnés depuis S3`),
          ),
        );
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="stack" style={{ gap: "10px" }}>
      <div class="notice">
        <strong>{host ?? "S3"}</strong>
        <p style={{ margin: "4px 0 0" }}>{`${saved.bucket}/${saved.key}`}</p>
      </div>
      {s3TargetKept.value ? null : (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {tr(
            l(
              "This browser's storage for the site is full or blocked: the bucket is remembered for this page only.",
              "Le stockage du navigateur pour ce site est plein ou bloqué : le bucket n'est retenu que pour cette page.",
            ),
          )}
        </p>
      )}
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => void run("export")}
        >
          <Icon
            name={busy === "export" ? "spinner" : "upload"}
            size={17}
            {...(busy === "export" ? { class: "spin" } : {})}
          />
          {tr(l("Export to S3", "Exporter vers S3"))}
        </button>
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => void run("import")}
        >
          <Icon
            name={busy === "import" ? "spinner" : "download"}
            size={17}
            {...(busy === "import" ? { class: "spin" } : {})}
          />
          {tr(l("Import from S3", "Importer depuis S3"))}
        </button>
      </div>
      <button
        type="button"
        class="btn danger"
        disabled={busy !== null}
        onClick={() => {
          void forgetS3Target();
          toast(
            tr(
              l(
                "Bucket forgotten on this device. The file stays in the bucket.",
                "Bucket oublié sur cet appareil. Le fichier reste dans le bucket.",
              ),
            ),
          );
        }}
      >
        {tr(l("Forget this bucket", "Oublier ce bucket"))}
      </button>
    </div>
  );
}
