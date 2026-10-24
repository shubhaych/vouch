// Single source of truth for navigation. Add a page: create its folder under app/, then add it here.
export interface NavItem { href: string; label: string }

export const NAV: NavItem[] = [
  { href: "/world", label: "World" },
  { href: "/shop", label: "Shop" },
  { href: "/business", label: "Business" },
  { href: "/lab", label: "Lab" },
  { href: "/system", label: "System" },
];
