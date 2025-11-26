// lib/session.ts
import { supabaseAdmin } from "./supabase";

export async function getSession(sessionKey: string) {
  if (!sessionKey) return null;

  const { data, error } = await supabaseAdmin
    .from("chat_sessions")
    .select("*")
    .eq("session_key", sessionKey)
    .maybeSingle();

  if (error) {
    console.error("getSession error:", error);
    return null;
  }

  return data;
}

export async function saveSession(sessionKey: string, state: any) {
  if (!sessionKey) return;

  const { error } = await supabaseAdmin
    .from("chat_sessions")
    .upsert({
      session_key: sessionKey,
      state,
      updated_at: new Date().toISOString(),
    });

  if (error) console.error("saveSession error:", error);
}
