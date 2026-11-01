# Project guideline

Keep this project small and simple. Add only what is absolutely necessary for the current agreed task.

- Prefer the simplest implementation that meets the agreed requirements. Reuse existing code where appropriate; add features, dependencies, abstractions, infrastructure, documentation, or tooling only for a concrete current need.
- Prioritize readability over brevity. Use clear names and intermediate variables when they make logic easier to follow; avoid dense expressions and unnecessary verbosity.
- Prefer small, clearly named functions with shallow control flow and a clear responsibility.
- Give Angular components one clear UI responsibility. Keep substantial templates in separate HTML files and component-specific styles in their own CSS files; reserve global CSS for document defaults and shared utilities.
- Format CSS with one declaration per line and keep related responsive rules with their component styles.
- Extract components when they clarify ownership; avoid arbitrary file-length limits or components for every small element.
- Keep changes focused; avoid unrelated refactoring and duplicate logic.
- Name project-owned boolean variables, parameters, and properties with an `is` prefix and a descriptive condition, such as `isAirborne` or `isStale`. Preserve names required by external APIs and libraries.
- Keep explanations and plans concise and concrete.
- Keep public documentation, comments, commit messages, and pull requests factual and focused on the software.
- Include only the security measures and verification necessary for the current work.

## Project reference

- `src/`: Angular interface; `shared/`: shared types and logic; `backend/`: provider integration and refresh processing; `infra/`: AWS infrastructure and release scripts; `scripts/`: maintenance tools; `tests/`: automated checks.
- Local frontend: `npm start`. See [Development](docs/development.md) for setup and backend instructions. Starting the backend contacts the provider immediately; follow the documented single-poller controls.
- Required checks: `npm run check`; test suite: `npm test`. Tests use synthetic data and do not contact providers.
- Consult [Architecture](docs/architecture.md) for service boundaries, [Ranking](docs/ranking.md) for application behavior, and [Deployment](docs/deployment.md) for deployment, recovery, and releases.

## Development workflow

- Agree on scope, expected behavior, and observable acceptance criteria before substantial implementation. Handle routine implementation decisions independently within that scope.
- Inspect relevant code and documentation before editing. Preserve unrelated and uncommitted work; remove obsolete prototypes, unused assets, and temporary instrumentation introduced by the task.
- Before fixing a bug, reproduce the reported behavior and identify its cause. If reproduction is blocked, state the limitation rather than treating a suspected cause as confirmed. For performance issues, compare representative small and large datasets in the affected browser or runtime and record before/after measurements.
- For bug fixes, add or adjust a behavior-focused regression test that fails before the fix and passes afterward where practical; otherwise record how the fix was verified.
- Lint suppressions, TypeScript suppression comments, and skipped tests need a short, specific reason and the narrowest practical scope.
- Keep `main` working. Make all changes through pull requests from short-lived `codex/<description>` branches, including documentation fixes. Never push directly to `main`.
- Ask the repository owner for explicit approval before opening a pull request. Approval to implement a change does not authorize opening a PR.
- The monthly Mictronics update workflow may open or update reference-data PRs automatically. These still require owner approval to merge.
- Make focused commits with concise, imperative messages describing the change.
- Before committing, run `npm run check` and review the diff. Check UI changes in the browser at 320px, a typical mobile width, and a desktop width. Verify text wrapping, horizontal overflow, spacing, and relevant loading, empty, and error states. For affected controls, check keyboard navigation, focus, accessible names, and applicable selected/expanded states.
- Never commit `.env`, API keys, private information, or generated build files.
- Use `.github/pull_request_template.md` to describe the change, verification, review outcome, and rollout. Include a clear final screenshot for visible changes and obtain owner inspection of the actual UI before merging.
- Update relevant existing documentation when setup, commands, or behavior change, including screenshots and diagrams made inaccurate by the change. Document significant decisions and their rationale when they are not apparent from code or existing documentation; prefer updating an existing document.
- Use visuals when they clarify the interface, architecture, or data flow. Capture sharp screenshots with readable text, consistent framing and representative data; exclude private information, browser clutter, clipped content, prototype labels and accidental focus indicators. Add descriptive alt text and useful captions. Inspect the rendered Markdown and images at their intended display size before committing.
- For meaningful code changes, delegate a review of the proposed commit to a separate agent with fresh context. Provide the requirements, base and head commits, and repository instructions. The reviewer must not edit files. Small documentation-only changes may use self-review.
- Verify review findings, resolve blocking issues, and rerun affected checks after fixes. Request another review of significant code changes made after review.
- Before merging, confirm CI passes for the latest revision and present verification and review results to the owner. Record the revision, CI evidence, and owner approval in the PR. Link a public approval/comment or record a brief factual confirmation identifying the approved revision; do not publish private chat content or links.
- Before merging, update the PR description so every checklist item is verified and checked. Resolve pending items before proceeding; never check an item merely to complete the checklist. If an item is not applicable, state why and mark it checked. After merging, verify the saved checklist is complete before moving on.
- When reviewing substantial new functionality, suggest a milestone release to the repository owner. Create a release only after explicit owner approval and successful deployment verification; do not suggest a release for every PR.
- Merge a pull request only after the repository owner explicitly approves merging the current revision. Approval to implement work or open a PR is not merge approval. New commits require renewed merge approval; do not ask again for authorization already given for the same action and revision.
- Squash-merge with a descriptive title, delete the feature branch, and update local `main` afterward.
- For owner-approved releases, follow the release procedure in `docs/deployment.md`: tag the exact verified deployed commit, publish concise GitHub release notes, and never move a published tag.

## Code review

- Compare the complete diff against the agreed requirements and inspect relevant surrounding code.
- Trace important behavior from input to output, including boundary conditions, external input validation, and failure handling.
- Check that the code is easy to follow, and suggest simpler expressions or clearer names where they help.
- Check that each new dependency, abstraction, configuration option, and file serves a current requirement. Flag concrete duplication or unnecessary complexity, and suggest the smallest sufficient alternative.
- Check that tests verify observable behavior and meaningful failure cases. During refactors, preserve behavior and explain test changes in terms of changed requirements or public interfaces. Flag unjustified changes that weaken tests, linting, or CI.
- Report actionable findings with file locations, impact, and supporting evidence or a reproducible scenario. Distinguish blocking issues from optional suggestions; avoid speculative requirements and stylistic preferences already handled by tooling.
- Record the review outcome and any remaining limitations. For UI changes, verify that responsive browser checks cover the affected behavior. Passing tests or an agent review alone does not establish correctness.

## AWS deployment

- Use `eu-north-1` for Regional resources. Do not introduce cross-Region resources or Lambda@Edge; CloudFront remains global.
- Confirm the monthly project spend limit in AWS Settings before infrastructure deployment. Do not change the account plan or activate advanced features without explicit owner approval.
- Use the relevant AWS skill for infrastructure work and review resource and IAM changes before deployment.
- Preserve the restricted deployment roles, polling controls and provider quota history. Follow the deployment and retirement procedures in `docs/deployment.md`.
- After merging, follow the automatic-deployment waiting and verification procedure in `docs/deployment.md` before considering a manual start. Verify the exact deployed revision; report implementation, CI, merge, and production verification as distinct stages. Production verification happens after deployment, not in the pre-merge checklist.
