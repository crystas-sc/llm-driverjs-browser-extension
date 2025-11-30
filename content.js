// =============================================================================
// Constants
// =============================================================================


// Message types for clear communication between scripts
const MESSAGE_TYPE = {
    REQUEST_PAGE_CONTEXT: 'REQUEST_PAGE_CONTEXT',
    GEMINI_RESULT: 'GEMINI_RESULT',
};

// Tags of elements to include in the context snippet sent to Gemini
const CONTEXT_ELEMENT_TAGS = ['A', 'BUTTON'];

// =============================================================================
// DOM Utility Functions
// =============================================================================

/**
 * Removes all <svg> tags and their contents from an HTML string.
 * @param {string} htmlString - The input HTML string.
 * @returns {string} The HTML string without SVGs.
 */
function removeSvgFromHtml(htmlString) {
    // Regex to find and remove the entire <svg> tag and its contents globally
    const svgRegex = /<svg[^>]*>[\s\S]*?<\/svg>/g;
    return htmlString.replace(svgRegex, '');
}

/**
 * Gathers a concise snapshot of the current page's context (interactive elements).
 * @returns {{ title: string, url: string, textSnippet: string | null, timestamp: number }}
 */
function getPageContext() {
    try {
        const targetElements = Array.from(
            document.body.querySelectorAll(CONTEXT_ELEMENT_TAGS.join(','))
        );

        // Map the selected elements to their outerHTML, clean SVGs, and join them
        const textSnippet = targetElements
            .map(x => removeSvgFromHtml(x.outerHTML))
            .join('\n')
            .trim();

        return {
            title: document.title,
            url: location.href,
            textSnippet: textSnippet || null, // send null if no interactive elements found
            timestamp: Date.now(),
        };
    } catch (err) {
        console.error('Error generating page context:', err);
        // Provide minimal context even on failure
        return {
            title: document.title,
            url: location.href,
            textSnippet: null,
            timestamp: Date.now(),
        };
    }
}

// =============================================================================
// Driver.js Integration
// =============================================================================

/**
 * Normalizes an array of step objects into the format expected by Driver.js.
 * @param {Array<Object>} steps - Steps from the Gemini result, e.g., { selector, title, description }.
 * @returns {Array<Object>} Normalized steps for Driver.js, e.g., { element, popover: { title, description } }.
 */
function normalizeDriverSteps(steps, getDriverObj) {
    return steps.map((s, stepIndex) => {
        let step = {
            // Use 'element' or 'selector' for the DOM target
            element: s.xpath ? () => getElementByXPath(s.xpath) : s.element || s.selector || null,
            popover: s.popover || {
                title: s.title || '',
                description: s.description || ''
            }
        };

        if (s.waitForInput) {
            const checkInput = () => {
                const element = getElementByXPath(s.xpath);
                if (element) {
                    // Inject input value if provided
                    if (s.inputValue) {
                        element.value = s.inputValue;
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    element.addEventListener('blur', () => {
                        const nextBtn = document.querySelector('.driver-popover-next-btn');
                        if (nextBtn) {
                            nextBtn.style.display = 'inline-block';
                        }
                        setTimeout(() => {
                            getDriverObj().moveTo(stepIndex + 1);
                        }, 500);
                    }, { once: true });
                }
            };
            step.onHighlightStarted = checkInput;
        }

        if (s.nextActions && Array.isArray(s.nextActions)) {
            step.popover.onNextClick = () => {
                s.nextActions.forEach(action => {
                    if (action.action === 'click' && action.xpath) {
                        const element = getElementByXPath(action.xpath);
                        if (element) {
                            element.click();
                            setTimeout(() => {
                                getDriverObj().moveNext();
                            }, 500);
                        }
                    }
                });
            };
        }

        return step;
    });
}

function getElementByXPath(xpath) {
    return document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
    ).singleNodeValue;
}

/**
 * Runs the tour using Driver.js. Loads assets, normalizes steps, and starts the tour.
 * @param {Array<Object>} steps - The tour steps provided by the background script.
 */
async function runDriverjs(steps) {
    let driverObj;

    // 1. Normalize and check steps
    const normalizedSteps = normalizeDriverSteps(steps, () => driverObj);
    if (normalizedSteps.length === 0) {
        console.warn('Attempted to run Driver.js with no steps.');
        return;
    }

    // 2. Run Driver.js
    try {
        // Check for the exposed global API (driver.js.driver)
        if (typeof window.driver !== 'undefined' && typeof window.driver.js.driver === 'function') {
            driverObj = window.driver.js.driver({
                animate: false,
                showProgress: false,
                keyboardControl: true,
                showButtons: ['next', 'previous', 'close'],
                steps: normalizedSteps
            });

            if (driverObj && typeof driverObj.drive === 'function') {
                driverObj.drive();
                return;
            }
        } else {
            console.warn('Driver.js global API not found after loading script.');
        }

    } catch (err) {
        // Catch initialization errors from driver.js itself
        console.error('Error executing Driver.js tour:', err);
    }
}

// =============================================================================
// Message Handling
// =============================================================================

/**
 * Main listener for messages from the extension background script.
 * @param {Object} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {function(*):void} sendResponse
 * @returns {boolean} - True to indicate an asynchronous response is pending.
 */
function handleMessages(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    // A. Handle Page Context Request
    if (message.type === MESSAGE_TYPE.REQUEST_PAGE_CONTEXT) {
        const pageContext = getPageContext();
        sendResponse({ pageContext });
        // Returning false indicates the response is sent synchronously
        return false;
    }

    // B. Handle Gemini Result for Tour
    if (message.type === MESSAGE_TYPE.GEMINI_RESULT) {
        // Use an async IIFE to manage asynchronous tour execution
        (async () => {
            try {
                console.log('Content script received message:', message);
                const steps = message.result;

                if (!Array.isArray(steps) || steps.length === 0) {
                    console.warn('Received Gemini result but no valid steps were found.');
                    sendResponse({ ok: false, error: 'No tour steps found in Gemini response.' });
                    return;
                }

                await runDriverjs(steps);
                sendResponse({ ok: true });

            } catch (err) {
                console.error('Content script error rendering tour:', err);
                sendResponse({
                    ok: false,
                    error: `Content script failed to render tour: ${err.message}`
                });
            }
        })();

        // Return true to indicate that `sendResponse` will be called later
        return true;
    }

    return false;
}

// Attach the main message listener
chrome.runtime.onMessage.addListener(handleMessages);