# ADR-0005: Release tags and notes are generated from the changelog on `main`

- **Status:** Accepted
- **Date:** 2026-10-29 (tag/publish workflow); bot release PR 2026-10-22
- **Deciders:** Jeff (owner)
- **Backfilled:** 2026-10-29
- **Related:** [ADR-0001](./0001-deployment-model.md)

## Context

The branch model promotes `develop` -> `staging` -> `main`
([ADR-0001](./0001-deployment-model.md)), and `main` is production. Before this
decision, a version number lived in two `package.json` files, a tag was created
by hand when someone remembered, and release notes were written separately. That
allowed three failures:

- the two version files could disagree, and the deployed build would still ship;
- a version could reach `main` with no tag and no GitHub Release;
- release notes could describe something the changelog did not, or omit a change
  entirely.

The release PR had a fourth problem: GitHub does not let a pull-request author
approve their own pull request, and `main` requires one approving review with
administrators enforced. The owner opening the `staging` -> `main` promotion
could not also approve it.

## Decision

1. **The changelog is the source of the release notes.**
   [`scripts/release-notes.mjs`](../../scripts/release-notes.mjs) extracts the
   `## [x.y.z]` section of [`CHANGELOG.md`](../../CHANGELOG.md) verbatim. Notes
   are not written by hand and cannot drift from the changelog.
2. **A version must exist in both manifests and match.**
   [`.github/workflows/release.yml`](../../.github/workflows/release.yml) reads
   the root and `apps/web` versions and fails if they differ.
3. **A `main` push tags and publishes, idempotently.** On a push to `main` (not a
   manual dispatch from another branch), the workflow:
   - fails if `CHANGELOG.md` has no section for the current version;
   - creates the annotated tag `vX.Y.Z` if it does not exist;
   - publishes the GitHub Release with the generated notes if it does not exist;
   - publishes nothing when both already exist, so an ordinary `main` push is
     unaffected.
4. **The release PR is bot-authored, but never self-approved.**
   [`.github/workflows/release-pr.yml`](../../.github/workflows/release-pr.yml)
   opens (or reuses) the `staging` -> `main` pull request as
   `github-actions[bot]`. It never approves, merges, tags, deploys or pushes
   `main`; the human approval gate is unchanged.
5. **Published artefacts are immutable.** A tag or release is never moved,
   deleted or re-published. A wrong release is fixed forward with a new PATCH.
6. **Release and deployment are distinct.** A `main` push does both from the same
   commit, but neither substitutes for the other: the Vercel Git integration
   deploys, and this workflow only creates repository artefacts.

## Consequences

### Positive

- A version cannot reach `main` without a matching changelog section and a real
  tag.
- Release notes are reproducible from the repository, with no separate editing
  step.
- The bot-authored promotion PR lets the owner approve a promotion they opened
  without weakening the required review.
- The workflow is idempotent, so routine `main` pushes do not create duplicate
  tags or releases.

### Negative / accepted costs

- **A missing or malformed changelog blocks the release.** That is the intended
  behaviour, but it makes the changelog section a release prerequisite, not
  documentation.
- **Immutability has a cost.** A wrong note or a wrong tag cannot be corrected in
  place; it needs a new PATCH release.
- **The bot PR depends on a repository setting.** GitHub Actions must be allowed
  to create pull requests. The same setting also permits Actions to approve pull
  requests; no workflow here does, but the capability exists and is recorded in
  `docs/deployment-workflow.md` section 5.4.
- **`contents: write` is granted to the release job.** It is necessary to create
  a tag and a release; the action is limited to the job and to `main`.
- **No signing or provenance attestation.** The tag is annotated, not signed;
  release assets are not yet attested. A stronger supply-chain posture would add
  this, and it is not claimed today.

### Follow-ups

- Sign release tags and/or attest the artefact if the project starts distributing
  binaries.
- Keep the changelog section written in the release PR; the workflow is the
  enforcement, not a reminder.

## Links

- Implementation: [`.github/workflows/release.yml`](../../.github/workflows/release.yml),
  [`.github/workflows/release-pr.yml`](../../.github/workflows/release-pr.yml),
  [`scripts/release-notes.mjs`](../../scripts/release-notes.mjs)
- Sources of truth: [`CHANGELOG.md`](../../CHANGELOG.md),
  [`package.json`](../../package.json), [`apps/web/package.json`](../../apps/web/package.json)
- Procedure: [`CONTRIBUTING.md`](../../CONTRIBUTING.md) section 9 ("Release process"
  and "Every version must be a release"),
  [`docs/deployment-workflow.md`](../deployment-workflow.md) section 5
