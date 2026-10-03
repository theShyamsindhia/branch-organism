---
status: resolved
trigger: Hanging PR branch, uncertain current position, irregular updates in the live overlay.
---

## Symptoms

- Expected: connected, truthful history; current HEAD at its commit; predictable local and remote updates.
- Actual: screenshot shows Raj PR #2978 named main floating with “off spine · inspect”; current presentation branch marker on spine; user reports irregular refresh.
- Reproduction: live Studio repository, tracking /Users/shyamsindhia/projects/dev/studio.
- Timeline: visible after reverting worktree-selector experiment. No worktree UI is requested.

## Current Focus

- Fixed, tested, installed, and restarted. No outstanding task steps.

## Evidence

- Renderer intentionally draws a floating stem when baseDistance is null.
- resolvePullRequestRef falls back to local branch by name without matching PR SHA.
- Local polling every 5 seconds and remote polling every 60 seconds share one serial queue; remote fetch, GitHub queries and PR fetch happen before local snapshot.

## Constraints

- Work inline; preserve existing author-label edits and unrelated files.
- Do not alter Studio working files or checkouts.

## Resolution

- PR #2978 is xrehpicx:main, not local main. Its merge base 7cac6a7c2 enters the first-parent spine through a74b453 (PR #2973), distance 2. The attachment now uses that containing merge and explains its provenance on hover.
- HEAD is codex/presentation-quality-recovery at b410fafc7, distance 5, 25 commits behind origin/main. The original marker was correctly positioned but under-explained; it now shows SHA and behind count.
- PR refs must match the advertised head SHA; fork/local branch identity requires matching name and SHA. Renderer deduplicates by PR number, not bare name. Unknown history no longer draws a floating stem.
- Measured GitHub query ~6.1s, full snapshot ~7.7s, fingerprint ~71ms. Network polls blocked local checks; unchanged checkedAt invalidated cache each minute.
- Local and remote refresh are now independent, duplicate remote polls coalesce, stale repository/PR responses are guarded. Fingerprints track actual PR data and private refs; transition expiry no longer depends on successful network polling.
- All 27 unit tests pass, including six regressions. Build and Electron smoke assertions (hover, scrolling, exact anchors, fork identity, missing history) pass.
- Inspected rendered real Studio tree and PR #2978 hover; branch connects at a74b453 and HEAD shows b410fafc7 / 25 behind.
- Installed /Applications/vertebrae.app; codesign verification passed; process 67892 launched. Installed and packaged asar both SHA256 1ca42d936cf284d63e9c8f14058d68b55e225d14ad32e2872939b35ec04575e5. Prior app preserved in work/installed-before-anchor-fix-8l3cdF/vertebrae.app. Final Git check still HEAD b410fafc7, 0 ahead / 25 behind origin/main.
