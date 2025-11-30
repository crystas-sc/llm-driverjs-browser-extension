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
 * @param {boolean} hasPageContext
 * @param {Object} tour - The existing tour object if available.
 * @returns {string} The output instruction prompt string.
 */
function buildOutputInstruction(hasPageContext, tour) {
    let instructions = `
---RESPONSE FORMAT---
Return ONLY a JSON object (no surrounding text).
The object must have a "type" property and a "data" property.
`;

    if (hasPageContext) {
        instructions += `
IF YOU GENERATE A NEW TOUR (type="tour"):
"data" must be an array of step objects.
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
Selector rules:
- Use only CSS selectors that work with document.querySelector(). Do NOT use XPath.
- Prefer id (#id) or specific class combinations.
- Avoid brittle selectors.

Example tour output:
{
  "type": "tour",
  "data": [
    { "element": "#header", "popover": { "title": "Header", "description": "..." } }
  ]
}
`;
    }

    if (tour) {
        const keys = tour.formInputs ? Object.keys(tour.formInputs) : [];
        instructions += `
IF YOU FILL INPUTS FOR EXISTING TOUR (type="fill_input_form"):
"data" must be an object containing "tourName" and "formInput".
- "tourName": Must be "${tour.tourName}".
- "formInput": An object where keys are the target input keys and values are extracted from the User Prompt.

Target Input Keys: ${JSON.stringify(keys)}

Example fill_input_form output:
{
  "type": "fill_input_form",
  "data": {
    "tourName": "${tour.tourName}",
    "formInput": {
      "origin": "London",
      "destination": "Paris"
    }
  }
}
`;
    }

    instructions += `
DECISION LOGIC:
- If you are provided with an EXISTING TOUR, you MUST return type="fill_input_form".
- If the user asks for a new tour and you have Page Context, return type="tour".
`;

    return instructions.trim();
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Calls the Generative Language API.
 * The AI decides whether to generate a tour or extract inputs based on the prompt and available context.
 *
 * @param {string} apiKey - The Gemini API key.
 * @param {string} userPrompt - The user's instruction.
 * @param {Object} contextData - Object containing { pageContext, tour }.
 * @returns {Promise<Object>} The result object { type: 'tour'|'fill_input_form', data: ... }.
 */
export async function callGemini(apiKey, userPrompt, contextData = {}) {
    let { pageContext, tour } = contextData;
    console.log("contextData", contextData);
    // return;
    pageContext = "";
    const hasPageContext = !!pageContext && Object.keys(pageContext).length > 0;

    const contextPrompt = buildContextPrompt(pageContext);
    const outputInstruction = buildOutputInstruction(hasPageContext, tour);

    let combinedText = `User Prompt: "${userPrompt}"\n\n${contextPrompt}`;

    if (tour) {
        combinedText += `\n\n---EXISTING TOUR---\nName: ${tour.tourName}\nDescription: ${tour.description}\nForm Inputs: ${JSON.stringify(tour.formInputs)}`;
    }

    combinedText += `\n\n${outputInstruction}`;

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

            if (!resp.ok) {
                const errorBody = await resp.text();
                if (resp.status >= 500 && attempt < GEMINI_CONFIG.MAX_RETRIES) {
                    const delay = GEMINI_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    console.warn(`Transient error (${resp.status}). Retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }
                throw new Error(`Generative Language API Error ${resp.status}: ${errorBody}`);
            }

            const apiResp = await resp.json();
            const genText = apiResp.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (!genText) {
                throw new Error("API response was successful but contained no generated text.");
            }

            const result = parseJson(genText);

            if (!result || !result.type || !result.data) {
                // Fallback for legacy/simple array return
                if (Array.isArray(result)) {
                    return { type: 'tour', data: result };
                }
                // Fallback for simple object return
                if (typeof result === 'object') {
                    // Heuristic: if it looks like steps
                    if (result[0] && result[0].popover) return { type: 'tour', data: result };

                    // If it looks like inputs (keys match formInputs)
                    if (tour && tour.formInputs) {
                        // Check if keys overlap
                        const inputKeys = Object.keys(tour.formInputs);
                        const resultKeys = Object.keys(result);
                        const hasOverlap = resultKeys.some(k => inputKeys.includes(k));
                        if (hasOverlap) {
                            return {
                                type: 'fill_input_form',
                                data: {
                                    tourName: tour.tourName,
                                    formInput: result
                                }
                            };
                        }
                    }

                    // Default fallback
                    return { type: 'unknown', data: result };
                }

                console.warn("AI output parsed but missing type/data structure.", result);
                return { type: 'unknown', data: result };
            }

            console.log("Parsed result from Gemini:", result);
            return result;

        } catch (err) {
            if (attempt < GEMINI_CONFIG.MAX_RETRIES) {
                const delay = GEMINI_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.warn(`Network/Parse error. Retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Failed to call Generative Language API after all retries.');
}