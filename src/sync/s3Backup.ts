/**
 * The JSON backup kept in an S3 bucket, on demand: "export" writes the whole
 * notebook to one object, "import" merges that object back in (the newer edit
 * of every record wins). Nothing runs in the background. The bucket, the key and
 * the access keys are remembered on this device, the secret key encrypted.
 */
import { signal } from "@preact/signals";
import { secureStorage } from "llm-connect";
import { exportBackup, parseBackup } from "../import/backup";
import { alive } from "../store/model";
import { doc, mergeIn } from "../store/store";
import type { ImportCounts } from "./repoBackup";
import {
  cleanTarget,
  getObject,
  putObject,
  type S3Credentials,
  S3Error,
  type S3Target,
} from "./s3";

export type S3Link = S3Target & S3Credentials;

type Prefs = Partial<Omit<S3Link, "secretAccessKey">>;

/**
 * The secret key encrypted at rest (AES-GCM under a non-extractable key in IndexedDB),
 * the rest beside it: every page of maxgfr.github.io can read this origin's storage.
 */
const vault = secureStorage<Prefs>({ prefsKey: "spots:s3", dbName: "spots-s3" });

/** The remembered bucket; undefined until it is loaded. */
export const s3Target = signal<S3Link | null | undefined>(undefined);
/** False when the last bucket could not be stored: it lasts until the page is closed. */
export const s3TargetKept = signal(true);

/** Loads the remembered bucket once, into `s3Target`. */
export async function loadS3Target(): Promise<S3Link | null> {
  if (s3Target.value !== undefined) return s3Target.value;
  const saved = await vault.loadDraft?.().catch(() => null);
  const { endpoint, region, bucket, key, pathStyle, accessKeyId } = saved ?? {};
  const found: S3Link | null =
    saved?.apiKey && region && bucket && key && accessKeyId
      ? {
          endpoint: String(endpoint ?? ""),
          region,
          bucket,
          key,
          pathStyle: pathStyle === true,
          accessKeyId,
          secretAccessKey: saved.apiKey,
        }
      : null;
  // A save made while loading wins.
  if (s3Target.value === undefined) s3Target.value = found;
  return s3Target.value ?? null;
}

/** Remembers the bucket; false when the browser kept it for this page only. */
export async function saveS3Target(l: S3Link): Promise<boolean> {
  const { secretAccessKey, ...prefs } = l;
  const kept = await vault
    .save({ apiKey: secretAccessKey, model: "", ...prefs }, { rememberKey: true })
    .catch(() => false);
  s3Target.value = l;
  s3TargetKept.value = kept !== false;
  return s3TargetKept.value;
}

/** Forgets the bucket and its keys on this device. The object stays in the bucket. */
export async function forgetS3Target(): Promise<void> {
  s3Target.value = null;
  s3TargetKept.value = true;
  await vault.clear().catch(() => {});
}

function notABackup(): S3Error {
  return new S3Error("not-a-backup", "The object is not a spots backup");
}

/**
 * Writes the notebook as the backup object and resolves to its new ETag. An object
 * already there must be a spots backup: anything else is left alone.
 */
export async function exportToS3(l: S3Link): Promise<string> {
  const current = await getObject(l, l);
  if (current?.content.trim() && !parseBackup(current.content)) throw notABackup();
  return putObject(l, l, exportBackup(doc.value, Date.now()));
}

/** Merges the backup object into the notebook; resolves to what the object holds. */
export async function importFromS3(l: S3Link): Promise<ImportCounts> {
  const file = await getObject(l, l);
  if (!file) throw new S3Error("not-found", "The object is not in the bucket");
  const backup = parseBackup(file.content);
  if (!backup) throw notABackup();
  mergeIn(backup);
  return {
    places: alive(backup.places).length,
    lists: alive(backup.lists).length,
    tags: alive(backup.tags).length,
  };
}

/**
 * Checks the keys and the bucket by reading the object, then remembers them. The
 * notebook is exported only when the object is not there yet: a backup made from
 * another device is left for the user to import (or export over). Resolves to whether
 * it exported.
 */
export async function setUpS3(
  target: S3Target,
  credentials: S3Credentials,
): Promise<{ link: S3Link; exported: boolean }> {
  const accessKeyId = credentials.accessKeyId.trim();
  const secretAccessKey = credentials.secretAccessKey.trim();
  if (!accessKeyId || !secretAccessKey) throw new S3Error("auth", "Both keys are needed");
  const l: S3Link = { ...cleanTarget(target), accessKeyId, secretAccessKey };
  const file = await getObject(l, l);
  if (file?.content.trim() && !parseBackup(file.content)) throw notABackup();
  const exported = !file?.content.trim();
  if (exported) await putObject(l, l, exportBackup(doc.value, Date.now()));
  await saveS3Target(l);
  return { link: l, exported };
}
