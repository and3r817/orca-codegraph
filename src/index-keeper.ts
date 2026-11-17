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
    return git.code === 0 && existsSync(join(dirname(git.stdout.trim()), '.codegraph', 'codegraph.db'))
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
