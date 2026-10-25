/** Easy to swap when the customer app and live integrations land. */
export const CUSTOMER_APP_URL =
  process.env.NEXT_PUBLIC_CUSTOMER_APP_URL || "";

export const CUSTOMER_APP_LABEL = CUSTOMER_APP_URL
  ? "Open customer app"
  : "Open customer app (URL pending)";

export const DEMO_MERCHANT = {
  name: "Northline Apparel",
  id: "B-019",
} as const;
