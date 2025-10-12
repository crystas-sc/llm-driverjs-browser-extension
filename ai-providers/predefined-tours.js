export async function getPredefinedTourForURL(url) {
    const storedSteps = await fetch(chrome.runtime.getURL('data/stored-steps.json'))
        .then(response => response.json())

    console.log("Loaded predefined tours:", storedSteps);
    const matchingSteps = storedSteps.filter(step => url.includes(step.url));

    return matchingSteps;
}
