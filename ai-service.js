// ai-service.js

import { callGemini } from './ai-providers/gemini.js';

export async function generateTour(apiKey, prompt, pageContext) {
  // For now, we're only using the Gemini provider.
  // In the future, we could add logic here to select a provider based on user preference or other criteria.
  return await callGemini(apiKey, prompt, pageContext);
}
