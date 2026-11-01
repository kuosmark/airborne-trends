# Architecture

[Back to overview](../README.md)

## Scope

The frontend separates polling and page layout (`app`) from leaderboard interactions (`ranking-board`), search/status (`ranking-toolbar`), operator metadata (`operator-details`), shared type breakdowns (`aircraft-group-details`) and aircraft selection (`aircraft-map`). Each component has separate TypeScript, HTML and scoped CSS files. Global styles contain document defaults, shared design tokens and the screen-reader utility.

The local backend uses Node's built-in HTTP server and fetch API, holding the latest ranking in memory and persisting operator details and lookup cost controls in an untracked JSON cache. In AWS, Lambda persists these in S3. CDK defines the infrastructure in `infra/`; an AWS-native pipeline deploys application changes from `main`.

The browser and scheduled-state reader share `shared/snapshot-validation.ts`. A successful HTTP response with malformed ranking data is rejected before rendering; the browser keeps its last valid snapshot and retries normally. Optional metadata and positions may be absent in older snapshots. New snapshots also carry `airborneCount` and `unassignedAircraft` (count, type breakdown and positions); operator counts plus the unassigned count must equal the airborne total. Both new fields may be absent in older snapshots, whose complete airborne total is not displayed.

`backend/skylink.ts` validates and deduplicates observations before grouping aircraft by operator. `backend/adsbdb.ts` handles operator-detail requests and response parsing; `backend/operator-directory.ts` owns caching, pacing and lookup limits. `backend/operator-cache.ts` validates and migrates stored operator details; `backend/refresh-state.ts` does the same for scheduled snapshot state and request history. `backend/scheduled-refresh.ts` keeps request reservation, fetching and publication in one workflow.

Aircraft are deduplicated by ICAO24, keeping the newest observation (ground wins equal-time conflicts). We count only explicitly airborne aircraft observed within five minutes of the snapshot. Operator assignment requires three letters followed by one to four letters or digits, and a callsign different from the aircraft registration after removing spaces and hyphens. Aircraft without such a callsign remain in the unassigned group. Missing or invalid coordinates omit only the map position, not the aircraft count. Malformed, incomplete, or outdated global snapshots are rejected.

Every qualifying prefix is counted, including cargo and regional operators. All qualifying operators are ranked by count, with prefix order breaking ties. Separate prefixes are not combined under a brand. The format check is a heuristic, not proof of operator identity. These are observed counts, dependent on SkyLink coverage, not worldwide fleet totals.

## Scheduled Lambda handler

`backend/lambda.ts` runs one refresh per invocation and publishes both `api/ranking-v2` and `api/ranking` in a private website bucket. The browser reads the compact v2 format through CloudFront; the original format supports older clients and provides a fallback when v2 is unavailable. Both represent the same snapshot, without a separate HTTP backend. The browser derives staleness from the original snapshot timestamp (15 minutes plus 30 seconds), so a stopped job still produces a delay notice.

The CDK stack packages the handler and defines its permissions and schedule. All Regional resources use the selected AWS Region, `eu-north-1`.

The handler requires:

| Setting | Purpose |
| --- | --- |
| `STATE_BUCKET` | Private bucket containing operator cache and refresh state |
| `WEBSITE_BUCKET` | Private bucket receiving the published ranking |
| `SKYLINK_KEY_PARAMETER` | SSM SecureString parameter name containing the API key |
| `IS_HISTORY_ENABLED` | Set to `true` by CDK to collect counts; absent or other values leave collection disabled |

The scheduler must supply `scheduledAt` as its original scheduled UTC timestamp, run every 15 minutes, and use a single concurrent Lambda invocation. Events older than 15 minutes are rejected. A persistent slot reservation is written before fetching SkyLink; duplicate deliveries or restarts in that slot cannot repeat the paid snapshot call. Failed attempts wait until the next slot. A retry can republish the saved ranking without another provider request, preserving its operator details if the directory cache is unavailable.

Before enabling the schedule, initialize `refresh-state.json` with `{"lastAttemptSlot":null,"snapshot":null,"snapshotAttempts":[]}` only for a new poller, and preserve the existing `operator-names.json` cache. Its provider migration runs automatically on first load, preserving paid lookup history while discarding old labels. Missing, unreadable or invalid cloud state blocks polling rather than silently resetting these controls. State writes require the S3 version just read; a conflicting writer stops without making its reserved provider call.

The latest snapshot and its rank changes survive restarts. The ranking is published before lookups and again after enrichment. Lookups stop when execution time is running low and continue on a later scheduled refresh; the existing TTL, rolling cap and failure cooldown still apply. SDK retries are disabled, and provider requests retain their timeouts (15 seconds for snapshots, ten seconds for directory lookups). A failed publication leaves the last published object available; a later invocation can recover it from saved state.

