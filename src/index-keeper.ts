import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { markerPath } from './launch-wait'
import type { RunCommand } from './run-command'

export type IndexStatus = {
  initialized?: boolean
  index?: { reindexRecommended?: boolean }
}

export function nextAction(status: IndexStatus): readonly string[] | undefined {
  if (status.initialized !== true) {
    return ['init', '--yes']
  }
  if (status.index?.reindexRecommended === true) {
    return ['index', '-f', '-q']
  }
  return undefined
}

export function workspacePath(workspaceId: string): string | undefined {
  const separator = workspaceId.indexOf('::')
  const path = separator === -1 ? '' : workspaceId.slice(separator + 2)
  return path === '' ? undefined : path
}

const indexFile = (root: string): string => join(root, '.codegraph', 'codegraph.db')

export class IndexKeeper {
  private readonly pending = new Map<string, string>()
  private upgrade: Promise<void> | undefined

  constructor(
    private readonly run: RunCommand,
    private readonly markerDir: string,
    private readonly log: (message: string) => void
  ) {}

  pendingMarker(workspaceId: string): string | undefined {
    return this.pending.get(workspaceId)
  }

  start(workspaceId: string, path: string): void {
    this.ensure(workspaceId, path).catch((error: unknown) =>
      this.log(`index check failed for ${path}: ${String(error)}`)
    )
  }

  async holdLaunch(workspaceId: string): Promise<string | undefined> {
    const pending = this.pending.get(workspaceId)
    if (pending) {
      return pending
    }
    const path = workspacePath(workspaceId)
    if (path === undefined || existsSync(indexFile(path))) {
      return undefined
    }
    if (!(await this.primaryCheckoutHasIndex(path))) {
      return undefined
    }
    this.start(workspaceId, path)
    return this.pending.get(workspaceId)
  }

  async ensure(workspaceId: string, path: string): Promise<void> {
    if (this.pending.has(workspaceId)) {
      return
    }
    const marker = markerPath(this.markerDir, path)
    mkdirSync(this.markerDir, { recursive: true })
    writeFileSync(marker, '')
    this.pending.set(workspaceId, marker)
    try {
      if (await this.primaryCheckoutHasIndex(path)) {
        await this.upgradeOnce()
        await this.buildIndex(path)
      }
    } finally {
      this.pending.delete(workspaceId)
      rmSync(marker, { force: true })
    }
  }

  private async primaryCheckoutHasIndex(path: string): Promise<boolean> {
    const git = await this.run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return git.code === 0 && existsSync(indexFile(dirname(git.stdout.trim())))
  }

  private upgradeOnce(): Promise<void> {
    this.upgrade ??= this.run('codegraph', ['upgrade'], { CODEGRAPH_NO_INSTALL_REFRESH: '1' }).then((result) => {
      this.upgrade = undefined
      if (result.code !== 0) {
        this.log(`codegraph upgrade failed with exit code ${result.code}`)
      }
    })
    return this.upgrade
  }

  private async buildIndex(path: string): Promise<void> {
    const status = await this.run('codegraph', ['status', '--json', path])
    if (status.code !== 0) {
      this.log(`codegraph status failed with exit code ${status.code} for ${path}`)
      return
    }
    const action = nextAction(JSON.parse(status.stdout) as IndexStatus)
    if (!action) {
      return
    }
    const result = await this.run('codegraph', [...action, path])
    this.log(`codegraph ${action[0]} finished with exit code ${result.code} for ${path}`)
  }
}
