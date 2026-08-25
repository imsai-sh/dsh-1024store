## Change

Summarize the user-visible or operational effect of this change.

## API compatibility

Changes that touch API routes, projections, parameters, defaults, status/error codes, headers,
pagination, ordering, authentication or shared API code complete this section. Others leave it
unchecked.

- [ ] This change has no API behavior impact, or its API impact is described above
- [ ] Every added or changed API route is registered in `web/contracts/api-surface.json`
- [ ] Existing-version behavior remains backward compatible and historical contract fixtures were not casually rewritten
- [ ] Any breaking behavior uses a new versioned route while the previous version remains available
- [ ] `npm run test:api-contract` passes

## Verification

List the commands you ran (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:visual` for responsive changes) and their results.
