import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabaseUrl = "https://esktjpklhtjfomraehgt.supabase.co";
export const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVza3RqcGtsaHRqZm9tcmFlaGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDUxNTQsImV4cCI6MjA4ODU4MTE1NH0.RDMAXa15CQcTBDxewcX5yd76C3iG6aW0o6csGckJAx4";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof localStorage !== "undefined" ? localStorage : undefined,
  },
});

export default supabase;

/** Base URL for Supabase Edge Functions (e.g. delete-account). */
export function edgeFunctionUrl(name) {
  const base = String(supabaseUrl || "").replace(/\/$/, "");
  return `${base}/functions/v1/${encodeURIComponent(name)}`;
}