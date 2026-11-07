# Deployment and operations

[Back to overview](../README.md)

## AWS infrastructure

`infra/stack.ts` defines one stack: two private S3 buckets, CloudFront with Origin Access Control, an ARM64 Node.js 22 Lambda, a 15-minute EventBridge Scheduler schedule, and an email alarm for Lambda errors. The frontend and ranking endpoints share one CloudFront origin; browser traffic does not invoke Lambda or SkyLink. No API Gateway, VPC or NAT gateway is required. Stack helpers separate hosting, state storage, refresh scheduling and alerts while creating resources under the original stack scope and construct IDs.

Airborne Trends uses the original `AirlineRanking` stack names and `/airline-ranking/` parameter path. The public address is `https://airlines.markuskuosmanen.com`. The stack creates an A alias pointing to the existing distribution in the supplied public hosted zone; it does not create another zone or register the domain. It uses a separately issued, non-exportable ACM certificate in `us-east-1`, as required for global CloudFront HTTPS. Application resources stay in Stockholm. The original CloudFront address remains available as `WebsiteUrl`; `CustomDomainUrl` supplies the custom address.

Before deploying, finish domain registration and verify any registrant email AWS requests. Add the certificate's DNS validation CNAME to the domain's hosted zone and wait for ACM to show **Issued**. Keep that CNAME for managed renewal. Supply `CertificateArn` and `HostedZoneId` during the first domain deployment; subsequent deployments reuse the existing parameter values. Domain registration, certificate and zone are managed separately from the application stack.

Polling is **disabled by default**. Lambda has one reserved concurrent execution, a two-minute timeout and no automatic retries; Scheduler retries are also disabled. Logs expire after seven days. The state bucket retains current operational state and seven days of superseded versions. Current counts-history objects have no automatic expiration and remain until explicitly deleted. Both buckets survive stack removal, and termination protection is enabled. Retained resources continue to incur storage charges; review them explicitly when retiring the application. Version history is for recovery, not for resetting the lookup budget.

The browser uses `/api/ranking-v2`, which stores each aircraft position once and references it from both rankings. The client validates and expands these references into shared position objects. `/api/ranking` retains the original format for older browser tabs; the new client falls back to it if the compact endpoint is not published yet. Both versions come from the same refresh, with no additional provider requests. The refresh role requires write permission for both objects. Older deployments that only allow `api/ranking` need an application-stack update before a code-only release.

CloudFront honors each object's cache headers, with a 30-second default and no minimum TTL. The ranking expires after 30 seconds; missing objects return an error instead of the Angular page. Only `/` is an application route. The refresh alarm emails when all three evaluated 15-minute periods contain a Lambda execution error. Missing data is treated as non-breaching, and recovery does not send an email. The alarm does not cover every possible scheduling or delivery failure; also check snapshot freshness after enabling polling.

Refresh failures log the processing stage and a safe error category. SkyLink failures distinguish HTTP status, invalid JSON, invalid timestamps or aircraft identifiers, incomplete snapshots, and snapshots outside the accepted time window. Unrecognized errors remain `unknown`; provider payloads, credentials, and original exception details are not logged.

The refresh Lambda uses 512 MB of memory. Its aircraft reference is packaged as
`data/mictronics-aircraft.json`, separately from the JavaScript bundle, and loaded
once per execution environment. Local backend commands load the same file from
`backend/data` and must run from the repository root. The reference stays on the
backend; browsers receive only the resulting snapshot. Code-only releases require the deployed Lambda to have 512 MB. If an older deployment uses a different allocation, update the application stack first.

### Enabling counts history

Counts collection requires a reviewed application-stack infrastructure deployment: it adds conditional `s3:PutObject` permission only for `history/counts/v1/*` and `IS_HISTORY_ENABLED=true`. No new bucket, database, endpoint or provider subscription is added. The normal code-only pipeline does not change these settings; until the infrastructure is updated, an absent flag keeps collection disabled and live refreshes continue. Review the diff and confirm the spend limit using the procedure below before deploying infrastructure.

Existing refresh state migrates in place with `pendingHistory: null`; do not initialize or replace existing state, and do not reset quota histories. After enabling, wait for a normal scheduled refresh rather than invoking Lambda. Verify a counts-only gzip object in `StateBucket` under `history/counts/v1/`, its source timestamp and scheduled slot, reconciled totals, and a cleared pending record in refresh state. Archives must not be reachable through CloudFront. Collection does not backfill earlier observations.

