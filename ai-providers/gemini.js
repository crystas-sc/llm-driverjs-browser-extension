import { parseJson } from './utils.js';

// =============================================================================
// Constants and Configuration
// =============================================================================

const GEMINI_CONFIG = {
    ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    MAX_CONTEXT_SNIPPET_LENGTH: 8000,
    MAX_RETRIES: 3,
    BASE_DELAY_MS: 500,
};

// =============================================================================
// Utility Functions
// =============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the page context portion of the prompt.
 * @param {Object} pageContext - The context object from the content script.
 * @returns {string} The formatted context string.
 */
function buildContextPrompt(pageContext) {
    if (!pageContext) return '';

    const parts = [];
    if (pageContext.title) parts.push(`Title: ${pageContext.title}`);
    if (pageContext.url) parts.push(`URL: ${pageContext.url}`);
    if (pageContext.textSnippet) {
        const snippet = pageContext.textSnippet.slice(0, GEMINI_CONFIG.MAX_CONTEXT_SNIPPET_LENGTH);
        parts.push(`Page text snippet:\n${snippet}`);
    }

    if (parts.length === 0) return '';

    return `---PAGE CONTEXT---\n${parts.join('\n\n')}`;
}

/**
 * Defines the strict JSON format and selector rules for the model.
 * @returns {string} The output instruction prompt string.
 */
function buildOutputInstruction() {
    return `
---RESPONSE FORMAT---
Return ONLY a JSON array (no surrounding text) which we'll call steps.
Each entry must be an object with the following shape when targeting a page element:
{
  "element": "<css selector>",
  "popover": {
    "title": "...",
    "description": "...",
    "side": "left|right|top|bottom",
    "align": "start|center|end"
  }
}
If a step is not attached to a DOM element (a summary/closing step), you must omit the "element" key or set it to null, e.g. { "popover": { ... } } or { "element": null, "popover": { ... } }.

Selector rules (very important):
- Use only CSS selectors that work with document.querySelector(). Do NOT use XPath.
- Prefer an id selector when available: use "#the-id".
- If no id, prefer class-based selectors: use a single class like ".my-class" or combine multiple classes as ".a.b" when necessary to make the selector specific.
- If id or classes are not available or not unique, fall back to the tag name (e.g. "button", "h2") optionally combined with :nth-of-type or simple descendant selectors to make it unique, but avoid overly brittle selectors.
- Avoid including full text content in the selector. Keep selectors concise and valid for querySelector().
- Do NOT include newlines inside selector strings. Escape characters as needed.

Return only the JSON array — no extra commentary, no surrounding markdown, and make sure strings are properly escaped.

Example output (exactly this JSON shape):
[
  { "element": "#tour-example", "popover": { "title": "Animated Tour Example", "description": "Short description here.", "side": "left", "align": "start" } },
  { "element": ".nav-item.active", "popover": { "title": "Navigation", "description": "Explain the nav item.", "side": "bottom", "align": "center" } },
  { "popover": { "title": "Happy Coding", "description": "Final note for the user." } }
]
`.trim(); // Trim leading/trailing whitespace from the template literal
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Calls the Generative Language API to generate tour steps using context.
 * Implements exponential backoff for transient errors.
 *
 * @param {string} apiKey - The Gemini API key.
 * @param {string} userPrompt - The user's instruction.
 * @param {Object} pageContext - Contextual data scraped from the active page.
 * @returns {Promise<Array<Object>>} The parsed array of tour steps.
 */
export async function callGemini(apiKey, userPrompt, pageContext) {
    const contextPrompt = buildContextPrompt(pageContext);
    const outputInstruction = buildOutputInstruction();

    const combinedText = `${userPrompt}\n\n${contextPrompt}\n\n${outputInstruction}`;

    const body = {
        contents: [{ parts: [{ text: combinedText }] }]
    };

    for (let attempt = 1; attempt <= GEMINI_CONFIG.MAX_RETRIES; attempt++) {
        try {
            const resp = await fetch(GEMINI_CONFIG.ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(body)
            });

            // Handle API failure response
            if (!resp.ok) {
                const errorBody = await resp.text();
                // Retry for 5xx server errors; fail immediately for 4xx client errors
                if (resp.status >= 500 && attempt < GEMINI_CONFIG.MAX_RETRIES) {
                    const delay = GEMINI_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    console.warn(`Transient error (${resp.status}). Retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }
                throw new Error(`Generative Language API Error ${resp.status}: ${errorBody}`);
            }

            // Success: Extract, Parse, and Return
            const apiResp = await resp.json();

            // Safely navigate the nested response structure
            const genText = apiResp.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (!genText) {
                 throw new Error("API response was successful but contained no generated text.");
            }

            const steps = parseJson(genText);

            if (!Array.isArray(steps)) {
                console.warn("AI output successfully parsed but was not an array. Returning empty array.");
                return [];
            }
            
            console.log("Parsed steps from Gemini response:", steps);
            return steps;

        } catch (err) {
            // Handle network/JSON parsing errors
            if (attempt < GEMINI_CONFIG.MAX_RETRIES) {
                const delay = GEMINI_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.warn(`Network/Parse error. Retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }
            // If max attempts reached, re-throw the last error
            throw err;
        }
    }
    // This line is technically unreachable but serves as a final failsafe
    throw new Error('Failed to call Generative Language API after all retries.');
}