export interface NavItem { href: string; label: string }

/** Pitch destinations a judge needs immediately — claim → result → network → simulation. */
export const NAV: NavItem[] = [
  { href: "/network", label: "Network" },
  { href: "/simulation", label: "Simulation" },
];
