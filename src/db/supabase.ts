import { createClient } from "@supabase/supabase-js";
import { backendUrl, backendAnonKey } from '@/lib/backendConfig';

export const supabase = createClient(backendUrl, backendAnonKey);
