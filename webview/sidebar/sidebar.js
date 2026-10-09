// Sidebar view: forwards button clicks to the extension host. No other logic lives here.
(function () {
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button[data-command]') : null;
    if (target) {
      vscode.postMessage({ command: target.getAttribute('data-command') });
    }
  });
})();