Archive validation/write failures emit fixed `Counts history invalid` or `Counts history failed` messages; replacement of an unrecovered sample emits `Counts history dropped`. The invocation fails after completing live publication, so three failing periods use the existing email alarm. Check both live freshness and archival progress: a successful live snapshot alone does not prove archival success. One pending record is retried before the next snapshot; longer storage failures can leave gaps. No provider retry is added. Disabling collection preserves any pending record for later recovery; an old code rollback can discard the new pending field, so inspect state before a rollback.

### Enabling history charts

This feature requires both application and deployment-stack updates. From the approved revision, run the checks and review both diffs using the infrastructure procedure below. Deploy `AirlineRanking` first, preserving the existing explicit polling setting, then `AirlineRankingDeployment`. The first stack adds a 512 MB history builder, an hourly schedule, prefix-scoped S3 permissions and an error alarm using the existing alert topic. The second adds the history function to code-only release permissions and commands. No new bucket or database is created.

The release command accepts an optional fourth argument, the `HistoryFunction` output ARN. Older pipeline commands with three arguments remain compatible during this rollout, but do not update the history builder. After both stack updates, subsequent automatic releases update both functions before publishing the frontend.

Wait for a scheduled history build, then verify `/api/history/v1/index.json` and one advertised daily file through CloudFront, including gzip decoding, valid counts and source times. Open total and group charts and check the exact observations. Verify the archive is still private. A successful application release does not verify the next history build; until its first success, charts display an unavailable state. No provider call is needed for verification.

Daily files retain original series and add hourly/daily summaries. `api/history/v1/year.json` contains up to 365 UTC daily summaries; the builder refreshes the recent 31 dates and retains older summaries. Missing yearly output is rebuilt from retained archive date prefixes. Corrections older than 31 dates require an approved removal of the derived yearly object to trigger that rebuild; private archives must remain untouched. A summary format change also changes the builder cache version. Deploy the builder before relying on the year UI; until yearly output exists the year view reports unavailable. Older clients ignore the added fields, and recent chart views can summarize older daily files locally.

If a history build fails, inspect its CloudWatch logs and permissions. The previous index remains available and the next hourly run retries automatically. Corrected source objects change the source hash and rebuild their date. To rebuild an unchanged daily file after a transformation change, remove only that derived website object through an approved maintenance action; never remove the private archive or reset refresh state. Check the prepared timestamp as well as the latest observation time: successful publication does not prove fresh collection.

### First deployment

Local synthesis and tests need no AWS credentials and make no provider calls. Before deploying:

1. Confirm the selected Region (`eu-north-1`), account configuration and monthly project spend limit in AWS Settings. Check what the configured limit covers and what happens when it is reached; budget notifications alone are not a spending cap. Account for domain registration and renewal separately. Do not change the plan or activate advanced features as part of deployment.
2. Confirm the Lambda concurrency quota permits reserving one execution while maintaining AWS's required unreserved capacity. Do not remove the concurrency limit to work around a quota error.
3. Authenticate the named `personal` AWS profile. Bootstrap CDK in this project and Region if necessary, then synthesize and review the diff:

   ```sh
   npx cdk bootstrap aws://PROJECT_ACCOUNT_ID/eu-north-1 --profile personal
   npm run infra:synth
   npm run infra:diff -- AirlineRanking --profile personal
   npm run infra:deploy -- AirlineRanking --profile personal --parameters AlertEmail=YOUR_EMAIL --parameters CertificateArn=YOUR_CERTIFICATE_ARN --parameters HostedZoneId=YOUR_ZONE_ID --outputs-file cdk.out/outputs.json
   ```

   Replace the placeholders locally; keep credentials and deployment outputs out of Git. Review resource and IAM changes before approving deployment. Confirm the SNS subscription email to receive refresh failure alerts. This first deployment leaves polling disabled.
4. Create the standard-tier SSM **SecureString** `/airline-ranking/skylink-api-key` in Stockholm, using the default AWS-managed SSM key. Enter the API key directly in the AWS console. The stack references this parameter without storing its value in CloudFormation or the frontend.
5. Stop the local backend. Upload its existing `.cache/operator-names.json` to `operator-names.json` in the stack's private `StateBucket`, preserving `attempts` and `cooldownUntil`. Initialize `refresh-state.json` there with `{"lastAttemptSlot":null,"snapshot":null,"snapshotAttempts":[]}` only on the first deployment. Never overwrite existing cloud state during a redeployment.
6. Build and publish the frontend using the stack outputs:

   ```sh
   npm run build
   AWS_PROFILE=personal npm run infra:publish -- cdk.out/outputs.json
   ```

   Publishing uploads assets before `index.html`, requires revalidation for HTML and unhashed files, and gives hashed JavaScript/CSS a one-year cache lifetime. It waits for CloudFront invalidation to complete. Only the current build's HTML, JavaScript and CSS files are accepted; unexpected directories, files or symlinks stop publication before AWS requests. The script never reads or writes backend state or `api/ranking`, and does not delete previous frontend assets. Old hashed files remain available to visitors with an older page; review them when retiring the site. If an upload fails before HTML is published, the existing page remains available. A later invalidation failure can leave some visitors seeing cached files until expiry; rerun publishing to retry.
