// ai-service.js

import { callGemini } from './ai-providers/gemini.js';
import { callMockProvider } from './ai-providers/mock-provider.js';
import { getPredefinedTourForURL} from './ai-providers/predefined-tours.js';

export async function generateTour(apiKey, prompt, pageContext) {
  // For now, we're only using the Gemini provider.
  // In the future, we could add logic here to select a provider based on user preference or other criteria.
  return await callGemini(apiKey, prompt, pageContext);
  // return await callMockProvider(apiKey, prompt, pageContext);
}

export async function getPredefinedTours(url) {

  return await getPredefinedTourForURL(url);
}

