// Single source of truth for navigation. Add a page: create the folder under
// app/, then add it here.
export interface NavItem { href: string; label: string }

export const NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/atlas", label: "Atlas" },
  { href: "/console", label: "Console" },
  { href: "/shopper", label: "Shopper" },
  { href: "/agents", label: "Agents" },
  { href: "/merchant", label: "Merchant" },
];

export const CONSOLE_TABS: NavItem[] = [
  { href: "/console/cases", label: "Cases" },
  { href: "/console/evidence", label: "Evidence" },
  { href: "/console/books", label: "Books" },
];

export const SHOPPER_TABS: NavItem[] = [
  { href: "/shopper/return", label: "Return" },
  { href: "/shopper/record", label: "My Vouch Record" },
];
