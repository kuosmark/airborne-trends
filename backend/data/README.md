# Aircraft reference

`mictronics-aircraft-types.json` is derived from `types.json` in the
[Mictronics aircraft database](https://github.com/Mictronics/aircraft-database)
full `indexedDB.zip` export. It maps ICAO type codes to the supplied readable names.
The initial import uses the 11 October 2026 export (database version 526).
Generic designators and non-aircraft entries are excluded. Names can describe a
family rather than the exact variant; upstream capitalization is preserved.

This adapted database is available under the
[Open Data Commons Attribution License](https://opendatacommons.org/licenses/by/1-0/).
The supplied licence is retained in `mictronics-LICENSE.txt`, and the application's
“How does it work?” section credits Mictronics. Keep both when updating.
`mictronics-aircraft.json` is derived from `aircrafts.json` in the same export.
Each lowercase ICAO24 address maps to `[typeCode, registration]`. Registrations
are uppercased with whitespace and hyphens removed. Only records with a type code
in the bundled type-name reference are retained. It contains no owner details.
The backend uses these records only when code/name matching fails, rejecting
conflicting nonempty registrations. Both files use the same attribution and licence.

`mictronics-aircraft-classifications.json` retains the three-character category, engine-count and propulsion classification from `types.json`. It was initially imported from export version 527 and follows the same monthly update and licence. Unknown encodings remain unavailable in the UI; zero is not displayed as an engine count. Wake categories are not imported.

## Updates

The backend packages the type names, classifications and the separate aircraft JSON file, so application use makes no reference-data requests.
When enabled, the **Update aircraft reference** workflow is scheduled for 07:23 UTC on the first of each month. Maintainers can also start it from the Actions tab using **Run workflow**.

It downloads the full export, imports names, classifications and aircraft identities, and rejects malformed entries,
duplicate codes or ICAO24 addresses, a changed licence or removal of more than 5% of either reference.
Unchanged references produce no PR. Changed references run `npm run check`, then open or
update one PR on `codex/update-aircraft-types`. The owner reviews changed names, classifications and aircraft records
and approves merging; the workflow never merges or deploys. A failed update
leaves the deployed reference unchanged. Investigate failed Actions runs rather
than bypassing validation.

Repository Settings → Actions → General → Workflow permissions must allow
GitHub Actions to create pull requests. The workflow uses the built-in token;
no personal token is needed. GitHub may require a maintainer to select
**Approve workflows to run** on the generated PR. Confirm CI passes on the latest
revision before merging.

To reproduce an update locally:

```sh
curl --fail --location https://raw.githubusercontent.com/Mictronics/aircraft-database/main/indexedDB.zip --output /tmp/mictronics.zip
node --experimental-strip-types scripts/update-aircraft-types.ts /tmp/mictronics.zip
npm run check
```

The importer uses Node.js and the system `unzip` utility. Review the JSON diff, particularly removals, registration/type reassignments and family-name changes. Do not infer additional aliases from similar names.
