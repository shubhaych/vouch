// Prints one real response from a saved CREAO agent: starts a run, polls it.
// Usage: npm run hello:creao [seat]   (default: credit_analyst)
import { loadEnv, need } from "./_env";

loadEnv();
const seat = (process.argv[2] ?? "credit_analyst").toUpperCase();
need(`CREAO_${seat}_APP_ID`, `CREAO_${seat}_KEY`);

const base = process.env.CREAO_API_BASE ?? "https://agent.creao.ai/api/v1/apps";
const appId = process.env[`CREAO_${seat}_APP_ID`]!;
const headers = { Authorization: `Bearer ${process.env[`CREAO_${seat}_KEY`]}`, "Content-Type": "application/json" };

const start = await fetch(`${base}/${appId}/runs`, { method: "POST", headers, body: JSON.stringify({ inputs: { hello: "vouch" } }) });
const startText = await start.text();
console.log("start:", start.status, startText);
if (!start.ok) process.exit(1);
const { id } = JSON.parse(startText) as { id: string };

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 5_000));
  const res = await fetch(`${base}/${appId}/runs/${id}`, { headers });
  const body = (await res.json()) as { status: string };
  console.log(`poll ${i}:`, body.status);
  if (["completed", "failed", "cancelled"].includes(body.status)) { console.log(JSON.stringify(body, null, 2)); process.exit(body.status === "completed" ? 0 : 1); }
}
console.error("timed out waiting for the run");
process.exit(1);
