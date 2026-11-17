# CodeGraph Index for Orca

An [Orca](https://orca.dev) plugin that keeps a [CodeGraph](https://github.com/colbymchenry/codegraph) index ready in each new workspace.

This plugin is unofficial. The CodeGraph project and the Orca project did not make it and do not endorse it.

## What it does

The plugin does these steps in the background when Orca creates a workspace. It also does them when an agent starts in a workspace that has no index.

1. It finds the primary checkout of the repository with `git rev-parse --git-common-dir`.
2. If the primary checkout has no `.codegraph/codegraph.db`, the plugin stops. A repository that does not use CodeGraph stays untouched.
3. It runs `codegraph upgrade` with `CODEGRAPH_NO_INSTALL_REFRESH=1` and `CODEGRAPH_NO_PROMPT_HOOK=1`. The upgrade does not rewrite your agent configuration files or your Claude Code settings.
4. If the workspace has no `.codegraph/codegraph.db`, it runs `codegraph init --yes`.
5. Otherwise, it reads `codegraph status --json` for the workspace.
6. If CodeGraph recommends a new index, it runs `codegraph index -q`.

Orca can start the agent of a new workspace before it reports the new workspace. In that case, the plugin starts the steps when the agent starts. While the steps run, the plugin puts a wait in front of the agent command. The terminal shows `orca-codegraph: waiting for the CodeGraph index`. The agent starts when the index is ready, or after 300 seconds.

## What it does not do

- It does not index the primary checkout. Run `codegraph init` there one time.
- It does not check a workspace that already has an index when an agent starts there.
- It does not run on Windows.
- It runs `git` and `codegraph` on the computer that runs Orca. It does not index a workspace on an SSH host or a remote host.

## Requirements

- Orca 1.4.248 or later
- CodeGraph 1.6.0 or later, with `codegraph` on the `PATH` of Orca
- Git 2.31 or later
- macOS or Linux

## Install

```sh
orca plugin install and3r817/orca-codegraph
```

Orca asks for approval. The plugin runs its own code with your user account. It runs only `git` and `codegraph`, and it writes marker files in a private directory of its own inside the temporary directory of the system.

## Develop

```sh
orca plugin types .
orca plugin test .
orca plugin validate .
orca plugin dev watch .
```

Disable the installed plugin before you run `orca plugin dev watch .`, because two workers for one workspace start two index builds.

`orca plugin logs local.codegraph` prints what the plugin did.

## License

MIT
