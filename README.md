# Branch Organism

A transparent, always-on-top Git tree. It shows the 15 most recently active local branches as restrained leaf venation, without a window surface:

- `origin/dev` descends from a free latest-history tip into an older-history root attached to the lower-right edge, with local branches balanced across its curve;
- up to three small nodes on a branch are its latest unique commits—four on the active branch—backed by their real SHA and subject;
- up to six dark nodes on the midrib are recent `origin/dev` commits; the larger endpoint is the branch pointer;
- each branch has a stable muted color that fades as the branch ages;
- the whole organism makes a slow 3D perspective swivel over a 48-second cycle;
- merge percentages appear only on the active branch; conflicts remain explicitly labeled;
- hovering anywhere along a branch pauses the swivel and reveals its full name, PR state/title, CI rollup, ahead/behind counts, and last activity;
- the checked-out branch briefly ticks every four seconds;
- when the checked-out branch is `dev`, its labeled marker is anchored to the exact matching SHA on the `origin/dev` spine;
- when `dev` and `origin/dev` are exactly synchronized, their labels collapse into one shared commit marker;
- a small fading gripper is the only interactive region; drag it to reposition the tree;
- moving within 120 pixels of the right display edge roots the curved tree flush to that edge;
- the position and docked posture are remembered between launches;
- conflict branches use a broken rust-colored stem;
- a ghost return-path shows each branch's route back to its merge checkpoint;
- the solid portion of that path reflects PR merge readiness;
- the checkpoint number shows how many newer base commits the branch is behind;
- GitHub conflict and merge state comes from `gh`, with a local `git merge-tree` fallback for the current branch;
- local refs refresh every five seconds and remotes fetch every five minutes.

Git topology snapshots run in a background utility process, so large repositories cannot block the tray or window movement. Unchanged refs reuse the last snapshot, and remote refresh requests are queued rather than dropped.

Remote refs refresh once a minute. When the tracked base branch falls behind its remote, a faint dashed ghost curves from the local checkpoint to the newer upstream head. It disappears once the two refs are synced.

The current marker is anchored to the checked-out commit and prints its short SHA. Branch ahead/behind counts stay in hover details so they cannot be mistaken for the current position.

Branches leave the spine at deterministic organic angles, alternating their rise and fall so the topology stays open and readable.

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
