// Claim text for simulated refunds, and the similarity measure the
// coordinated-claim detector uses. Real people write differently, so honest
// claims are composed from independent fragments with item details; a ring
// shares one script and swaps a word or two, so its claims are similar but
// not identical. That difference is what the detector has to find.
import type { Rng } from './rng';
import type { CatalogItem } from './world';

export const REASONS = ['defective', 'wrong_size', 'not_as_described', 'damaged_in_shipping', 'missing_parts', 'changed_mind'] as const;
export type ReasonCode = (typeof REASONS)[number];

const OPENINGS = ['', '', 'Hi,', 'Hello.', 'Not happy with this one.', 'Bit disappointed, to be honest.', 'Hoping you can help.', 'Quick one about my order.', 'Writing about a recent purchase.', 'Hey there.'];

const SYMPTOMS: Record<ReasonCode, string[]> = {
  defective: [
    'the {part} stopped working on day {n}',
    'out of the box the {part} was faulty and never worked properly',
    'after {n} days the {part} started failing on and off',
    'my {item} has a fault with the {part} even after a reset',
    'the {part} broke during normal use in the first week',
    'there is a manufacturing defect on the {part}',
    'the {part} makes a grinding noise and then cuts out',
    'the {part} gets hot and the {item} switches itself off',
    'I noticed the {part} was loose after {n} uses',
  ],
  wrong_size: [
    'it runs about one size small compared to the chart',
    'the fit is much larger than the size guide says',
    'sizing is off compared to the listing and it does not fit',
    'it is too tight across the shoulders even though I followed the guide',
    'the length is a good {n} cm shorter than listed',
  ],
  not_as_described: [
    'the colour is quite different from the photos',
    'the listing said {detail} but what arrived does not match that',
    'the material feels nothing like the description',
    'the {part} is not the one shown in the product photos',
    'it is noticeably smaller than it looks in the listing',
  ],
  damaged_in_shipping: [
    'the box arrived crushed and the {part} was dented inside',
    'the package was soaked and the {item} inside is scratched',
    'the courier must have dropped it because the {part} has a crack',
    'the outer carton was torn open and the {part} is bent',
  ],
  missing_parts: [
    'the {part} was missing from the box',
    'it arrived without the {part}, everything else was there',
    'only part of the set came and the {part} is not included',
  ],
  changed_mind: [
    'I no longer need it and it is unused in the original packaging',
    'I bought it as a gift and they already had one',
    'I found I do not use it and would like to return it unopened',
  ],
};

const CONTEXT = ['', '', '', 'I followed the instructions carefully.', 'It was a birthday present.', 'I have only used it a couple of times.', 'I tried a different outlet and cable.',
  'My partner noticed it first.', 'I have bought from you before without issues.', 'Photos are in the video.', 'It was packed well, so I do not think it was the courier.', 'I kept all the packaging.'];

const REQUESTS = ['', 'Can I get a refund?', 'Please advise.', 'I would like my money back.', 'Happy to send more photos.', 'An exchange is fine too.', 'Please refund to my card.', 'Thanks for sorting this.'];

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const fill = (s: string, item: CatalogItem, rng: Rng) =>
  s
    .replaceAll('{item}', item.name.toLowerCase())
    .replaceAll('{part}', rng.pick(item.parts))
    .replaceAll('{n}', String(rng.int(2, 12)))
    .replaceAll('{detail}', item.description.split(' with ')[0]!.toLowerCase());

/** An individual's claim: four independent fragments, so two honest claims rarely read alike. */
export function honestClaimText(reason: ReasonCode, item: CatalogItem, rng: Rng): string {
  const parts = [rng.pick(OPENINGS), `${cap(fill(rng.pick(SYMPTOMS[reason]), item, rng))}.`, rng.pick(CONTEXT), rng.pick(REQUESTS)];
  return parts.filter(Boolean).join(' ');
}

/** A false "defective" claim from an opportunist or serial returner: written by one person, so it reads like any other claim. */
export function falseDefectText(item: CatalogItem, rng: Rng): string {
  return honestClaimText('defective', item, rng);
}

// Ring scripts: one long message per ring, with a few words swapped per member.
const RING_SCRIPTS: string[][][] = [
  [['Hello,', 'Hi,'], ['I received my order on time but the'], ['{part}'], ['was'], ['cracked', 'broken'], ['when I opened the box and the device will not power on at all.'],
    ['Please process a full refund to my original payment method'], ['as soon as possible.', 'quickly.']],
  [['Item arrived defective.'], ['The'], ['{part}'], ['does not work', 'is not working'], ['and I have tried charging it overnight and resetting it twice with no change.'],
    ['I want a refund, not a replacement,', 'I want a full refund, not a replacement,'], ['thank you.']],
  [['Unfortunately the product is faulty.'], ['The'], ['{part}'], ['stopped responding', 'stopped working'], ['on the first day and the unit keeps restarting by itself every few minutes.'],
    ['Requesting a refund to my card', 'Please refund to my card'], ['today.', 'please.']],
  [['Very disappointed with this purchase.'], ['Out of the box the'], ['{part}'], ['was damaged', 'was dead'], ['and the device makes a clicking sound when switched on.'],
    ['I would like my money returned in full', 'I need my money returned in full'], ['right away.']],
];

/** One script per ring; the part is fixed per burst; members swap a word or two. Item names are left out, as a script would. */
export function ringClaimText(ringId: number, _item: CatalogItem, part: string, rng: Rng): string {
  const script = RING_SCRIPTS[ringId % RING_SCRIPTS.length]!;
  return script.map((choices) => rng.pick(choices)).join(' ').replaceAll('{part}', part);
}

/** Character trigram Jaccard similarity, the coordinated detector's text signal. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}
