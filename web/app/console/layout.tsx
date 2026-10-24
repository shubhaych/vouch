import { PageHeader } from "@/components/page-header";
import { TabLinks } from "@/components/nav-links";
import { CONSOLE_TABS } from "@/lib/routes";

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <>
      <PageHeader title="The Desk" lede="Cases, evidence and books for the refunds team. Agents propose; a person decides; only the poster writes." />
      <TabLinks items={CONSOLE_TABS} />
      {children}
    </>
  );
}
