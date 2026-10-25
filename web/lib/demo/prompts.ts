/**
 * Incoming agent-written refund prompts for the hero wheel.
 * Replace `fetchPromptCards` when live Spacetime simulation rows are available.
 */

export interface PromptCard {
  id: string;
  agentId: string;
  merchant: string;
  orderNumber: string;
  timeLabel: string;
  amountCents: number;
  prompt: string;
  /** When set, clicking opens this fixture claim in the merchant demo. */
  demoClaimId?: string;
  provenance: "simulated" | "live";
}

const MERCHANTS = [
  "Northline Apparel",
  "Harbor Audio",
  "Field & Home",
  "Parcel Goods",
  "Lumen Supply",
  "Cedar Outfitters",
];

const PROMPTS: { prompt: string; amountCents: number; demoClaimId?: string }[] = [
  {
    prompt: "The item delivered is blue and small. The order says black and medium. Request a refund.",
    amountCents: 2800,
    demoClaimId: "CLM-1042",
  },
  {
    prompt: "The package arrived empty. Open a claim for order 4819.",
    amountCents: 6400,
  },
  {
    prompt: "One headphone does not power on. Request a return.",
    amountCents: 12900,
  },
  {
    prompt: "Seam damage is hard to show on camera. Please review and advise.",
    amountCents: 3400,
    demoClaimId: "CLM-1048",
  },
  {
    prompt: "I wore the trail runners a few times. I no longer need them. Request a refund.",
    amountCents: 12800,
    demoClaimId: "CLM-1051",
  },
  {
    prompt: "Wrong color raincoat for a child. Ordered yellow size 6; received navy size 4.",
    amountCents: 4200,
  },
  {
    prompt: "The zipper separates on the first wear. Request exchange or refund.",
    amountCents: 8900,
  },
  {
    prompt: "Box shows crush damage. Inner carton is torn. Open a shipping claim.",
    amountCents: 5600,
  },
  {
    prompt: "Size chart said medium. Garment fits like an extra small. Request return.",
    amountCents: 4500,
  },
  {
    prompt: "Two of three mugs arrived cracked. Request refund for the damaged units.",
    amountCents: 3600,
  },
  {
    prompt: "Tracking says delivered. No package at the door. Open a never-received claim.",
    amountCents: 7200,
  },
  {
    prompt: "The description listed wool. The label reads acrylic. Request a refund.",
    amountCents: 9800,
  },
  {
    prompt: "Left shoe is a size 9; right shoe is a size 10. Request replacement.",
    amountCents: 15400,
  },
  {
    prompt: "Battery drains within an hour. Device is two days old. Request return.",
    amountCents: 19900,
  },
  {
    prompt: "Print is off-center and faded. Request reprint or refund.",
    amountCents: 3200,
  },
  {
    prompt: "Order included a belt. The belt is missing from the shipment.",
    amountCents: 2800,
  },
  {
    prompt: "Fabric pills after one wash despite care instructions. Request refund.",
    amountCents: 6700,
  },
  {
    prompt: "The scent does not match the listed notes. Request a return.",
    amountCents: 5400,
  },
  {
    prompt: "Chair arrived with a scratched leg. Request partial refund or replacement.",
    amountCents: 24900,
  },
  {
    prompt: "Filter set is incompatible with the model listed on the order.",
    amountCents: 4100,
  },
  {
    prompt: "Stitching along the cuff has opened. Request repair credit or refund.",
    amountCents: 7800,
  },
  {
    prompt: "Gift message was omitted. Customer requests a prepaid return label.",
    amountCents: 5200,
  },
  {
    prompt: "Lens coating shows haze under light. Request warranty return.",
    amountCents: 18900,
  },
  {
    prompt: "Quantity ordered: 2. Quantity received: 1. Request the missing unit or refund.",
    amountCents: 4400,
  },
  {
    prompt: "The hedge trimmer will not start. Fuel and spark checked. Request return.",
    amountCents: 15900,
  },
  {
    prompt: "Mattress topper smells strongly of chemicals. Request pickup return.",
    amountCents: 12900,
  },
  {
    prompt: "Book spine is cracked on arrival. Request replacement copy.",
    amountCents: 2200,
  },
  {
    prompt: "The sauce jars leaked in transit. Request refund for the spoiled set.",
    amountCents: 3100,
  },
  {
    prompt: "Smart plug drops offline every night. Request RMA.",
    amountCents: 3900,
  },
  {
    prompt: "Hem length is uneven by nearly two inches. Request alteration credit or refund.",
    amountCents: 11200,
  },
  {
    prompt: "The outdoor light fogged after first rain. Request replacement.",
    amountCents: 8700,
  },
  {
    prompt: "Keyboard keycaps arrived with cracked stems. Request parts or refund.",
    amountCents: 14900,
  },
  {
    prompt: "Pet bed cover zipper fails. Request a cover replacement.",
    amountCents: 4800,
  },
  {
    prompt: "Cycling jersey has a hole near the pocket. Request refund.",
    amountCents: 9100,
  },
  {
    prompt: "The blender jar does not seat on the base. Request exchange.",
    amountCents: 7900,
  },
  {
    prompt: "Socks arrived as three left feet. Request a corrected pair.",
    amountCents: 1800,
  },
];

function padOrder(n: number): string {
  return String(4000 + n).padStart(4, "0");
}

function timeLabel(i: number): string {
  const m = (i * 3) % 60;
  const h = 9 + ((i * 2) % 8);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Seeded simulation prompts — clearly labeled, replaceable via fetchPromptCards. */
export function seededPromptCards(count = 34): PromptCard[] {
  const out: PromptCard[] = [];
  for (let i = 0; i < count; i++) {
    const src = PROMPTS[i % PROMPTS.length]!;
    out.push({
      id: `PR-${String(i + 1).padStart(3, "0")}`,
      agentId: `A-${String(1000 + ((i * 37) % 9000)).padStart(4, "0")}`,
      merchant: MERCHANTS[i % MERCHANTS.length]!,
      orderNumber: padOrder(800 + i * 17),
      timeLabel: timeLabel(i),
      amountCents: src.amountCents,
      prompt: src.prompt,
      demoClaimId: src.demoClaimId,
      provenance: "simulated",
    });
  }
  return out;
}

/**
 * Data adapter: return the 34 most recent incoming prompts.
 * Swap the body for a SpacetimeDB subscription when live rows exist.
 */
export async function fetchPromptCards(): Promise<PromptCard[]> {
  return seededPromptCards(34);
}

export function formatPromptAmount(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
