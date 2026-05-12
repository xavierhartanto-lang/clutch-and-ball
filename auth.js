/**
 * Supabase auth helpers (no DOM).
 */
"use strict";

import supabase from "./supabase.js";

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
