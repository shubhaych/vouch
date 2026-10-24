# seed/

Demo data loaded by `npm run seed`. Everything loaded from here is badged **Seeded** in the UI.

- `personas.json`: customers and shopping agents (hashed ids, a CRS test identity reference, order history summary).
- `claims.json`: the claims the demo script files.
- `photos/`: real phone photos: an intact garment, a damaged one, a packing photo. Keep each at 400 KB or less.

The two JSON files start empty. The 12 scenarios in `module/src/policy.test.ts` are a good first set of claims.
