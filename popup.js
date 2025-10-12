// =============================================================================
// Constants & DOM Selectors
// =============================================================================

// Use a class for clean DOM access, avoiding the generic '$' utility
class DOM {
    static get apiKey() { return document.getElementById('apiKey'); }
    static get prompt() { return document.getElementById('prompt'); }
    static get generateButton() { return document.getElementById('generate'); }
    static get predefinedTourContainer() { return document.getElementById('predefined-tours-container'); }
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
            console.log("Received response from background:", response, chrome.runtime);
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
// Predefined Tours Logic
// =============================================================================

/**
 * Fetches predefined tours based on the current tab URL.
 * @param {string} tabUrl - The URL of the current tab.
 */
async function fetchPredefinedTours(tabUrl) {
    try {
        const response = await sendMessageAsync({ type: 'PREDEFINED_TOURS', url: tabUrl });
        console.log("Predefined tours response:", response);
        if (response?.ok && response.tours && response.tours.length > 0) {
            populateTourSelect(response.tours);
        } else {
            console.warn('No predefined tours found for this URL.');
            // Optionally, display a message to the user
        }
    } catch (error) {
        console.error('Failed to fetch predefined tours:', error);
        // Optionally, display an error message to the user
    }
}

/**
 * Populates the tour select element with predefined tours.
 * @param {Array<string>} tours - An array of tour names.
 */
function populateTourSelect(tours) {
    console.log("Populating predefined tours:", tours);
    const selectElement = document.createElement('select');
    selectElement.id = 'predefinedTours';
    selectElement.innerHTML = '<option value="">Select a predefined tour</option>'; // Default option

    tours.forEach(tour => {
        const option = document.createElement('option');
        option.value = JSON.stringify(tour);
        option.textContent = tour.tourName;
        selectElement.appendChild(option);
    });

    // Insert the select element before the prompt input
    console.log("Appending predefined tour select to container:", DOM.predefinedTourContainer);
    DOM.predefinedTourContainer.style.display = 'block'; // Make container visible
    DOM.predefinedTourContainer.appendChild(selectElement);

    // Add an event listener to update the prompt when a tour is selected
    selectElement.addEventListener('change', async function () {
        console.log("Predefined tour selected:", this.value);
        if (this.value) {
            const selectedTour = JSON.parse(this.value);
            const tabId = (await getActiveTab()).id;
            console.log("Selected tour object:", selectedTour,);
            const renderMsg = { type: 'GEMINI_RESULT', result: selectedTour.steps }
            chrome.tabs.sendMessage(tabId, renderMsg);
            window.close();

        }
    });
}

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
 * Gets the current tab URL.
 */
async function getCurrentTabUrl() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs && tabs.length > 0) {
                resolve(tabs[0].url);
            } else {
                reject(new Error("Could not get current tab URL."));
            }
        });
    });
}


// =============================================================================
// Popup Initialization (Continued)
// =============================================================================

/**
 * Extended Popup Initialization, after basic elements are loaded.
 */
async function initializePopupExtended() {
    try {
        const tabUrl = await getCurrentTabUrl();
        await fetchPredefinedTours(tabUrl);
    } catch (error) {
        console.warn("Predefined tours initialization failed:", error);
        // Optionally, display a message to the user.
    }
}


// Call this after basic popup elements have been initialized.
initializePopupExtended();

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', initializePopup);