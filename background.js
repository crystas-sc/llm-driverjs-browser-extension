// Background service worker: perform Gemini fetch (keeps API key out of content script).
// Flow:
// 1. Popup sends { type: 'GENERATE_TOUR', prompt }
// 2. Background asks the active tab's content script for a minimal page context
// 3. Background retrieves API key from chrome.storage.local and calls Gemini API
// 4. Background sends { type: 'GEMINI_RESULT', result } back to the tab for rendering

async function callGemini(apiKey, prompt, pageContext) {
  // Use the Generative Language REST endpoint as in the provided curl.
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  // Build a concise text payload that includes the user's prompt and a trimmed page context.
  const contextText = [];
  if (pageContext) {
    if (pageContext.title) contextText.push(`Title: ${pageContext.title}`);
    if (pageContext.url) contextText.push(`URL: ${pageContext.url}`);
    if (pageContext.textSnippet) contextText.push(`Page text snippet:\n${pageContext.textSnippet.slice(0, 8000)}`);
  }

  // Ask the model to return strictly-formatted JSON steps only (no extra commentary).
  // Be explicit about selectors: require an `element` key for steps that target page elements
  // and prefer CSS selectors derived from the element's id, then its classes, then tag name.
  const outputInstruction = `\n\n---RESPONSE FORMAT---\nReturn ONLY a JSON array (no surrounding text) which we'll call steps.\nEach entry must be an object with the following shape when targeting a page element:\n{\n  "element": "<css selector>",\n  "popover": {\n    "title": "...",\n    "description": "...",\n    "side": "left|right|top|bottom",\n    "align": "start|center|end"\n  }\n}\nIf a step is not attached to a DOM element (a summary/closing step), you may omit the "element" key or set it to null, e.g. { "popover": { ... } } or { "element": null, "popover": { ... } }.\n\nSelector rules (very important):\n- Use only CSS selectors that work with document.querySelector(). Do NOT use XPath.\n- Prefer an id selector when available: use "#the-id".\n- If no id, prefer class-based selectors: use a single class like ".my-class" or combine multiple classes as ".a.b" when necessary to make the selector specific.\n- If id or classes are not available or not unique, fall back to the tag name (e.g. "button", "h2") optionally combined with :nth-of-type or simple descendant selectors to make it unique, but avoid overly brittle selectors.\n- Avoid including full text content in the selector. Keep selectors concise and valid for querySelector().\n- Do NOT include newlines inside selector strings. Escape characters as needed.\n\nReturn only the JSON array — no extra commentary, no surrounding markdown, and make sure strings are properly escaped.\n\nExample output (exactly this JSON shape):\n[\n  { "element": "#tour-example", "popover": { "title": "Animated Tour Example", "description": "Short description here.", "side": "left", "align": "start" } },\n  { "element": ".nav-item.active", "popover": { "title": "Navigation", "description": "Explain the nav item.", "side": "bottom", "align": "center" } },\n  { "popover": { "title": "Happy Coding", "description": "Final note for the user." } }\n]\n`;

  const combinedText = `${prompt}\n\n---PAGE CONTEXT---\n${contextText.join('\n\n')}${outputInstruction}`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: combinedText
          }
        ]
      }
    ],
    generationConfig: {
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  // Retry/backoff parameters
  const maxAttempts = 3;
  const baseDelay = 500; // ms

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const text = await resp.text();
        // For 5xx errors, retry. For 4xx, fail fast.
        if (resp.status >= 500 && attempt < maxAttempts) {
          // transient server error -> retry
          await sleep(baseDelay * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error('Generative Language API returned ' + resp.status + ': ' + text);
      }

      // Success
      return await resp.json();
    } catch (err) {
      // Network or other fetch error
      if (attempt < maxAttempts) {
        await sleep(baseDelay * Math.pow(2, attempt - 1));
        continue;
      }
      throw err;
    }
  }
  // Should not reach here
  throw new Error('Failed to call Generative Language API');
}




chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Allow popup to fetch background logs
 

  if (message && message.type === 'GENERATE_TOUR') {
        // Get the active tab and request page context
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }

      // Helper: send a message to a tab; if there's no receiver, try injecting content.js and retry once.
      const sendMessageToTab = (tabId, msg, cb) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (!chrome.runtime.lastError) {
            cb(null, resp);
            return;
          }

          // If no receiver, try injecting the content script then retry
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message ? chrome.runtime.lastError.message : '';
          // Only attempt injection on the common 'Could not establish connection' error
          if (err.includes('Could not establish connection') || err.includes('Receiving end does not exist')) {
            // Attempt to inject the content script into the tab and retry
            console.log('warn', `No receiver for message to tab ${tabId}, attempting to inject content script`);
            chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, (injectionResults) => {
              if (chrome.runtime.lastError) {
                console.log('error', 'Failed to inject content script: ' + chrome.runtime.lastError.message);
                cb(new Error('Failed to inject content script: ' + chrome.runtime.lastError.message));
                return;
              }

              console.log('info', `Injected content script into tab ${tabId}, retrying message`);

              // Retry sendMessage once
              chrome.tabs.sendMessage(tabId, msg, (resp2) => {
                if (chrome.runtime.lastError) {
                  console.log('error', 'No receiver after injection: ' + chrome.runtime.lastError.message);
                  cb(new Error('No receiver after injection: ' + chrome.runtime.lastError.message));
                  return;
                }
                console.log('info', `Message delivered to tab ${tabId} after injection`);
                cb(null, resp2);
              });
            });
            return;
          }

          cb(new Error(err || 'Unknown sendMessage error'));
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

            if (mock) {
              // Return a hard-coded mock steps array as a string (wrapped with markers to simulate model output)
              const mockJson = [
                { element: '#tour-example', popover: { title: 'Animated Tour Example', description: "Here is the code example showing animated tour. Let's walk you through it.", side: 'left', align: 'start' } },
                { element: 'code .line:nth-child(1)', popover: { title: 'Import the Library', description: 'It works the same in vanilla JavaScript as well as frameworks.', side: 'bottom', align: 'start' } },
                { element: 'code .line:nth-child(2)', popover: { title: 'Importing CSS', description: 'Import the CSS which gives you the default styling for popover and overlay.', side: 'bottom', align: 'start' } },
                { element: 'code .line:nth-child(4) span:nth-child(7)', popover: { title: 'Create Driver', description: 'Simply call the driver function to create a driver.js instance', side: 'left', align: 'start' } },
                { element: 'code .line:nth-child(18)', popover: { title: 'Start Tour', description: 'Call the drive method to start the tour and your tour will be started.', side: 'top', align: 'start' } },
                { element: '#docs-sidebar a[href="/docs/configuration"]', popover: { title: 'More Configuration', description: 'Look at this page for all the configuration options you can pass.', side: 'right', align: 'start' } },
                { popover: { title: 'Happy Coding', description: 'And that is all, go ahead and start adding tours to your applications.' } }
              ];

              const mockSteps = `<<<JSON_START>>>\n${JSON.stringify(mockJson, null, 2)}\n<<<JSON_END>>>`;

              // Send the mock parsed response to content script (use helper to ensure content script exists)
              sendMessageToTab(tab.id, { type: 'GEMINI_RESULT', result: { steps: mockJson, rawText: mockSteps } }, (sendErr2) => {
                if (sendErr2) {
                  sendResponse({ ok: false, error: String(sendErr2.message), rawText: mockSteps });
                  return;
                }
                sendResponse({ ok: true, rawText: showRaw ? mockSteps : undefined });
              });

              return;
            }

            let apiResp;
            try {
              apiResp = await callGemini(apiKey, message.prompt, pageContext);
            } catch (err) {
              console.error('Background: error calling Gemini:', err);
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
