// Puts the demo back to its start: clears claims, runs, decisions and journal,
// re-seeds, and sets creao_enabled back on. Needs generated module_bindings.
import { loadEnv, notWired } from "./_env";

loadEnv();
notWired("demo:reset", "needs module_bindings and a controller identity (docs/ARCHITECTURE.md)");