Lambda errors identify a fixed failure stage: configuration, API key retrieval, operator cache loading, snapshot fetching, ranking publication, or the remaining refresh processing. An allowlisted category distinguishes timeouts, access denials and conflicting writes; other errors use “unknown”. Raw error messages, provider responses and credentials are not included.

Use one active poller per API key. Stop the local backend when enabling the cloud schedule: local and S3 budgets are separate and cannot enforce an account-wide cap. Do not delete or replace cloud state as a refresh mechanism. Confirm AWS spending protection before deployment; application request controls do not cap AWS charges.

## Counts-only history collection

Production also archives aggregate counts in the private state bucket. The local backend does not collect history. Production publishes compact daily files for the historical charts described below. There are no additional provider requests.

`backend/history.ts` explicitly selects the historical fields; it never copies entire snapshot objects. Each record contains schema version 1, counting version 1, the SHA-256 fingerprint of the bundled Mictronics references, source `observedAt`, the original `scheduledSlot` (UTC epoch divided into 15-minute intervals), total airborne count, operator/type IDs, names and counts, and the two unknown counts. Names and classifications reflect collection time. Counting version must change when assignment/counting rules change; the reference fingerprint follows both infrastructure and code-only releases. These records cannot reconstruct or reclassify individual aircraft observations.

Complete count dimensions are required, even though legacy live snapshots may omit them. Counts must be nonnegative safe integers, IDs unique and valid, and operator counts plus unknown operators and type counts plus unknown types must each equal the total. The unknown groups overlap and are not summed together. Coordinates, aircraft identifiers, callsigns, individual observations, reported descriptions and nested breakdowns are excluded. Empty complete snapshots are allowed; failed refreshes are gaps, not zero observations.

`backend/history-storage.ts` writes gzip JSON using a source-timestamp key:

```text
history/counts/v1/YYYY-MM-DD/<observedAt>.json.gz
```

Conditional creation preserves the first record for an observation. An existing-object response is success; conflicts, timeouts and other errors remain failures. Source time controls the archive path and future time buckets. The original scheduled slot describes collection coverage, not observation time. Repeated source timestamps and duplicate deliveries do not become new observations; legacy saved snapshots are not backfilled.

The workflow persists a counts-only `pendingHistory` record together with the new snapshot before attempting archival. Each invocation first retries any pending record, without fetching SkyLink. Successful archival clears the pending record through the existing conditional state store. Fresh records are archived separately from the two live publication steps, before initial publication. An archive request is bounded to five seconds and failure does not skip live publication or metadata enrichment. The invocation reports a failure after those steps so the existing Lambda alarm covers archival failures too.

Recovery is deliberately bounded to one pending record. If its next recovery attempt fails and a new valid observation arrives, a fixed `Counts history dropped` log marks the gap before the newer pending record replaces it. A prolonged outage can therefore lose historical samples while live updates continue. Invalid new count projections are reported without archiving them. Existing state validation and paid-request reservation protections remain intact. A process failure between provider retrieval and state persistence can still lose that observation; history is not guaranteed delivery.

Counts archives have no automatic expiration and remain until explicitly deleted. The versioned state bucket retains superseded object versions for its existing seven-day lifecycle interval; current archive objects are unaffected. CloudFront has no access to these archives, and the refresh role can only create objects under the history prefix, not list, read or delete them.

## Historical chart delivery

An independent hourly `backend/history-builder.ts` Lambda reads the latest 31 UTC dates from the counts archive and writes gzip JSON to `api/history/v1/YYYY-MM-DD.json` in the existing website bucket. Each file stores observation times once, totals, and aligned count arrays keyed by operator or aircraft type. It excludes repeated names and all individual-aircraft data. The source archive remains private and retains its original metadata.

The builder validates source records, downloads at most eight concurrently, and uses a hash of object keys and ETags to skip unchanged days. It publishes `api/history/v1/index.json` only after all days succeed. Failed jobs leave the previous index available and the next hourly run retries; an individual daily object may already have been updated. Daily files and the index have a five-minute cache lifetime. These replaceable files can be rebuilt from the archives; older daily files are not removed, but the index advertises only the recent 31 dates.

CloudFront serves these files directly. The browser loads history only when a chart is opened, validates the response, and selects a rolling 24-hour, seven-day or 30-day window without refetching when switching periods. A missing group within a complete observation counts as zero observed aircraft; a missing observation is a gap. Lines break across intervals longer than 22.5 minutes. Exact local times with UTC offsets and counts are available in an expandable table. Monthly/yearly summaries are not generated by this implementation.

