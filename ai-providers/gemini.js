// ai-providers/gemini.js
import { parseJson } from './utils.js';

export async function callGemini(apiKey, prompt, pageContext) {
  // Use the Generative Language REST endpoint as in the provided curl.
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  // Build a concise text payload that includes the user's prompt and a trimmed page context.
  const contextText = [];
  if (pageContext) {
    if (pageContext.title) contextText.push(`Title: ${pageContext.title}`);
    if (pageContext.url) contextText.push(`URL: ${pageContext.url}`);
    if (pageContext.textSnippet) contextText.push(`Page text snippet:
${pageContext.textSnippet.slice(0, 8000)}`);
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
    ]
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
      const apiResp = await resp.json();
      const genText =  apiResp?.candidates[0]?.content?.parts[0]?.text || ''
      const steps = parseJson(genText)
      console.log("Parsed steps from Gemini response:", steps);
      return steps || [];
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
