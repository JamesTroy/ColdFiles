/**
 * Diagnostics — collect + format the runtime/build envelope shared between
 * the Diagnostics screen ("Copy diagnostics") and the Help/Contact mailto:
 * prefill.
 *
 * Only depends on libs that ship in the runtime: expo-constants, expo-updates,
 * react-native (Platform), and Intl. Anything that is unavailable (Updates
 * fields are null in dev / Expo Go) renders as "—" instead of throwing —
 * the diagnostics block is a copy/paste artefact, not a strongly-typed API.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export interface DiagnosticItem {
  label: string;
  value: string;
}

const DASH = '—';

function safeString(v: unknown): string {
  if (v === null || v === undefined || v === '') return DASH;
  return String(v);
}

function safeIntl(picker: (opts: Intl.ResolvedDateTimeFormatOptions) => string | undefined): string {
  try {
    const opts = new Intl.DateTimeFormat().resolvedOptions();
    return safeString(picker(opts));
  } catch {
    return DASH;
  }
}

/** Pull a runtimeVersion off expoConfig — it can be a string OR an object policy. */
function resolveRuntimeVersion(): string {
  // expo-updates resolves runtimeVersion at runtime — prefer that when set.
  const baked = Updates.runtimeVersion;
  if (baked) return baked;
  const rv = Constants.expoConfig?.runtimeVersion;
  if (typeof rv === 'string') return rv;
  if (rv && typeof rv === 'object') return JSON.stringify(rv);
  return DASH;
}

/**
 * Resolve update group ID. expo-updates SDK 29 doesn't export this as a
 * top-level constant on every build, but it's exposed on the manifest
 * metadata when running an EAS Update. Read defensively so dev / Expo Go
 * (no manifest) renders DASH instead of throwing.
 */
function resolveUpdateGroupId(): string {
  const mod = Updates as unknown as { updateGroupId?: string | null; manifest?: unknown };
  if (typeof mod.updateGroupId === 'string' && mod.updateGroupId.length > 0) {
    return mod.updateGroupId;
  }
  const manifest = mod.manifest as { metadata?: { updateGroup?: string } } | undefined;
  const fromMetadata = manifest?.metadata?.updateGroup;
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) return fromMetadata;
  return DASH;
}

export function collectDiagnostics(): DiagnosticItem[] {
  return [
    { label: 'App version', value: safeString(Constants.expoConfig?.version) },
    { label: 'Runtime version', value: resolveRuntimeVersion() },
    { label: 'Update channel', value: safeString(Updates.channel) },
    { label: 'Update group ID', value: resolveUpdateGroupId() },
    { label: 'Update ID', value: safeString(Updates.updateId) },
    { label: 'Platform', value: safeString(Platform.OS) },
    { label: 'OS version', value: safeString(Platform.Version) },
    { label: 'Locale', value: safeIntl((o) => o.locale) },
    { label: 'Timezone', value: safeIntl((o) => o.timeZone) },
  ];
}

/** Plaintext multi-line block — one `label: value` per line. */
export function assembleDiagnosticsText(items: DiagnosticItem[] = collectDiagnostics()): string {
  return items.map((i) => `${i.label}: ${i.value}`).join('\n');
}
