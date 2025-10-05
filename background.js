import { generateTour } from './ai-service.js';
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 

  if (message && message.type === 'GENERATE_TOUR') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }

      const sendMessageToTab = (tabId, msg, cb) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (chrome.runtime.lastError) {
            // If no receiver, try injecting the content script then retry
            const err = chrome.runtime.lastError && chrome.runtime.lastError.message ? chrome.runtime.lastError.message : '';
            // Only attempt injection on the common 'Could not establish connection' error
            if (err.includes('Could not establish connection') || err.includes('Receiving end does not exist')) {
              // Attempt to inject the content script into the tab and retry
              chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, (injectionResults) => {
                if (chrome.runtime.lastError) {
                  cb(new Error('Failed to inject content script: ' + chrome.runtime.lastError.message));
                  return;
                }

                // Retry sendMessage once
                chrome.tabs.sendMessage(tabId, msg, (resp2) => {
                  if (chrome.runtime.lastError) {
                    cb(new Error('No receiver after injection: ' + chrome.runtime.lastError.message));
                    return;
                  }
                  cb(null, resp2);
                });
              });
              return;
            }

            cb(new Error(err || 'Unknown sendMessage error'));
          } else {
            cb(null, resp);
          }
        });
      };

      // Ask the content script for a small page context (title, snippet, selectors, etc.)
      sendMessageToTab(tab.id, { type: 'REQUEST_PAGE_CONTEXT', prompt: message.prompt }, async (sendErr, pageContextResp) => {
        if (chrome.runtime.lastError) {
          // content script may not be present on the page
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        if (sendErr) {
          sendResponse({ ok: false, error: String(sendErr.message) });
          return;
        }

        const pageContext = (pageContextResp && pageContextResp.pageContext) || {};
        const mock = !!message.mock;
        const showRaw = !!message.showRaw;

        // Use callback style for chrome.storage for broad MV3 compatibility
        chrome.storage.local.get(['geminiApiKey'], async (data) => {
          try {
            const apiKey = data && data.geminiApiKey;
            if (!apiKey && !mock) {
              sendResponse({ ok: false, error: 'No Gemini API key saved in extension storage.' });
              return;
            }

          

            let apiResp;
            try {
              apiResp = await generateTour(apiKey, message.prompt, pageContext);
            } catch (err) {
              console.error('Background: error calling AI service:', err);
              sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
              return;
            }

            // Attempt to extract raw generated text for debugging (common fields)
            let rawText = null;
            if (apiResp) {
              if (apiResp.candidates && Array.isArray(apiResp.candidates) && apiResp.candidates[0]) {
                const cand = apiResp.candidates[0];
                if (cand.content && typeof cand.content === 'string') rawText = cand.content;
                else if (cand.output) rawText = cand.output;
                else if (cand.content && Array.isArray(cand.content) && cand.content[0] && cand.content[0].text) rawText = cand.content[0].text;
              }
              if (!rawText && apiResp.outputText) rawText = apiResp.outputText;
              if (!rawText && apiResp.output && typeof apiResp.output === 'string') rawText = apiResp.output;
            }

            // Send the result back to the content script to render (use helper)
            sendMessageToTab(tab.id, { type: 'GEMINI_RESULT', result: apiResp }, (sendErr2) => {
              if (sendErr2) {
                sendResponse({ ok: false, error: String(sendErr2.message), rawText: showRaw ? rawText : undefined });
                return;
              }
              sendResponse({ ok: true, rawText: showRaw ? rawText : undefined });
            });
          } catch (outerErr) {
            console.error('Background: unexpected error:', outerErr);
            sendResponse({ ok: false, error: String(outerErr && outerErr.message ? outerErr.message : outerErr) });
          }
        });
      });
    });

    // Keep channel open for async sendResponse
    return true;
  }

  // Allow content script to request driver asset injection when page CSP blocks CDN
  if (message && message.type === 'INJECT_DRIVER') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); return; }

    // inject CSS then JS using promise chaining
    chrome.scripting.insertCSS({ target: { tabId }, files: ['vendor/driver.css'] })
      .then(() => chrome.scripting.executeScript({ target: { tabId }, files: ['vendor/driver.js'] }))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));

    return true;
  }
});
