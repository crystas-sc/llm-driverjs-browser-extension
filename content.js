// Content script: has DOM access. Responsible for calling Gemini API (client-side)
// and injecting/running Driver.js to show the tour.

// NOTE: This extension stores the user's Gemini API key in chrome.storage.local.
// This is intended only for prototyping. Do NOT use in production.

const DRIVER_CSS = 'https://cdn.jsdelivr.net/npm/driver.js@latest/dist/driver.css';
const DRIVER_JS = 'https://cdn.jsdelivr.net/npm/driver.js@latest/dist/driver.js.iife.js';

async function loadScript(url) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => res();
    s.onerror = (e) => rej(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}

async function loadCss(url) {
  return new Promise((res, rej) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = url;
    l.onload = () => res();
    l.onerror = () => rej(new Error('Failed to load css ' + url));
    document.head.appendChild(l);
  });
}

function removeSvgFromHtml(htmlString) {
  // Regex to find and remove the entire <svg> tag and its contents
  // The 'g' flag ensures all SVG instances are replaced globally
  const svgRegex = /<svg[^>]*>[\s\S]*?<\/svg>/g;
  return htmlString.replace(svgRegex, '');
}

// The content script no longer performs the Gemini fetch. The background service
// worker performs the network call and sends the structured result back as
// { type: 'GEMINI_RESULT', result }.

function buildDriverSteps(steps) {
  // Expect steps array with { selector, title, description }
  return steps.map(s => ({
    element: s.selector || null,
    popover: {
      title: s.title || '',
      description: s.description || ''
    }
  }));
}

async function runDriverjs(steps) {
  // Build the steps in the shape expected by the driver invocation
  const normalizedSteps = steps.map(s => ({
    element: s.element || s.selector || null,
    popover: s.popover || { title: s.title || '', description: s.description || '' }
  }));

  // Preferred: call the global driver(...) API if available
  try {
    console.log("window.driver:", window.driver);
    if (typeof window.driver.js.driver === 'function') {
      const driverObj = window.driver.js.driver({
        animate: false,
        showProgress: false,
        showButtons: ['next', 'previous', 'close'],
        steps: normalizedSteps
      });
      if (driverObj && typeof driverObj.drive === 'function') {
        driverObj.drive();
        return;
      }
    }

   


  } catch (err) {
    console.warn('Error starting driver:', err);
  }

  // Final fallback: simple sequential alerts
//   for (const s of normalizedSteps) {
//     alert((s.popover && s.popover.title ? s.popover.title + '\n' : '') + (s.popover && s.popover.description ? s.popover.description : ''));
//   }
}
// Message handler: triggered from background when user hits generate
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If background asks for page context, return a compact snapshot
  if (message && message.type === 'REQUEST_PAGE_CONTEXT') {
    //Array.from(document.body.children).filter(x =>  !["SCRIPT","LINK","STYLE"].includes(x.tagName)).map(x =>  x.innerHTML).join("\n")
    try {
      const pageContext = {
        title: document.title,
        url: location.href,
        // Keep body text reasonably small; trim to first 40k chars to avoid huge messages
        //textSnippet: (document.body && document.body.innerText) ? document.body.innerText.slice(0, 40000) : '',
        textSnippet: Array.from(document.body.querySelectorAll('*')).filter(x =>  ["A","BUTTON"].includes(x.tagName)).map(x =>  removeSvgFromHtml(x.outerHTML)).join("\n").trim() || null,
        // Optionally collect visible selectors or heuristic targets
        timestamp: Date.now()
      };

      sendResponse({ pageContext });
    } catch (err) {
      sendResponse({ pageContext: {} });
    }

    return true; // async
  }

  // Background sends the parsed Gemini result back to the content script for rendering
  if (message && message.type === 'GEMINI_RESULT') {
    (async () => {
      try {
        let steps = message.result || [];

        // Try common locations for generated text in the Generative Language API
        // let genText = apiResp?.candidates[0]?.content?.parts[0]?.text || '';
        // genText = genText.trim();
        // let steps = [];
        // if(genText){
            // console.log("Gen text from parts[0].text:", genText);
            // steps = JSON.parse(genText);
            // If genText contains a Markdown-style code block with JSON, extract and parse it
            // const codeBlockMatch = genText.match(/```json\s*([\s\S]*?)```/i);
            // if (codeBlockMatch && codeBlockMatch[1]) {
            //     try {
            //         const jsonStr = codeBlockMatch[1].trim();
            //         const parsed = JSON.parse(jsonStr);
            //         if (Array.isArray(parsed)) {
            //             steps = parsed;
            //         } else if (parsed && Array.isArray(parsed.steps)) {
            //             steps = parsed.steps;
            //         }
            //     } catch (e) {
            //         console.warn('Failed to parse JSON from code block:', e);
            //     }
            // }

        // }
        

        if (!Array.isArray(steps) || steps.length === 0) {
          sendResponse({ ok: false, error: 'No tour steps found in Gemini response.' });
          return;
        }

        // At this point we have structured steps
        debugger;
        await runDriverjs(steps);
        sendResponse({ ok: true });
      } catch (err) {
        console.error('Content script error rendering tour:', err);
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })();

    return true;
  }
});
