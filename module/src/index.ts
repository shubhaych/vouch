// SpacetimeDB reads reducers, views and procedures from this entry file's
// exports, and refuses anything else (a helper function exported here breaks
// publishing). So re-export by name: add a reducer in its area's file, then
// add its name below.
import { spacetimedb } from './schema';

export default spacetimedb;
export { init, seedWorld, tick } from './economy';
export {
  bootstrapWorker, bootstrapPoster, setSeatCodes, takeBusinessSeat, switchBusiness, setControl, setSim, ping,
} from './control';
export { joinAsShopper, buy, fastForward, requestRefund, showcaseAct } from './consumer';
export { attachVideo, setClaimStatus, recordRun, runStep, finishRun, recordEvidence, openInvestigation } from './claims';
export { propose, decide, post } from './desk';
export { flagPattern, setPatternStatus, confirmPattern } from './patterns';
export { setIssuerKey, issueCredential, revokeCredential, requestVerification, recordVerification } from './credentials';
export { enqueueLab, enqueueLabTrigger, startLabJob, appendLabEvent, finishLabJob, reviewCandidate, markPromoted } from './lab';
export { my_agent } from './views';
export { exportTruth } from './truth';
