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
async function populateTourSelect(tours) {
    console.log("Populating predefined tours:", tours);

    DOM.predefinedTourContainer.innerHTML = ''; // Clear previous content
    DOM.predefinedTourContainer.style.display = 'block'; // Make container visible

    if (tours.length === 1) {
        const tour = tours[0];

        const header = document.createElement('h3');
        const url = new URL((await getActiveTab()).url);
        header.innerHTML = `Predefined tour on <span style="color: #4285F4;">${url.hostname}</span>`;
        header.style.marginBottom = '10px';
        DOM.predefinedTourContainer.appendChild(header);

        const button = document.createElement('button');
        button.textContent = `Start: ${tour.tourName}`;
        button.className = 'secondary-button';
        button.style.width = '100%';
        button.style.marginBottom = '10px';

        button.addEventListener('click', async function () {
            const originalText = button.textContent;
            button.textContent = 'Starting...';
            button.disabled = true;

            try {
                const tabId = (await getActiveTab()).id;
                const prompt = DOM.prompt.value.trim();
                let stepsToRun = tour.steps;

                if (tour.formInputs && Object.keys(tour.formInputs).length > 0 && prompt) {
                    button.textContent = 'Processing Inputs...';
                    console.log("Filling form inputs with prompt:", prompt);
                    const response = await sendMessageAsync({
                        type: 'FILL_FORM_INPUTS',
                        tour: tour,
                        prompt: prompt
                    });

                    if (response && response.ok && response.steps) {
                        stepsToRun = response.steps;
                    }
                }

                console.log("Starting tour with steps:", stepsToRun);
                const renderMsg = { type: 'GEMINI_RESULT', result: stepsToRun };
                chrome.tabs.sendMessage(tabId, renderMsg);
                window.close();
            } catch (error) {
                console.error("Failed to start tour:", error);
                button.textContent = originalText;
                button.disabled = false;
                alert(`Failed to start tour: ${error.message}`);
            }
        });

        DOM.predefinedTourContainer.appendChild(button);
    } else {
        const selectElement = document.createElement('select');
        selectElement.id = 'predefinedTours';
        selectElement.innerHTML = '<option value="">Select a predefined tour</option>';

        tours.forEach(tour => {
            const option = document.createElement('option');
            option.value = JSON.stringify(tour);
            option.textContent = tour.tourName;
            selectElement.appendChild(option);
        });

        DOM.predefinedTourContainer.appendChild(selectElement);

        selectElement.addEventListener('change', async function () {
            console.log("Predefined tour selected:", this.value);
            if (this.value) {
                const selectedTour = JSON.parse(this.value);
                const tabId = (await getActiveTab()).id;
                console.log("Selected tour object:", selectedTour);
                const renderMsg = { type: 'GEMINI_RESULT', result: selectedTour.steps };
                chrome.tabs.sendMessage(tabId, renderMsg);
                window.close();
            }
        });
    }
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