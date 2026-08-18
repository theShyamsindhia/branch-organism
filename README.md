# vertebrae

A transparent, always-on-top Git tree. Its resting view is a forward-looking branch landscape:

- `main` is automatically treated as the integration spine when it exists, with its tracked remote as the source of truth;
- `prd`, `prod`, or `production` becomes a separate production lane that honestly shows integration-only and production-only commits;
- a fully contained `dev` or `develop` ref collapses into one quiet retired-history marker instead of competing with current work;
- merged feature branches are hidden by default; only local refs still diverging from the integration spine remain in the live canopy;
- every branch grows leftward from its real merge-base ring, spaced while preserving ancestry order;
- branch length follows commits ahead, with real commit nodes and a short head SHA;
- current, upstream movement, and conflicts speak loudly while healthy or stale refs recede;
- conflicts use a broken rust stem and a clean cross at the branch head, with exact files and conflict kinds revealed on hover;
- open PRs turn warm yellow; local PR refs stay solid while remote-only teammate PRs use dashed ghost limbs, with friendly names retained for known collaborators;
- each passed check opens into one petal at the PR head, while failing and pending checks remain in the segmented ring; the final passing check completes the flower;
- merged limbs and their completed flowers turn muted purple; merging PRs contract into a hoverable checkpoint that keeps their PR details on the spine for 24 hours, while closed-unmerged limbs only fade;
- hovering a branch reveals its full name, PR state/title, named CI checks, ahead/behind counts, and last activity;
- a checked-out ref at the base head collapses onto the same spine commit instead of inventing divergence;
- the current marker briefly ticks every four seconds;
- a small fading gripper repositions the tree, which snaps to the right edge and remembers its position;
- GitHub merge state comes from `gh`, with a local `git merge-tree` fallback;
- local refs refresh every five seconds and remotes fetch every minute.

Git topology snapshots run in a background utility process, so large repositories cannot block the tray or window movement. Unchanged refs reuse the last snapshot, and remote refresh requests are queued rather than dropped.

Watched PR heads are fetched into the app-owned `refs/branch-organism/pr/*` namespace for exact ancestry without creating, checking out, or modifying working branches.

Remote refs refresh once a minute. When the tracked base branch falls behind its remote, a faint dashed ghost curves from the local checkpoint to the newer upstream head. It disappears once the two refs are synced.

The current marker is anchored to the checked-out commit and prints its short SHA. Branch ahead/behind counts stay in hover details so they cannot be mistaken for the current position.

Branches leave the spine at stable organic angles so the topology stays open and readable.

Branch junctions come from each ref's real merge-base with the tracked remote base. Divergent length follows commits ahead; zero-ahead refs collapse into quiet buds at their actual ancestor. The overlay remembers one previous upstream checkpoint so the latest remote movement remains visible after sync.

The menu-bar organism is the control surface. Click it once to show or hide the tree; right-click it to choose a repository, fetch immediately, open its GitHub page, or quit. **Branch Landscape** can override the integration spine, production lane, and retired-history refs per repository. The chosen folder and roles are remembered on relaunch.

On first launch, vertebrae opens the native folder picker automatically. Choose the repository root or any folder inside it. If the saved repository later moves, clicking the menu-bar organism opens the picker again.

## Share the Mac app

Build one Universal app for both Apple Silicon and Intel Macs:

```bash
npm install
npm run package:share
```

The shareable `.dmg` and `.zip` appear in `work/share`. Send either one. The recipient drags vertebrae into Applications, opens it, and chooses a local Git repository; Node.js and this source repository are not required on their Mac.

Because local builds are not notarized by Apple, the recipient may need to Control-click the app and choose **Open** the first time. A frictionless double-click install requires an Apple Developer ID certificate and notarization.

### Recipient requirements

- **Git** is required. macOS offers to install its Command Line Tools if Git is missing.
- **GitHub CLI** is optional but required for PR branches, checks, merge conflicts, and recent merge activity. Install it from [cli.github.com](https://cli.github.com/), then run `gh auth login` once.
- The repository must already exist locally and its remote access must work. Private repositories need the same GitHub access they normally require.

The menu-bar menu includes **Setup Help…** and **Choose Repository…**, so repository switching and prerequisite guidance remain available after onboarding.

## Run it

```bash
npm install
npm run build
npm start -- --repo=/absolute/path/to/your/repository
```

For renderer development with the included specimen data:

```bash
npm run dev:web
```

For live Electron development against a repository:

```bash
BRANCH_ORGANISM_REPO=/absolute/path/to/repository npm run dev
```

Press `Command/Ctrl + Shift + B` to hide or reveal the overlay. It is intentionally click-through and appears on every workspace.

Choose the tracked folder from the menu-bar control, pass `--repo=/absolute/path`, or set `BRANCH_ORGANISM_REPO`. Automatic integration selection prefers the remote default, then `main`, `master`, the current conventional branch, `dev`, and `develop`. The tree prefers `origin/<base>` before other configured upstreams.
