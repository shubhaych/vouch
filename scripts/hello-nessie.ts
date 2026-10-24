// Prints one real response from the Nessie (Capital One) sandbox: lists customers.
// Endpoint is from Nessie's public API; confirm against the hackpack.
import { loadEnv, need } from "./_env";

loadEnv();
need("NESSIE_API_KEY");
const res = await fetch(`http://api.nessieisreal.com/customers?key=${process.env.NESSIE_API_KEY}`);
console.log(res.status, (await res.text()).slice(0, 800));
process.exit(res.ok ? 0 : 1);
