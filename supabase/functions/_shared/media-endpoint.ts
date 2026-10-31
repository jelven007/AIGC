import { validateEndpoint } from './model-registry.ts';
import { firstPartyFetch, isFirstParty, validateFirstParty } from './first-party.ts';
export async function validateMediaEndpoint(value: string): Promise<string> {
  return isFirstParty(value) ? (await validateFirstParty(value, true)).href : validateEndpoint(value);
}
export const mediaFetch = firstPartyFetch;
