import { generateTour, getPredefinedTours } from './ai-service.js';


// =============================================================================
// Constants and Utilities
// =============================================================================

const MESSAGE_TYPE = {
    GENERATE_TOUR: 'GENERATE_TOUR',
    PREDEFINED_TOURS: 'PREDEFINED_TOURS',
    PREDEFINED_TOURS_RESULT: 'PREDEFINED_TOURS_RESULT',
    REQUEST_PAGE_CONTEXT: 'REQUEST_PAGE_CONTEXT',
    GEMINI_RESULT: 'GEMINI_RESULT',
};

// Error check for when the content script hasn't loaded yet
const isMissingReceiverError = (error) =>
    error && (error.message.includes('Could not establish connection') || error.message.includes('Receiving end does not exist'));

/**
 * Promisified wrapper for chrome.tabs.query to get the active tab.
 * @returns {Promise<chrome.tabs.Tab>} The active tab object.
 */
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log("Active tabs:", tabs);
    const tab = tabs?.[0];
    if (!tab || !tab.id) {
        throw new Error('No active tab found or tab is invalid.');
    }
    return tab;
}

/**
 * Promisified wrapper for chrome.tabs.sendMessage with built-in content script injection retry.
 * @param {number} tabId
 * @param {Object} message
 * @returns {Promise<Object>} The response from the content script.
 */
async function sendMessageWithInjectionRetry(tabId, message) {
    try {
        // 1. Initial attempt
        return await chrome.tabs.sendMessage(tabId, message);

    } catch (initialError) {
        if (!isMissingReceiverError(initialError)) {
            throw new Error(`SendMessage failed: ${initialError.message}`);
        }

        console.log(`Content script missing in Tab ${tabId}. Attempting injection...`);

        // 2. Attempt injection (requires "scripting" permission)
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
            console.log('Injection successful. Retrying message...');

            // 3. Retry sendMessage
            return await chrome.tabs.sendMessage(tabId, message);

        } catch (injectionError) {
            throw new Error(`Failed to inject content script or retry message failed: ${injectionError.message}`);
        }
    }
}

/**
 * Retrieves the Gemini API key from local storage (Promisified).
 * @returns {Promise<string>} The API key.
 */
async function getApiKey() {
    const data = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = data?.geminiApiKey;
    if (!apiKey) {
        throw new Error('No Gemini API key saved in extension storage. Please set it in the options.');
    }
    return apiKey;
}

// =============================================================================
// Message Handler: GENERATE_TOUR
// =============================================================================

/**
 * Handles the 'GENERATE_TOUR' request, orchestrating context fetching, AI calling, and result rendering.
 * @param {Object} message - The incoming message containing the user prompt.
 * @param {function(*):void} sendResponse - The callback to send the final response.
 */
async function handleGenerateTour(message, sendResponse) {
    try {
        // 1. Setup: Get active tab and API Key
        const tab = await getActiveTab();
        const tabId = tab.id;
        const apiKey = await getApiKey();

        // 2. Get Page Context from Content Script (with injection retry)
        const contextMsg = { type: MESSAGE_TYPE.REQUEST_PAGE_CONTEXT, prompt: message.prompt };
        const pageContextResp = await sendMessageWithInjectionRetry(tabId, contextMsg);
        const pageContext = pageContextResp?.pageContext || {};

        // 3. Call the AI Service
        let apiResp;
        try {
            apiResp = await generateTour(apiKey, message.prompt, pageContext);
        } catch (err) {
            console.error('Background: AI service call failed.', err);
            throw new Error(`AI generation failed: ${err.message || err}`);
        }

        // 4. Send Structured Result to Content Script for Rendering
        const renderMsg = { type: MESSAGE_TYPE.GEMINI_RESULT, result: apiResp };
        await sendMessageWithInjectionRetry(tabId, renderMsg);

        // 5. Final success response
        sendResponse({ ok: true });

    } catch (error) {
        // Centralized error handling
        console.error('GENERATE_TOUR process failed:', error);
        sendResponse({
            ok: false,
            error: error.message || 'An unknown error occurred during tour generation.'
        });
    }
}

// =============================================================================
// Main Listener
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only process the one remaining message type
    if (message?.type === MESSAGE_TYPE.GENERATE_TOUR) {
        handleGenerateTour(message, sendResponse);
        // Return true to indicate the response will be sent asynchronously
        return true;
    }

    if (message?.type === MESSAGE_TYPE.PREDEFINED_TOURS) {
        handlePredefinedTours(message, sendResponse);
        // Return true to indicate the response will be sent asynchronously
        return true;
    }

    return false;
});

async function handlePredefinedTours(message, sendResponse) {
    try {



        const resp = await getPredefinedTours(message.url);
        sendResponse({ ok: true, tours: resp });




    } catch (error) {
        // Centralized error handling
        console.error('PREDEFINED_TOURS process failed:', error);
        sendResponse({
            ok: false,
            error: error.message || 'An unknown error occurred during tour generation.'
        });
    }
}
