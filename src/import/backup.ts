/**
 * The JSON backup of the whole notebook: a small envelope (app, format version, export date)
 * around the Doc. Reading a backup also accepts a bare Doc, and always goes through
 * normalizeDoc, since the file may have been edited by hand or come from elsewhere.
 */

import { normalizeDoc } from "../store/merge";
import type { Doc } from "../store/model";

export interface Backup {
  app: "spots";
  version: 1;
  /** ISO 8601 date of the export. */
  exportedAt: string;
  doc: Doc;
}

/** The backup file content for a doc, as pretty-printed JSON. */
export function exportBackup(doc: Doc, now: number): string {
  const backup: Backup = { app: "spots", version: 1, exportedAt: new Date(now).toISOString(), doc };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** The doc in a backup file (or in a bare Doc JSON); null when the text is neither. */
export function parseBackup(text: string): Doc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (raw !== null && typeof raw === "object" && "app" in raw) {
    const envelope = raw as Record<string, unknown>;
    if (envelope.app !== "spots" || envelope.version !== 1) return null;
    return normalizeDoc(envelope.doc);
  }
  return normalizeDoc(raw);
}
