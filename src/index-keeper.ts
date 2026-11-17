import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { markerPath } from './launch-wait'
import type { RunCommand } from './run-command'

type IndexStatus = { index?: { reindexRecommended?: boolean } }

export function workspacePath(workspaceId: string): string | undefined {
  const separator = workspaceId.indexOf('::')
  const path = separator === -1 ? '' : workspaceId.slice(separator + 2)
  return path === '' ? undefined : path
}

export class IndexKeeper {
  private readonly pending = new Map<string, string>()
  private upgrade: Promise<void> | undefined

  constructor(
    private readonly run: RunCommand,
    private readonly markerDir: string,
    private readonly log: (message: string) => void
  ) {}

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

  private async primaryCheckoutHasIndex(path: string): Promise<boolean> {
    const git = await this.run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return git.code === 0 && existsSync(indexFile(dirname(git.stdout.trim())))
  }

  async ensure(workspaceId: string, path: string): Promise<void> {
    if (this.pending.has(workspaceId)) {
      return
    }
    const marker = markerPath(this.markerDir, path)
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

  private upgradeOnce(): Promise<void> {
    this.upgrade ??= this.run('codegraph', ['upgrade'], {
      CODEGRAPH_NO_INSTALL_REFRESH: '1',
      CODEGRAPH_NO_PROMPT_HOOK: '1'
    }).then((result) => {
      this.upgrade = undefined
      if (result.code !== 0) {
        this.log(`codegraph upgrade failed with exit code ${result.code}`)
      }
    })
    return this.upgrade
  }

  private async buildIndex(path: string): Promise<void> {
    if (!existsSync(indexFile(path))) {
      const init = await this.run('codegraph', ['init', '--yes', path])
      this.log(`codegraph init finished with exit code ${init.code} for ${path}`)
      return
    }
    const status = await this.run('codegraph', ['status', '--json', path])
    if (status.code !== 0) {
      this.log(`codegraph status failed with exit code ${status.code} for ${path}`)
      return
    }
    if ((JSON.parse(status.stdout) as IndexStatus).index?.reindexRecommended === true) {
      const index = await this.run('codegraph', ['index', '-q', path])
      this.log(`codegraph index finished with exit code ${index.code} for ${path}`)
    }
  }
}

const indexFile = (root: string): string => join(root, '.codegraph', 'codegraph.db')
