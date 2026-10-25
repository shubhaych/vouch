// The portfolio's claim detector. It sees only what a business could see: does
// the video contradict the claim, is a device/address/media hash shared with
// other claims, did another company's verified fraud use the same hash, and
// the shopper's Vouch score. It never sees who is really fraudulent. Honest and
// fraudulent features overlap on purpose, so recall and false flags are
// measured against the hidden truth, never assumed.

export interface ClaimFeatures { contradicted: boolean; hashReuse: boolean; crossCompany: boolean; score: number; noise: number }

export const FLAG_AT = 0.36;

export function risk(f: ClaimFeatures): number {
  return (f.contradicted ? 0.45 : 0) + (f.hashReuse ? 0.3 : 0) + (f.crossCompany ? 0.35 : 0)
    + (f.score < 450 ? 0.12 : f.score < 520 ? 0.05 : 0) + f.noise * 0.2;
}

export function reasons(f: ClaimFeatures): string[] {
  return [
    ...(f.contradicted ? ['video contradicts the claim'] : []),
    ...(f.hashReuse ? ['shared device, address or media hash'] : []),
    ...(f.crossCompany ? ['hash seen in another company\'s verified fraud'] : []),
    ...(f.score < 450 ? ['low Vouch score'] : []),
  ];
}
