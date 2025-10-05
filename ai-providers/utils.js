// utils.mjs

export function parseJson(text) {
  if (typeof text !== 'string') {
    return null;
  }

  // Handle the case where the text is wrapped in ```json ... ```
  const match = text.match(/```json\n([\s\S]*)\n```/);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error('Failed to parse JSON from markdown:', e);
      return null;
    }
  }

  // Handle the case where the text is just a JSON string
  try {
    return JSON.parse(text);
  } catch (e) {
    // Not a valid JSON string, do nothing
  }

  return null;
}
