/**
 * data-export — gather everything The Cold File has stored on this device
 * for the signed-in user, into a single JSON-serializable payload.
 *
 * Drives the "Download my data" screen (app/data-export.tsx). Reads the same
 * AsyncStorage keys the existing hooks use (use-saved-cases, use-submitted-tips)
 * so the export reflects exactly what the user sees in-app, plus pulls watch
 * zones from the server (the same RPC use-watch-zones consumes).
 *
 * Storage keys are duplicated from the hook files intentionally — keeping the
 * export decoupled from those hooks avoids subscribing to their in-process
 * caches and lets the gather function run as a one-shot. If the storage key
 * version bumps in either hook, bump the matching constant here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabase, isSupabaseConfigured } from './supabase';

const SAVED_CASES_KEY = 'cf:saved_cases:v1';
const SUBMITTED_TIPS_KEY = 'cf:submitted_tips:v1';

export interface ExportedSavedCase {
  caseSlug: string;
  savedAt: string;
}

export interface ExportedSubmittedTip {
  caseSlug: string;
  agencyName: string;
  submittedAt: string;
}

export interface ExportedWatchZone {
  id: string;
  label: string | null;
  geojson: unknown;
  notify_new_cases: boolean;
  notify_updates: boolean;
  notify_arrests: boolean;
  cases_inside: number;
  created_at: string;
}

export interface DataExport {
  exportedAt: string;
  version: '1.0';
  user: { email: string | null };
  savedCases: ExportedSavedCase[];
  submittedTips: ExportedSubmittedTip[];
  watchZones: ExportedWatchZone[];
}

interface SavedCaseStored {
  caseSlug: string;
  savedAt: string;
}

interface SubmittedTipStored {
  caseSlug: string;
  agencyName: string;
  submittedAt: string;
}

async function readSavedCases(): Promise<ExportedSavedCase[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_CASES_KEY);
    if (!raw) return [];
    const store = JSON.parse(raw) as Record<string, SavedCaseStored>;
    return Object.values(store)
      .map((s) => ({ caseSlug: s.caseSlug, savedAt: s.savedAt }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

async function readSubmittedTips(): Promise<ExportedSubmittedTip[]> {
  try {
    const raw = await AsyncStorage.getItem(SUBMITTED_TIPS_KEY);
    if (!raw) return [];
    const store = JSON.parse(raw) as Record<string, SubmittedTipStored>;
    return Object.values(store)
      .map((t) => ({
        caseSlug: t.caseSlug,
        agencyName: t.agencyName,
        submittedAt: t.submittedAt,
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch {
    return [];
  }
}

async function readWatchZones(): Promise<ExportedWatchZone[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) return [];
    const { data, error } = await supabase.rpc('list_my_watch_zones');
    if (error || !data) return [];
    return (data as ExportedWatchZone[]).map((z) => ({
      id: z.id,
      label: z.label,
      geojson: z.geojson,
      notify_new_cases: z.notify_new_cases,
      notify_updates: z.notify_updates,
      notify_arrests: z.notify_arrests,
      cases_inside: z.cases_inside,
      created_at: z.created_at,
    }));
  } catch {
    return [];
  }
}

async function readUserEmail(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Pulls every device-local + server-side artifact this user has accumulated
 * and packages it as a JSON-serializable payload. The reads run in parallel
 * because they're independent (AsyncStorage + Supabase RPC + auth session).
 */
export async function gatherUserData(): Promise<DataExport> {
  const [savedCases, submittedTips, watchZones, email] = await Promise.all([
    readSavedCases(),
    readSubmittedTips(),
    readWatchZones(),
    readUserEmail(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    user: { email },
    savedCases,
    submittedTips,
    watchZones,
  };
}
