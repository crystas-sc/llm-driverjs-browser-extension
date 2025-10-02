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
    const generateButton = $('generate');
    generateButton.classList.add('loading');

    const apiKey = $('apiKey').value.trim();
    const prompt = $('prompt').value.trim();

    if (!apiKey) {
      alert('Please enter your Gemini API key (for prototyping only).');
      generateButton.classList.remove('loading');
      return;
    }
    if (!prompt) {
      alert('Please enter a prompt describing the tour you want.');
      generateButton.classList.remove('loading');
      return;
    }

    await saveApiKey(apiKey);

    // Send message to background to trigger content script action on the active tab
    chrome.runtime.sendMessage({ type: 'GENERATE_TOUR', prompt }, (resp) => {
      generateButton.classList.remove('loading');
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


});
