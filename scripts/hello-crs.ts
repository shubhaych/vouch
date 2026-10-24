// Prints one real CRS identity response for a TEST identity.
// CRS_BASE_URL and the endpoint/auth shape are guesses until the CRS hackpack is open:
// fill in the request below from their docs, then keep this script as the proof the call is Live.
import { loadEnv, need } from "./_env";

loadEnv();
need("CRS_BASE_URL", "CRS_API_KEY");
console.error("hello-crs: implement the identity request from the CRS hackpack (use the provided test identities only), then print the response here.");
process.exit(2);