```mermaid
flowchart LR
  Q[15-minute schedule] --> R[Refresh Lambda]
  R --> A[Private S3 counts archive]
  R --> W[Website S3: live ranking]
  H[Hourly schedule] --> B[History builder Lambda]
  A --> B
  B --> J[Website S3: daily history JSON]
  W --> C[CloudFront]
  J --> C
  C --> U[Browser: live rankings and history charts]
```

The history builder has read access only to the counts prefix and read/write access only to the published history prefix. It cannot fetch provider data, modify operational state or delete archives. Its errors use a separate alarm on the existing alert topic. Both schedules follow the explicit polling-enabled setting; history failures do not block live refreshes.


## Operator cache and request limits

`.cache/operator-names.json` is excluded from Git. AWS uses the same structure in the private `operator-names.json` state object:

```json
{
  "source": "adsbdb",
  "names": {
    "FIN": { "name": "Finnair", "country": "Finland", "countryIso": "FI", "iata": "AY", "icao": "FIN", "checkedAt": "2026-10-07T12:00:00.000Z" }
  },
  "attempts": [1791374400000],
  "cooldownUntil": 0
}
```

The source marker separates ADSBDB metadata and its budget from the old SkyLink cache. On first load of a valid legacy cache, migration discards its labels and archives its paid `attempts` and `cooldownUntil` under `legacySkylink`. The new ADSBDB cache starts empty and the migration is persisted before provider requests. It happens once and retains the original state file and conditional S3 write protections; no additional storage resource is needed. Failed migrations disable requests. Do not delete state files to refresh metadata or reset quotas.

Existing ADSBDB cache entries without `countryIso` remain valid and are eligible for a one-time refresh during scheduled directory enrichment. The existing per-refresh and rolling request limits still apply. Entries with unavailable ISO codes retain their normal expiry interval.

`checkedAt` uses ISO timestamps; `attempts` and `cooldownUntil` use Unix milliseconds. Constants in `backend/operator-directory.ts` enforce:

| ADSBDB control | Value |
| --- | --- |
| Known record refresh | 30 days |
| Missing or ambiguous record refresh | 7 days |
| Cooldown after a failed lookup | 24 hours |
| Maximum lookup attempts | 5,000 per rolling 32 days |
| Maximum attempts per refresh | 100 |
| Minimum spacing between requests | 1 second |

These are application guardrails, not purchased allowances. ADSBDB's [published rate limits](https://www.adsbdb.com/) currently block clients at 512+ requests within 60 seconds for 60 seconds, and at 1,024+ for 300 seconds. Its implementation limits by IP. Our sequential, paced lookups stay below these thresholds, but shared outgoing IPs or provider policy changes can still cause throttling.

Expiry is checked only during snapshot refreshes for operators in the current snapshot. Every attempt is persisted before contacting ADSBDB, with a provisional cooldown to prevent immediate retries after crashes. Successful responses clear the cooldown. HTTP 404, empty results and ambiguous names are completed negative lookups; malformed responses, HTTP 429, server errors and timeouts stop the batch and retain previous ADSBDB data. Missing optional fields do not shorten a known record's TTL. No immediate retries or paid fallback occur. Lookup pacing survives restarts; the Lambda deadline can stop a batch before the batch limit, and remaining prefixes are checked on subsequent scheduled refreshes. Operators without cached details remain visible as prefixes while bounded batches populate their details over subsequent refreshes. Reads and searches never trigger provider calls.

Local writes replace the cache via a temporary file and rename. Unreadable or invalid caches and failed writes disable lookups. The local cache requires a single backend process; sharing it between concurrent local processes is unsupported. Lambda uses conditional S3 writes to reject conflicting updates. Cached provider output remains outside the public repository.

### Snapshot request limits

SkyLink is used only for airborne snapshots. A single continuously running poller needs 2,976 requests in 31 days (3,072 in 32 days). Production reserves each 15-minute slot before fetching, with no automatic request retries, and persists a separate maximum of **3,100 snapshot attempts per rolling 32 days** in `refresh-state.json`. Failed requests consume their reservation. Reaching the cap stops paid snapshot fetches until attempts expire; the last published snapshot remains available and becomes stale. Storage failures prevent unreserved requests.

Older scheduled state records only the last attempted slot. Migration conservatively seeds snapshot history as if every slot in the preceding 32-day window through that slot was attempted, rather than granting a fresh budget. New installations with a null last slot start with empty history. Redeployments retain this history. Historical SkyLink directory attempts remain archived separately and still count toward provider billing during the transition. These guards apply to this production poller, **not the entire SkyLink subscription**: local backend startup and polling, manual tests, other instances and external usage are additional. SkyLink's [direct-subscription terms](https://skylinkapi.com/terms/) permit billed overage; monitor usage and any provider-side spending controls.