7. Once state, key, plan and spend-limit verification and frontend are ready, review and deploy with `-c isPollingEnabled=true`:

   ```sh
   npm run infra:diff -- AirlineRanking --profile personal -c isPollingEnabled=true
   npm run infra:deploy -- AirlineRanking --profile personal -c isPollingEnabled=true --parameters AlertEmail=YOUR_EMAIL
   ```

   Keep this context value explicit on subsequent deployments; omitting it disables polling. To pause polling, deploy with `-c isPollingEnabled=false`. Pausing does not stop CloudFront or storage charges. Keep the local backend stopped while the cloud poller is active.
8. Open the output `CustomDomainUrl` and verify a fresh ranking after the next scheduled invocation. `WebsiteUrl` provides the original CloudFront address. Check the Lambda logs and confirm the state objects advance without losing quota history. An empty site before the first successful refresh is expected.

### Automatic deployment from main

GitHub Actions checks pull requests and `main` using `npm run check`. `infra/deployment-stack.ts` defines a separate `AirlineRankingDeployment` stack: CodePipeline V2 fetches `main` through CodeConnections and runs one CodeBuild job. The job installs dependencies, runs the checks, releases application code, and runs `npm run infra:verify`. Verification fetches the public homepage and `/api/ranking-v2`, requires the HTML to match the uploaded build, and validates the compact ranking using the same validator as the frontend. Requests have a 15-second timeout, including response-body reads. A failed check fails the build and pipeline; it does not roll back the deployed code. Snapshot freshness is reported in the build log; a delayed but valid snapshot does not fail deployment because refresh failures have their own alarm. Verification never invokes Lambda or calls SkyLink, and does not verify browser rendering or the next scheduled refresh. Separate helpers define the build, pipeline and restricted release/source permissions. Executions queue, with one build at a time and a 30-minute build timeout. Code releases do not verify the account plan or spend limit. Confirm account configuration and the spend limit separately in AWS Settings before infrastructure changes.

`infra/release.ts` bundles the backend with esbuild and creates a ZIP using Python 3's standard library, included in the CodeBuild image. It verifies the existing Lambda's Node.js 22 runtime, ARM64 architecture and handler, updates code with an optimistic revision guard, waits for completion, and verifies the deployed package hash before publishing the frontend. It never invokes Lambda or calls SkyLink. A failure stops the release; backend and frontend updates are sequential, not an atomic transaction. If frontend publication fails, the updated backend remains deployed.

