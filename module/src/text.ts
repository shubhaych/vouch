// Claim text for simulated refunds, and the similarity measure the
// coordinated-claim detector uses. Honest claims come from a wide pool with
// item details; ring claims come from one template per ring with synonyms
// swapped, so they are similar but not identical.
import type { Rng } from './rng';
import type { CatalogItem } from './world';

export const REASONS = ['defective', 'wrong_size', 'not_as_described', 'damaged_in_shipping', 'missing_parts', 'changed_mind'] as const;
export type ReasonCode = (typeof REASONS)[number];

const HONEST: Record<ReasonCode, string[]> = {
  defective: [
    'The {part} stopped working on day {n}. I have only used it a handful of times.',
    'Out of the box the {part} was faulty, it never worked properly.',
    'After {n} days the {part} began failing intermittently, sometimes it works and sometimes not.',
    'My {item} has a fault with the {part}; I tried resetting it and following the manual.',
    'The {part} on my {item} broke during normal use in the first week.',
    'There is a manufacturing defect on the {part}, see the video I recorded.',
  ],
  wrong_size: [
    'I ordered my usual size but this runs about one size small.',
    'The fit is much larger than the size chart says, I need to exchange it.',
    'Sizing is off compared to the listing, it does not fit at all.',
    'Too tight across the shoulders even though I followed the guide.',
  ],
  not_as_described: [
    'The colour is quite different from the photos on the listing.',
    'The listing said {detail} but what arrived does not match that.',
    'Material feels nothing like the description, it looks cheaper in person.',
    'The {part} is not the one shown in the product photos.',
  ],
  damaged_in_shipping: [
    'The box arrived crushed and the {part} was dented inside.',
    'Package was soaked and the {item} inside is scratched.',
    'Courier dropped it, the {part} has a crack from the impact in transit.',
  ],
  missing_parts: [
    'The {part} was missing from the box.',
    'Arrived without the {part}, everything else was there.',
    'Only part of the set came, the {part} is not included.',
  ],
  changed_mind: [
    'I no longer need it, it is unused and in the original packaging.',
    'Bought it as a gift and they already had one.',
    'Found I do not use it, would like to return it unopened.',
  ],
};

// Ring templates: a base sentence with slots, each slot a synonym set.
const RING_TEMPLATES: string[][][] = [
  [['The'], ['{item}'], ['stopped working', 'quit working', 'died'], ['after'], ['two', '2'], ['days,'], ['the'], ['{part}'], ['is'], ['cracked', 'broken', 'split'], ['and it'], ['will not', "won't"], ['turn on', 'power on', 'charge'], ['anymore.']],
  [['Received'], ['the'], ['{item}'], ['and the'], ['{part}'], ['was'], ['defective', 'faulty'], ['right away,', 'immediately,'], ['it'], ['does not', "doesn't"], ['work', 'function'], ['at all.', 'whatsoever.'], ['Please refund.', 'Requesting a refund.']],
  [['My'], ['{item}'], ['is'], ['defective', 'faulty', 'broken'], ['-'], ['the'], ['{part}'], ['fails', 'malfunctions'], ['every time', 'constantly'], ['I use it.', 'I try to use it.'], ['Not', 'Definitely not'], ['as advertised.']],
];

const fill = (s: string, item: CatalogItem, rng: Rng) =>
  s
    .replaceAll('{item}', item.name.toLowerCase())
    .replaceAll('{part}', rng.pick(item.parts))
    .replaceAll('{n}', String(rng.int(2, 12)))
    .replaceAll('{detail}', item.description.split(' with ')[0]!.toLowerCase());

export function honestClaimText(reason: ReasonCode, item: CatalogItem, rng: Rng): string {
  return fill(rng.pick(HONEST[reason]), item, rng);
}

/** One template per ring, members swap synonyms. The part is fixed per ring burst. */
export function ringClaimText(ringId: number, item: CatalogItem, part: string, rng: Rng): string {
  const tpl = RING_TEMPLATES[ringId % RING_TEMPLATES.length]!;
  return tpl
    .map((choices) => rng.pick(choices))
    .join(' ')
    .replaceAll('{item}', item.name.toLowerCase())
    .replaceAll('{part}', part)
    .replace(/ ,/g, ',');
}

/** A false "defective" claim from an opportunist or serial returner: plausible, short, generic. */
export function falseDefectText(item: CatalogItem, rng: Rng): string {
  return fill(rng.pick(HONEST.defective), item, rng);
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
