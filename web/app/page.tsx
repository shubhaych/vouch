import { Journey } from "@/components/journey";
import { Footer } from "@/components/ui/footer";

export default function Home() {
  return (
    <main className="landing" data-testid="home">
      <Journey />
      <Footer />
    </main>
  );
}
