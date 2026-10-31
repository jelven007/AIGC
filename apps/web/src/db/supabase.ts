import { createClient } from "@supabase/supabase-js";
import { backendUrl, backendAnonKey } from '@/lib/backendConfig';
import { privateMediaFetch, clearMediaCache } from '@/lib/privateMedia';

export const supabase = createClient(backendUrl, backendAnonKey, { global: { fetch: privateMediaFetch } });
supabase.auth.onAuthStateChange(() => clearMediaCache());
