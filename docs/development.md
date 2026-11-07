# Development

[Back to overview](../README.md)

## Run locally

Requires Node.js 22.13+ (22.x) or 24.x. Reference updates and their tests require the `unzip` and `zip` command-line utilities (available on macOS and the Ubuntu GitHub Actions runner). Backend release packaging and its regression test still require Python 3. GitHub Actions uses Node.js 22.

```sh
npm ci
```

Create an untracked `.env` file in the project root:

```dotenv
SKYLINK_API_KEY=your-api-key
```

The local backend makes an immediate provider request on startup and polls every 15 minutes. Use one active poller per API key; stop the cloud schedule before starting a local backend with the same key.

Start the backend and frontend in separate terminals:

```sh
npm run backend
```

```sh
npm start
```

Open http://127.0.0.1:4200. Both services listen on loopback only. Angular proxies `/api/*` to the backend on port 3000; the API key stays on the backend.

## Checks

Run `npm run check` before committing. GitHub Actions runs the same command plus the browser regression on pull requests and pushes to `main`.

| Command | Purpose |
| --- | --- |
| `npm run check` | Run linting, backend/script/infra type checking, tests, the production build, and strict CDK synthesis |
| `npm run lint` | Check strict TypeScript rules, Angular conventions, and template accessibility |
| `npm run lint:fix` | Apply automatic lint fixes |
| `npm run typecheck:scripts` | Type-check reference updater scripts |
| `npm run typecheck:backend` | Type-check the backend and shared ranking types |
| `npm test` | Test ranking, caching, provider cost controls, HTTP behavior, scheduled refreshes, infrastructure and release safeguards |
| `npm run test:browser` | Run ranking, history and responsive interaction checks in Chromium at 320px, 390px and desktop widths |
| `npm run build` | Build the frontend into `dist/airborne-trends/browser` |
| `npm run typecheck:infra` | Type-check the CDK application |
| `npm run infra:synth` | Bundle Lambda and validate the generated CloudFormation template without AWS lookups |
| `npm run infra:diff` | Compare the stack with deployed resources |
| `npm run infra:deploy` | Deploy the stack after reviewing its diff |
| `npm run infra:publish -- cdk.out/outputs.json` | Upload the frontend and wait for CloudFront cache invalidation |
| `npm run infra:release -- BUCKET DISTRIBUTION FUNCTION_ARN [HISTORY_FUNCTION_ARN]` | Update the existing Lambda code and publish the frontend; requires Python 3 for ZIP packaging |

The browser regression uses Playwright and synthetic API responses; it starts its own frontend on port 4317 without a backend or provider requests. Install Chromium once with `npx playwright install chromium` (on Linux CI, use `--with-deps`), then run `npm run test:browser`. Close anything using port 4317 first. Browser checks run separately from `npm run check`, so the deployment build does not need a browser installation.

Other tests use Node's built-in test runner and synthetic data. They do not require an API key or contact either provider. Lint warnings fail the check. TypeScript rules prohibit unnecessary `else` branches after returns and shadowed names, and limit nesting to four levels. Drawer layout, responsive spacing and animations are checked manually in the browser; the unit tests do not verify their appearance.

## Map implementation

The map uses a bundled Natural Earth 1:110m land outline, projected with `d3-geo` using Natural Earth I. Keep the bundled path in `src/world-outline.ts`, SVG viewBox and projection constants in `src/aircraft-map-projection.ts` aligned. Pointer selection uses the nearest dot within 12 screen pixels; the hover highlight and tooltip must use the same target.

## History development

The local provider backend does not collect or serve history. Without published history files, charts show the unavailable state while live rankings continue. To develop against existing data without provider requests, serve a saved ranking and generated history JSON from a local static preview, or point the Angular proxy at an existing deployment. Keep downloaded archives and preview data untracked. Use synthetic records for automated tests; do not change timestamps on real observations to make them appear current.

History tests cover projection, missing samples, zero counts, malformed data, unchanged-day caching, partial publication failure and recovery. A multi-day integration test follows saved counts through publication, HTTP loading and chart points, including paginated archive listings and delayed sample recovery. Browser checks should include all four periods, total and group charts, exact-value tables, empty/error states and narrow layouts. Verify that a slow or unavailable yearly file does not block recent charts, and that delay warnings use the selected dataset’s update time.
