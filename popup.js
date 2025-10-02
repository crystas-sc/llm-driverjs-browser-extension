const $ = id => document.getElementById(id);

async function loadSaved() {
  const data = await chrome.storage.local.get(['geminiApiKey']);
  if (data.geminiApiKey) $('apiKey').value = data.geminiApiKey;
}

async function saveApiKey(key) {
  await chrome.storage.local.set({ geminiApiKey: key });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSaved();

  $('generate').addEventListener('click', async () => {
    const apiKey = $('apiKey').value.trim();
    const prompt = $('prompt').value.trim();
    const mock = !!$('mockMode').checked;
    const showRaw = !!$('showRaw').checked;
    if (!apiKey) return alert('Please enter your Gemini API key (for prototyping only).');
    if (!prompt) return alert('Please enter a prompt describing the tour you want.');

    await saveApiKey(apiKey);

    // Send message to background to trigger content script action on the active tab
  chrome.runtime.sendMessage({ type: 'GENERATE_TOUR', prompt, mock, showRaw }, (resp) => {
      // background will reply with status
      if (chrome.runtime.lastError) {
        alert('Error sending message: ' + chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.ok) {
        if (showRaw && resp.rawText) {
          $('rawOutput').textContent = resp.rawText;
          $('rawOutput').style.display = 'block';
        } else {
          window.close();
        }
      } else {
        alert('Failed to start generation: ' + (resp && resp.error ? resp.error : 'unknown'));
      }
    });
  });

  $('showLogs').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_BG_LOGS' }, (resp) => {
      if (chrome.runtime.lastError) {
        alert('Failed to get logs: ' + chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.ok && Array.isArray(resp.logs)) {
        $('bgLogs').textContent = resp.logs.map(l => `${l.ts} ${l.level.toUpperCase()} ${l.msg}`).join('\n');
        $('bgLogs').style.display = 'block';
      } else {
        alert('No logs available');
      }
    });
  });
});
