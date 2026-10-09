import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/types';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi = acquireVsCodeApi();
type Listener = (message: HostToWebviewMessage) => void;
const listeners = new Set<Listener>();

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  // Messages are only accepted from the extension host that created this webview.
  if (!event.origin.startsWith('vscode-webview://')) {
    return;
  }
  const message = event.data as HostToWebviewMessage | null;
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return;
  }
  for (const listener of [...listeners]) {
    listener(message);
  }
});

export const host = {
  post(message: WebviewToHostMessage): void {
    api.postMessage(message);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  command(command: string, args?: Record<string, string>): void {
    api.postMessage({ type: 'command', command, args });
  },
  copy(text: string): void {
    api.postMessage({ type: 'copy', text });
  },
  /** Small UI state (current page etc.) that survives the panel being hidden and restored. */
  getUiState<T>(): T | undefined {
    return api.getState() as T | undefined;
  },
  setUiState(state: unknown): void {
    api.setState(state);
  },
};
