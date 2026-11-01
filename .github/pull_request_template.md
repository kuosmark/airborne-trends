## What and why

Describe the problem and resulting behavior.

## Verification

List commands and results. For manual checks, describe the behavior tested, the observed result, and the relevant environment. For UI changes, include screenshots, the browser and viewport widths, and the interactions checked; verify responsive layout and relevant loading, empty, and error states. For affected controls, check keyboard navigation, focus, accessible names, and applicable selected/expanded states.

For documentation visuals, inspect the rendered Markdown, readable text, framing and alt text. Explain whether existing screenshots or diagrams needed updating.

For bug fixes, describe the reproduction and regression test, or how the fix was verified if an automated test was impractical. For performance changes, include comparable before/after measurements and the dataset sizes used.

## Review

Summarize the review approach, findings, resolutions, and any remaining limitations.

For refactors, explain how existing behavior was verified and why any tests needed to change. Review component responsibilities and template/style ownership.

## Rollout

Describe infrastructure, compatibility, or data changes and recovery steps where relevant; otherwise state why no special rollout is needed. Report production verification after deployment, not in the pre-merge checklist.

## Before merging

Check each item only after verification. Explain any item that does not apply before marking it checked; leave no unresolved items at merge time.

- [ ] Changes match the agreed scope, with no obsolete prototypes, unused additions, or temporary debugging code introduced by this change.
- [ ] Review is complete and blocking findings are resolved.
- [ ] Relevant checks and CI pass for the latest revision. Revision and CI evidence:
- [ ] For UI/UX changes, the repository owner has inspected the actual UI and verified that it looks and behaves correctly in this revision, or no UI/UX changes are included.
- [ ] Documentation, screenshots and diagrams are accurate and updated where needed, or no update is needed.
- [ ] Rollout and recovery implications are addressed, or explicitly not applicable.
- [ ] No secrets or private information are included.
- [ ] The repository owner has approved merging this revision. Public approval/comment link or factual confirmation of owner approval for this revision (no private chat content or links):
