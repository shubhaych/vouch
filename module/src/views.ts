import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';

// Per-user rows go through views that read ctx.sender, so the identity to
// agent link (private shopper_link) never leaves the database.

const myAgentRow = t.row('MyAgentRow', {
  agentId: t.u32().primaryKey(),
  name: t.string(),
});

/** The live agent behind the calling identity, if it joined as a shopper. */
export const my_agent = spacetimedb.view({ name: 'my_agent', public: true }, t.array(myAgentRow), (ctx) => {
  const link = ctx.db.shopperLink.who.find(ctx.sender);
  return link ? [{ agentId: link.agentId, name: link.name }] : [];
});
