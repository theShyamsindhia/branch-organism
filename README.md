# Branch Organism

A transparent, always-on-top Git tree. Its resting view keeps seven meaningful local branches, plus one open PR ghost for each watched teammate:

- `origin/dev` descends from a free latest-history tip into an older-history root attached to the lower-right edge;
- every branch grows leftward from its real merge-base ring, spaced while preserving ancestry order;
- branch length follows commits ahead, with real commit nodes and a short head SHA;
- current, upstream movement, and conflicts speak loudly while healthy or stale refs recede;
- conflicts use a broken rust stem and a clean cross at the branch head;
- open PRs from Raj (`xrehpicx`), Arnav (`AR13570`), Bishal (`ZenderGoD`), and Sammy (`ungaaaabungaaa`) use a separate four-limb budget, replacing only an exact duplicate branch with a dashed ghost limb and real PR commit nodes;
- merged PR limbs contract into their recorded merge checkpoint; closed-unmerged limbs only fade, while recent merges leave quiet rings on the spine;
- hovering a branch reveals its full name, PR state/title, CI rollup, ahead/behind counts, and last activity;
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

The menu-bar organism is the control surface. Click it once to show or hide the tree; right-click it to choose a repository, fetch immediately, open its GitHub page, or quit. The chosen folder is remembered on relaunch.

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

Choose the tracked folder from the menu-bar control, pass `--repo=/absolute/path`, or set `BRANCH_ORGANISM_REPO`. The base branch fallback order is `dev`, `develop`, `main`, then `master`. The tree prefers `origin/<base>` before other configured upstreams.
