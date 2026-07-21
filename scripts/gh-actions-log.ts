// GitHub Actions workflow-command log annotations, shared by every CI-run script under
// `scripts/`. See https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions.

export function notice(msg: string) {
  console.log(`::notice::${msg}`);
}

export function warning(msg: string) {
  console.log(`::warning::${msg}`);
}

export function error(msg: string) {
  console.log(`::error::${msg}`);
}
