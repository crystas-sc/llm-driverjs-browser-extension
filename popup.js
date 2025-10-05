// =============================================================================
// Constants & DOM Selectors
// =============================================================================

// Use a class for clean DOM access, avoiding the generic '$' utility
class DOM {
    static get apiKey() { return document.getElementById('apiKey'); }
    static get prompt() { return document.getElementById('prompt'); }
    static get generateButton() { return document.getElementById('generate'); }
}

// =============================================================================
// Chrome Storage & Messaging Utilities
// =============================================================================

/**
 * Loads the saved Gemini API key from local storage.
 */
async function loadApiKey() {
    try {
        const data = await chrome.storage.local.get(['geminiApiKey']);
        if (data.geminiApiKey) {
            DOM.apiKey.value = data.geminiApiKey;
        }
    } catch (error) {
        console.error('Failed to load API key:', error);
    }
}

/**
 * Saves the API key to local storage.
 * @param {string} key - The API key to save.
 */
async function saveApiKey(key) {
    // The set method is implicitly a promise in MV3, but we keep it async/await for clarity
    await chrome.storage.local.set({ geminiApiKey: key });
}

/**
 * Sends a message to the background script and returns a Promise.
 * Handles the lastError property and converts the response into a standard Promise pattern.
 *
 * @param {Object} message - The message to send.
 * @returns {Promise<Object>} The response object from the background script.
 */
function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            // Check for connection/runtime errors first
            if (chrome.runtime.lastError) {
                return reject(new Error(`Runtime error: ${chrome.runtime.lastError.message}`));
            }
            
            // Check for logical errors defined in the background script's response
            if (response && response.ok === false) {
                return reject(new Error(response.error || 'Unknown generation failure.'));
            }

            // Successful response
            resolve(response);
        });
    });
}

// =============================================================================
// UI State and Logic
// =============================================================================

/**
 * Validates inputs and initiates the tour generation process.
 */
async function handleGenerateClick() {
    const button = DOM.generateButton;
    button.classList.add('loading'); // Show loading state

    try {
        const apiKey = DOM.apiKey.value.trim();
        const prompt = DOM.prompt.value.trim();

        // 1. Validation
        if (!apiKey) {
            alert('Please enter your Gemini API key.');
            return;
        }
        if (!prompt) {
            alert('Please enter a prompt describing the tour you want.');
            return;
        }

        // 2. Save Key
        await saveApiKey(apiKey);

        // 3. Send Message and Await Response
        await sendMessageAsync({ type: 'GENERATE_TOUR', prompt });

        // 4. Success: Close the window
        window.close();

    } catch (error) {
        // 5. Handle Errors
        console.error('Tour Generation Failed:', error);
        alert(`Failed to start generation: ${error.message}`);
    } finally {
        // 6. Cleanup (always remove loading state)
        button.classList.remove('loading');
    }
}

/**
 * Initializes the popup listeners and state.
 */
function initializePopup() {
    // Load previously saved key immediately
    loadApiKey();

    // Attach event listener to the generate button
    DOM.generateButton.addEventListener('click', handleGenerateClick);
}

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', initializePopup);