Create a GitHub CodeConnections connection in Stockholm. Install AWS Connector for GitHub with access to **only this repository**, then select that installation in the connection's **App Installation** field. Authorizing the app as a GitHub user is a separate step and does not replace repository installation. Connections created through an API remain pending until setup is completed in the console. See [AWS's GitHub connection setup](https://docs.aws.amazon.com/codepipeline/latest/userguide/connections-github.html). No GitHub personal access token or permanent AWS key is needed.

After the application stack exists and the release code has been merged into `main`, review and deploy the pipeline:

```sh
npm run infra:diff -- AirlineRankingDeployment --exclusively --profile personal
npm run infra:deploy -- AirlineRankingDeployment --exclusively --profile personal --parameters ConnectionArn=YOUR_CONNECTION_ARN --parameters AlertEmail=YOUR_EMAIL
```

The deployment stack also subscribes the supplied email address to a separate SNS topic. Confirm its subscription email after deployment. An EventBridge rule sends notifications only when this pipeline execution enters `FAILED`, including source, build, release, or verification failures; successful executions send no email. The email contains the pipeline execution event, and detailed results remain in CodeBuild logs. Build commands and notification resources are configured by the `AirlineRankingDeployment` stack; changes to them require a reviewed infrastructure deployment.

The pipeline can start immediately after creation. Verify automatic change detection after the next approved merge to `main`: the execution history must show a repository event trigger and the merged commit ID. A successful manually started release does not verify this trigger. Automatic releases preserve the deployed schedule, concurrency, environment and IAM permissions. Polling is controlled only by reviewed manual deployments of the application stack with an explicit `-c isPollingEnabled` value. A synthesized template in CI is validation, not an infrastructure deployment.

After merging, use the following checks before considering a manual deployment:

1. Find the automatic execution for the exact merged commit. A successful execution for an older commit does not confirm that the latest change is deployed.
2. Allow at least 15 minutes for the trigger to arrive; a webhook has previously taken over 10 minutes. If an execution is queued or running, follow its progress. If it failed, investigate that failure instead of starting another deployment.
3. If no execution appears after the waiting period, investigate the connection and trigger configuration. The waiting period is an investigation threshold, not an instruction to start a manual deployment automatically.
4. Immediately before any manual start, recheck execution history for the intended commit and pin the execution to that commit. A delayed webhook may still arrive afterward, so a manual start can still cause a duplicate deployment.

Infrastructure remains defined in CDK. Changes to either stack require a reviewed manual deployment; the pipeline cannot assume CDK bootstrap roles, deploy CloudFormation, manage IAM, change scheduling or upgrade the AWS plan. Its application permissions cover code updates and configuration reads for the existing refresh Lambda, frontend HTML/JavaScript/CSS uploads, and invalidation of the existing distribution. Artifact and log access is limited to its own resources. Connection policies constrain repository and branch requests to this repository's `main` branch.

Direct Lambda code releases do not update CloudFormation's recorded code asset. Before a manual infrastructure deployment, check out the latest approved `main`, run the checks and review `cdk diff`; CDK bundles that revision's backend and may update Lambda code again. Do not deploy an older checkout unless intentionally rolling back. Keep polling context explicit. Bootstrap administrator permissions remain available for manual infrastructure administration, but are not reachable through pipeline roles.

Code merged into `main` is still trusted application code: replacement Lambda code can use the existing runtime role to access the SkyLink key and state. Restricting deployment authority does not protect provider quota from malicious backend code; protect repository access and retain provider-side controls. The build has no direct permission to read that key or write polling state or `api/ranking`.

Build logs and source artifacts expire after seven days. The artifact bucket survives stack removal. CodeBuild, pipeline executions and artifact storage incur usage even when checks fail or infrastructure is unchanged; the build timeout bounds one run, not monthly usage. No deployment step upgrades the plan or changes the spend limit.

To pause deployment, disable the pipeline's inbound transition to its Deploy stage in AWS. To recover an application release, revert the relevant change through a PR and release again; automatic releases do not use CloudFormation rollback. Manual infrastructure updates retain CloudFormation's normal rollback behavior. Verify the website and snapshot freshness after a release.

### Releases

Deployments continue from `main`. Releases mark meaningful milestones rather than every merged PR. After the owner approves a release, confirm the deployment of its exact commit succeeded and verify the live website and ranking endpoint. If the release includes infrastructure changes, complete and verify their manual deployment too.

Create an annotated Git tag such as `v0.1.0` on that verified commit and publish a GitHub release with concise notes describing the changes and any known limitations. Never move or reuse a published tag. While the application is in the `0.x` stage, increment the patch number for fixes (`v0.1.1`) and the minor number for substantial features (`v0.2.0`). Match `package.json` to the planned release version through a PR before deploying and tagging it.

Tags do not trigger deployments or restore infrastructure, cached data or provider quota history. Recover application changes through the revert-and-release procedure above. No release branch or separate changelog is required.

### Retiring the application

Disabling polling stops scheduled provider requests, but leaves the website and AWS resources running. To retire the application completely:

1. Disable the schedule and stop any local backend using the same API key. Preserve any state needed for recovery; keep exported caches outside Git.
2. Delete `AirlineRankingDeployment` first, then disable termination protection and delete the `AirlineRanking` stack. The pipeline imports application resource identifiers, so its stack must be removed first. Empty and delete its retained artifact bucket when no longer needed. Both S3 buckets are retained and continue to incur storage charges.
3. After confirming their data is no longer needed, empty and delete the retained buckets. The versioned state bucket must also have all object versions and delete markers removed. Its seven-day lifecycle rule removes superseded versions. Current counts archives and operational state remain retained until explicitly deleted.
4. Delete the separately created `/airline-ranking/skylink-api-key` parameter if it is no longer needed. Review any separately configured billing alerts or deployment access.
5. Review the `CDKToolkit` bootstrap stack and its assets separately. Bootstrap resources support CDK deployments in the AWS project and Region and may be shared by other applications; remove them only when no remaining deployment needs them.
6. The domain, hosted zone and certificate are not deleted with the stack. Keep them if other sites use them. Otherwise, review domain auto-renewal and remove unneeded DNS storage and certificates; do not remove validation records for certificates still in use. Domain renewal and hosted-zone charges continue while retained.
7. Check billing after usage records have updated and confirm no unwanted resources remain. Retiring AWS resources does not cancel the SkyLink subscription; review that separately.

Development follows the lightweight branch, pull request, and squash-merge workflow in [AGENTS.md](../AGENTS.md).
