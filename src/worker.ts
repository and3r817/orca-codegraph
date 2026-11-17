import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { IndexKeeper } from './index-keeper'
import { waitPrefix } from './launch-wait'
import { runCommand } from './run-command'
import type { RunCommand } from './run-command'

export function createActivate(run: RunCommand, createMarkerDir: () => string): (orca: OrcaWorkerApi) => void {
  return (orca) => {
    if (process.platform === 'win32') {
      orca.log('orca-codegraph runs on macOS and Linux only')
      return
    }
    const keeper = new IndexKeeper(run, createMarkerDir(), (message) => orca.log(message))
    orca.hooks.on('workspace.create.after', (event) => {
      keeper.start(event.workspaceId, event.path)
      return undefined
    })
    orca.hooks.on('agent.launch.before', async (event, next) => {
      const marker = event.workspaceId ? await keeper.holdLaunch(event.workspaceId) : undefined
      return marker ? next({ ...event, command: waitPrefix(marker) + event.command }) : undefined
    })
  }
}

export default createActivate(runCommand, () => mkdtempSync(join(tmpdir(), 'orca-codegraph-')))
