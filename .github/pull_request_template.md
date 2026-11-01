## What and why

Describe the problem and resulting behavior. Include significant tradeoffs when relevant.

## Verification

List relevant commands and results. Summarize manual checks with the behavior, result, and environment. For UI changes, include final screenshots, browser, viewport widths, and affected interactions.

For bug fixes, include regression evidence; for performance changes, include comparable measurements. State any remaining verification limitations.

<!-- Add a Rollout / limitations section only when there are special deployment,
recovery, compatibility, or data considerations. Report production verification
after deployment. Follow AGENTS.md for the full verification requirements. -->

## Before merging

Check only verified items; briefly explain any that do not apply.

- [ ] Scope is focused; task-specific leftovers are removed.
- [ ] Review is complete; no blocking findings remain.
- [ ] Checks and CI pass for the latest revision. Revision and CI link:
- [ ] Owner has verified the changed UI, or no UI changes apply.
- [ ] Documentation and visuals are accurate.
- [ ] Rollout and recovery needs are addressed, or none apply.
- [ ] No secrets or private information are included.
- [ ] Owner approved merging this revision. Approved revision and public link or brief factual confirmation:
