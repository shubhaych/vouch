import { checkFinanceCreaoAgents, FINANCE_AGENT_ENV, FINANCE_AGENT_NAMES } from './creao';

const status = await checkFinanceCreaoAgents();
console.log('Finance CREAO app credentials (app-scoped access cannot list account agents; a live run verifies each pair).');
for (const s of status) console.log(`${FINANCE_AGENT_NAMES[s.seat]}: ${FINANCE_AGENT_ENV[s.seat].appId}=${s.appIdConfigured ? 'set' : 'missing'}; ${FINANCE_AGENT_ENV[s.seat].apiKey}=${s.apiKeyConfigured ? 'set' : 'missing'}; live run=${s.configured ? 'not verified' : 'not configured'}`);
