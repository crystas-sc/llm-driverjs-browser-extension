# LLM Driver.js Browser Extension

This Chrome extension prototypes generating on-page Driver.js tours using the Gemini LLM API.

Important: The Gemini API key is stored in `chrome.storage.local` and the extension calls the Gemini API directly from the content script (client-side). This is intended only for prototyping or personal use. Do NOT use this approach in production.

Contents
- `manifest.json` - Manifest V3 config.
- `popup.html` / `popup.js` - UI to enter API key and prompt the tour.
- `background.js` - Service worker to forward messages.
- `content.js` - Content script that calls Gemini API and runs Driver.js.

How to load in Chrome (developer mode)
1. Open chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked" and select this project folder
4. Click the extension icon, enter your Gemini API key and a prompt, then Generate Tour while on a target page.

Notes on Gemini API
- The content script contains a placeholder endpoint and a simple POST body. Adjust `content.js:callGemini()` to match the real Gemini REST API request/response format.

Driver.js
- Driver.js is loaded from CDN at runtime. If it fails to load, the extension will fall back to showing sequential alerts as a simple tour.

Security and privacy
- Your Gemini API key stays in your browser's extension storage. Anyone with access to your profile or device could read it. Treat it like a secret and only use this for local testing.

Next steps / Improvements
- Harden the Gemimi API call with model selection, prompt engineering, and response parsing.
- Add validation and preview of the parsed steps in the popup before running on the page.
- Provide a richer fallback UI if Driver.js cannot be loaded.
