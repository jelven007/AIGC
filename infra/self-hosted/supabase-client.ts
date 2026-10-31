import { createClient as originalClient } from 'npm:@supabase/supabase-js@2.103.1';
import { firstPartyFetch } from '../../supabase/functions/_shared/first-party.ts';
export * from 'npm:@supabase/supabase-js@2.103.1';
export const createClient: typeof originalClient = (url, key, options) =>
  originalClient(url, key, { ...options, global: { ...options?.global, fetch: firstPartyFetch } });
