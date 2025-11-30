// ai-service.js

import { callGemini } from './ai-providers/gemini.js';
import { callMockProvider } from './ai-providers/mock-provider.js';
import { getPredefinedTourForURL } from './ai-providers/predefined-tours.js';

export async function generateTour(apiKey, prompt, pageContext, tour) {
  // 1. Check for mock override
  if (prompt.trim().toLowerCase().startsWith('mock:')) {
    return await callMockProvider(prompt, pageContext);
  }

  // 2. Call Gemini with unified interface
  const response = await callGemini(apiKey, prompt, { pageContext, tour });

  // 3. Validate and return data
  if (response.type === 'tour' && Array.isArray(response.data)) {
    return response.data;
  }

  if (response.type === 'fill_input_form') {
    return response;
  }

  // Fallback if AI returned something else or legacy format
  if (Array.isArray(response)) return response;
  if (response.data && Array.isArray(response.data)) return response.data;

  throw new Error(`Expected tour steps but got type: ${response.type}`);
}

export async function getPredefinedTours(url) {
  return await getPredefinedTourForURL(url);
}

export async function fillFormInputs(apiKey, prompt, tour) {
  const response = await callGemini(apiKey, prompt, { tour });

  // If AI returns extracted inputs (type="fill_input_form")
  if (response.type === 'fill_input_form' && response.data && response.data.formInput) {
    return response.data.formInput;
  }

  // Fallback for legacy/simple object return
  if (response.type === 'inputs' && typeof response.data === 'object') {
    return response.data;
  }

  // Fallback
  if (response.data) return response.data;
  if (!response.type && typeof response === 'object') return response;

  throw new Error(`Expected form inputs but got type: ${response.type}`);
}
