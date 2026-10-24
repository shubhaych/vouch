// Loads seed/personas.json and seed/claims.json (and photos/) into SpacetimeDB,
// every row with provenance "seeded". Needs generated module_bindings.
import { loadEnv, notWired } from "./_env";

loadEnv();
notWired("seed", "publish the module and run `npm run stdb:generate` first (docs/ARCHITECTURE.md), then implement the loader here with the generated reducers");
