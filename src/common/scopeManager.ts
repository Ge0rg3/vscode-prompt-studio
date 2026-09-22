// Remembers whether the vault and skills views show the project or the global collection
import * as vscode from 'vscode';

export type StudioScope = 'project' | 'global';

const STATE_KEY = 'studioScope';
const SCOPE_CONTEXT = 'promptStudio.scope';
const GLOBAL_LABEL = 'Global';

export class ScopeManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StudioScope>();
  private current: StudioScope;

  readonly onDidChangeScope: vscode.Event<StudioScope> = this.emitter.event;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.current = this.workspaceState.get<string>(STATE_KEY) === 'global' ? 'global' : 'project';
    this.publishContext();
  }

  // Set promptStudio.scope so each view title bar shows the button that swaps the other way
  private publishContext(): void {
    void vscode.commands.executeCommand('setContext', SCOPE_CONTEXT, this.current);
  }

  getScope(): StudioScope {
    return this.current;
  }

  isGlobal(): boolean {
    return this.current === 'global';
  }

  // Show "Global" beside a sidebar section's title while the global collection is on
  labelView(view: vscode.WebviewView | undefined): void {
    if (view) {
      view.description = this.isGlobal() ? GLOBAL_LABEL : undefined;
    }
  }

  // Swap the views over and remember the choice for this workspace
  async setScope(scope: StudioScope): Promise<void> {
    if (scope === this.current) {
      return;
    }

    this.current = scope;
    await this.workspaceState.update(STATE_KEY, scope);
    this.publishContext();
    this.emitter.fire(scope);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
