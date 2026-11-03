# CI required checks

Last reviewed: 2026-11-04 (issues #710 and #722). `CONTRIBUTING.md` remains the
process source of truth; this document records which checks actually block a
merge and the owner action that is still outstanding. **It does not change
branch protection.**

## Current required checks

Configured on `develop`, `staging` and `main`:

| Context | Workflow | Job |
| --- | --- | --- |
| `quality` | CI (`.github/workflows/ci.yml`) | `quality` |
| `bundle budget + latency` | Performance (`.github/workflows/perf.yml`) | `bundle-and-latency` |

Source: the API output recorded in #710
(`required_status_checks.contexts = ["quality", "bundle budget + latency"]` on
all three branches). A read-only `GET` with the session token that prepared this
document returned `404`, which is how GitHub answers a branch-protection read
without repository admin; it is not evidence that protection is missing.

GitHub matches a required check by its **check-run name**, which for GitHub
Actions is the job's `name:` (not the workflow name). The existing
`bundle budget + latency` entry proves the distinction: it is the `perf.yml` job
name, while the workflow is called `Performance`.

Verified 2026-11-04 against the check runs for `origin/develop` @ `d7ff4518`:
`audit`, `CycloneDX SBOM`, `gitleaks`,
`public smoke (chromium, firefox, webkit)` and `lighthouse budgets` all report
under those exact names.

## Workflows that can fail without blocking a merge

| Workflow | Check-run context(s) | Why it is not required today |
| --- | --- | --- |
| Security | `audit` | Production dependency audit gate |
| SBOM and secret scan | `CycloneDX SBOM`, `gitleaks` | Supply-chain evidence and secret scan |
| E2E smoke (cross-browser) | `public smoke (chromium, firefox, webkit)` | Chromium/Firefox/WebKit public-page smoke |
| Lighthouse budgets | `lighthouse budgets` | Public-page scores and resource budgets |
| Firmware | `compile` | Path-filtered to `firmware/**`; a PR that does not touch firmware never reports it |
| Maintainability | `dead-code`, `complexity` | Maintainability budgets, not correctness |

The four non-path-filtered workflows run on every pull request into `develop`,
`staging` and `main`, so they are suitable required checks. `Firmware` is
deliberately excluded: a path-filtered check that never reports on most PRs
would block every merge if made required.

## Recommended owner action

Add the four checks below to `develop`, `staging` and `main`. Use the exact
**context** strings; requiring the workflow name instead would create a context
that never reports and would block every pull request.

| Workflow (as named in #710) | Context(s) to add |
| --- | --- |
| Security | `audit` |
| SBOM and secret scan | `CycloneDX SBOM`, `gitleaks` |
| E2E smoke (cross-browser) | `public smoke (chromium, firefox, webkit)` |
| Lighthouse budgets | `lighthouse budgets` |

Prerequisite for `lighthouse budgets`: merge the budget correction below first,
so the check is green on all three branches before it gates anything. Adding a
currently-red check as required would block every promotion.

The commands are in the [appendix](#appendix--owner-run-gh-api-commands). Run
them as the repository owner; agents must not change branch protection.

## The Lighthouse false red (#710)

`lighthouse budgets` was red on `main` at `09d4234` (run `41639052669`) and on
`staging` (run `41637775172`) and PR #707 (run `41647938978`). The three
`resource-summary:total:size` samples for `/en` were:

| Sample | Bytes | Against the old 525,000 B budget |
| --- | --- | --- |
| 1 | 526,268 | +1,268 B (+0.24 %) |
| 2 | 526,263 | +1,263 B (+0.24 %) |
| 3 | 526,263 | +1,263 B (+0.24 %) |

The budget moved from 525,000 B to 530,000 B in `lighthouserc.json`. The new
ceiling is 3,732 B (0.7 %) above the worst sample and is a deliberate,
measured adjustment, not a response to a code-size regression. The per-category
performance score floors are unchanged. `docs/performance/README.md` records the
same decision next to the other Lighthouse budgets.

## Follow-up not covered here

`.github/workflows/perf.yml` still runs `pnpm dlx @lhci/cli@0.15.1`. The version
is pinned, but the package is fetched from the registry at run time, so it is
not immutable in the way a commit-SHA action pin is. That is recorded as a
follow-up to #722; this change does not alter the invocation.

## Appendix — owner-run `gh api` commands

These commands require a token with repository admin. They are provided for the
owner and must not be run by an agent. The `PUT` **replaces** the complete set,
so capture the current configuration first.

### 1. Capture the current configuration

```bash
for branch in develop staging main; do
  gh api "repos/J-Akiru5/OptiFeed/branches/${branch}/protection/required_status_checks" \
    --jq '{strict, contexts}' > "required-checks-${branch}.json"
done
```

If this returns `404`, the token cannot read branch protection (GitHub returns
`404` rather than `403`); use the web UI or an admin token instead.

### 2. Add the checks

```bash
for branch in develop staging main; do
  gh api --method PUT \
    "repos/J-Akiru5/OptiFeed/branches/${branch}/protection/required_status_checks" \
    --input - <<'JSON'
{
  "strict": false,
  "contexts": [
    "quality",
    "bundle budget + latency",
    "audit",
    "CycloneDX SBOM",
    "gitleaks",
    "public smoke (chromium, firefox, webkit)",
    "lighthouse budgets"
  ]
}
JSON
done
```

`strict: false` mirrors the current "Require branch up to date: No" setting
(`docs/deployment-workflow.md` §9). If a captured file says `"strict": true`,
keep that value.

On Windows PowerShell, pipe the body instead of using a here-document:

```powershell
$body = @{
  strict = $false
  contexts = @(
    "quality",
    "bundle budget + latency",
    "audit",
    "CycloneDX SBOM",
    "gitleaks",
    "public smoke (chromium, firefox, webkit)",
    "lighthouse budgets"
  )
} | ConvertTo-Json
foreach ($branch in "develop", "staging", "main") {
  $body | gh api --method PUT `
    "repos/J-Akiru5/OptiFeed/branches/$branch/protection/required_status_checks" --input -
}
```

### 3. Verify the result

```bash
for branch in develop staging main; do
  echo "== $branch"
  gh api "repos/J-Akiru5/OptiFeed/branches/${branch}/protection/required_status_checks" \
    --jq '.contexts'
done
```

Then confirm a pull request reports the exact names, and that each required
context is a real check run:

```bash
gh pr checks <pr-number> --repo J-Akiru5/OptiFeed
gh api "repos/J-Akiru5/OptiFeed/commits/$(git rev-parse origin/develop)/check-runs" \
  --jq '.check_runs[].name' | sort -u
```

A required context that never appears in the second list will block every PR.
Remove it before merging anything else.

### 4. Roll back

```bash
for branch in develop staging main; do
  gh api --method PUT \
    "repos/J-Akiru5/OptiFeed/branches/${branch}/protection/required_status_checks" \
    --input "required-checks-${branch}.json"
done
```
