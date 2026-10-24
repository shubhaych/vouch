import { PageHeader } from "@/components/page-header";
import { TabLinks } from "@/components/nav-links";
import { SHOPPER_TABS } from "@/lib/routes";

export default function ShopperLayout({ children }: LayoutProps<"/shopper">) {
  return (
    <>
      <PageHeader title="Shopper" lede="File a return, see your lane and how to move up. Unverified is never denied: you are asked to verify." />
      <TabLinks items={SHOPPER_TABS} />
      {children}
    </>
  );
}
