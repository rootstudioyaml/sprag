// claude-token-saver feedback form -> GitHub issue relay.
// Trigger: From form / On form submit -> onFormSubmitToGitHub.
// Requires Script Property GITHUB_TOKEN: a fine-grained PAT with
// Issues: Read and write on rootstudioyaml/claude-token-saver only.
const REPO = 'rootstudioyaml/claude-token-saver';

function onFormSubmitToGitHub(e) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) { console.error('GITHUB_TOKEN script property missing'); return; }
  const items = e.response.getItemResponses();
  const message = String(items[0] ? items[0].getResponse() : '').trim();
  const meta = String(items[1] ? items[1].getResponse() : '').trim();
  if (!message) return;
  const firstLine = message.split('\n')[0];
  const title = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
  const body = message + '\n\n---\n' + meta +
    '\n\nvia anonymous feedback form (auto-filed)';
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/issues', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify({ title: title, body: body, labels: ['feedback'] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    console.error('GitHub API ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}
