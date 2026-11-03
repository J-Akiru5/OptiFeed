# Release integrity on `main`

**Status:** enforced by `.github/workflows/release.yml` since #586 (2026-11-02).

`main` is production. The project relies on one invariant: **every commit on
`main` belongs to a published release**. Before #586 the workflow derived the
expected tag from `package.json` only. When that version was already tagged, it
took the "already released" path and exited green, even if `main` had moved far
past the tag. The release job now compares the tag commit with `HEAD` and fails
instead of silently reporting success.

## What is checked, and where

The check is a **step inside the existing `release` job** (`tag and publish`),
immediately after the version is resolved:

```yaml
- name: Check main has not drifted past its release tag
  env:
    VERSION: ${{ steps.version.outputs.version }}
  run: node scripts/ops/release-drift.mjs --version "$VERSION"
```

The job also runs the harness first (`node --test
scripts/ops/__tests__/release-drift.test.mjs`). It is pure Node with no install,
so the pass/fail fixtures are proven before the real check runs.

Because it is a step, the job name - and therefore the required check name -
does not change. The check runs before any tag or GitHub Release is created, and
it never deploys anything.

The version is validated as **one set**. All of these must agree:

| Location | Value |
| --- | --- |
| `package.json` | `version` |
| `apps/web/package.json` | `version` |
| `apps/web/lib/legal/config.ts` | `LEGAL_APP_RELEASE` |
| `CHANGELOG.md` | `## [x.y.z]` section |
| git tag | `vx.y.z` |

Then the tag relationship is evaluated:

- **Tag missing** - this is the normal path for a version bump; the workflow is
  about to create `vx.y.z` at `HEAD`. The version set is still validated.
- **Tag at `HEAD`** - every commit on `main` is covered; pass.
- **Tag is an ancestor of `HEAD`** - every commit in `vx.y.z..HEAD` must be an
  explicit exemption (below). Otherwise the job fails.
- **Tag is not an ancestor of `HEAD`** - fail. A published tag is immutable:
  bump the version instead of moving it.

## Failure output

The failure names the exact range, the number of commits and the fix. This is a
real run against a throwaway fixture with two unreleased commits:

```text
error: main is 2 commits past v1.0.0 (v1.0.0..HEAD); 2 of 2 commits are not explicit release exemptions, so main carries code that no published release covers.
release-drift: commits that need a release:
  ce242d4 feat: unreleased work
  2ac3e9f fix: another unreleased change
error: Fix: bump the version in package.json, apps/web/package.json and apps/web/lib/legal/config.ts (LEGAL_APP_RELEASE), add a matching '## [<next version>]' section to CHANGELOG.md, commit it as 'chore(release): <next version>', and promote that commit to main. The release workflow then tags and publishes the new version.
```

The incident in #586 produces the same shape:

```text
main is 19 commits past v1.43.0 (v1.43.0..HEAD); ...
```

The implementation **fails the job**. It does not open or update a tracker issue,
so the red check is the signal.

## Fixing a failed check

1. Decide the next semver version (owner release decision).
2. Bump it in `package.json`, `apps/web/package.json` and
   `apps/web/lib/legal/config.ts` (`LEGAL_APP_RELEASE`).
3. Add the matching `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.
4. Commit as `chore(release): x.y.z` and promote that commit to `main`.
5. The release workflow tags `vx.y.z` and publishes the GitHub Release. Do not
   move or delete an existing tag, and do not publish a release by hand.

## Explicit exemptions

A range passes without a version bump only when **every** commit in it is one of
these, and the script prints each exempt commit with its reason:

| Exemption | Exact rule |
| --- | --- |
| `chore(release)` commit | Subject matches `chore(release): x.y.z` (optional `v` prefix) and every file it changes is one of the four release files. It cannot carry application code. |
| Revert of a failed release | Subject starts with `Revert`/`revert` and the body has `This reverts commit <sha>`; the reverted commit must be a release commit (a `chore(release)` commit, a release-preparation merge, or a merge that changed a version file). |
| Release-preparation merge | A merge commit (two or more parents) from a `release/*`, `release-*` or `chore/release-*` branch, whose diff against its first parent changes at least one release file. |

There is no environment variable, label, `[skip ci]`, commit-message keyword or
default bypass. If even one ordinary commit is in the range, the job fails and
lists it. The exemptions are deliberately narrow: a feature or fix commit can
never be made exempt by adding a word to its message.

## Reproduce both directions

The test harness builds throwaway repositories under the OS temporary directory;
it never tags, pushes or commits in the OptiFeed repository:

```sh
node --test scripts/ops/__tests__/release-drift.test.mjs
```

It proves:

- a version bumped and tagged at `HEAD` passes, and the same bump passes before
  the tag exists (the workflow's normal tagging path);
- `main` two commits past `v1.0.0` fails with `v1.0.0..HEAD`, the two commits and
  the fix;
- a `chore(release)` commit does not hide a following ordinary commit, and a
  `chore(release)` commit that carries application code is not exempt;
- a `chore(release)` commit plus its revert passes, and a release-preparation
  merge plus its preparatory commit passes;
- each disagreement in the version set (root/app, `LEGAL_APP_RELEASE`, changelog)
  fails.

To inspect the current checkout yourself:

```sh
node scripts/ops/release-drift.mjs
```

Run that on a `main` checkout. On `staging` the release tag is not an ancestor of
the branch tip (the tag points at the merge commit on `main`), so the script
reports the immutable-tag failure instead of a commit count. That is expected;
the workflow only runs the check on `main`.

## Current unreleased state (2026-11-02)

Issue #586 recorded `origin/main` at `edf221e`, 19 commits past the `v1.43.0` tag
(`da9692b`). By the time this change was implemented, `origin/main` had advanced
to `c8b7ebf` (merge of PR #580), still at version `1.43.0`: 31 commits past the
tag. A read-only run against that ref reports:

```text
release-drift: version set OK: root=1.43.0 apps/web=1.43.0 legal=1.43.0 changelog=present
error: main is 31 commits past v1.43.0 (v1.43.0..origin/main); 31 of 31 commits are not explicit release exemptions, so main carries code that no published release covers.
```

Those commits remain unreleased by decision: #586 explicitly leaves the next
version number, the changelog section and publication to the owner. They are not
exempt. The next push to `main` will fail with `v1.43.0..HEAD` until the version
set is bumped and promoted, instead of reporting success.

> **Rollout note:** the promotion that first carries this workflow is also the
> first run of the check. If that promotion does not bump the version, the
> `Release` job will be red by design. Include the next version set in that
> promotion (or follow it with one) before expecting a green release run.

## Related

- [ADR-0005: release tags and notes are generated from the changelog on `main`](adr/0005-release-automation.md)
- [Release procedure](deployment-workflow.md#5-release-procedure)
- [`scripts/ops/release-drift.mjs`](../scripts/ops/release-drift.mjs)
- [`scripts/ops/release-drift.test.mjs`](../scripts/ops/__tests__/release-drift.test.mjs)
