import { checkFinanceCreaoAgents, FINANCE_AGENT_NAMES } from './creao';

const status = await checkFinanceCreaoAgents();
console.log(`Finance CREAO check · account key: ${process.env.CREAO_API_KEY?.trim() ? 'set' : 'missing'}`);
for (const s of status) console.log(`${FINANCE_AGENT_NAMES[s.seat]}: ${s.env}=${s.configured ? 'set' : 'missing'}; found=${s.checked ? (s.found ? 'yes' : 'no') : 'not checked'}; name matches=${s.checked ? (s.nameMatches ? 'yes' : 'no') : 'not checked'}`);
if (!process.env.CREAO_API_KEY?.trim()) console.log('Set CREAO_API_KEY in the worker .env to verify saved agent IDs against GET /v1/agents.');
