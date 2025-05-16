/**
 * Daily.dev Streak Keeper - New Tab Script
 *
 * This script handles the new tab page functionality:
 * - Checks if the daily streak has been maintained
 * - Redirects to daily.dev if the streak hasn't been maintained yet
 * - Shows a message and button if the streak has already been maintained
 */

"use strict";

// Constants
const DAILY_DEV_URL = "https://app.daily.dev/";
const REDIRECT_DELAY_MS = 1000;

/**
 * Initialize the new tab page when the window loads
 */
window.onload = function () {
  initializeNewTab();
};

/**
 * Initialize the new tab page based on streak status
 */
function initializeNewTab() {
  try {
    // Check if we need to redirect to daily.dev
    chrome.storage.local.get(["lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        showError("Could not check streak status");
        return;
      }

      const today = new Date().toDateString();

      // Determine if streak has been maintained today
      if (!result.lastVisit || result.lastVisit !== today) {
        handleIncompleteStreak();
      } else {
        handleCompletedStreak();
      }
    });
  } catch (error) {
    console.error("Error initializing new tab:", error);
    showError("An error occurred while loading the page");
  }
}

/**
 * Handle the case when the streak hasn't been maintained yet
 */
function handleIncompleteStreak() {
  try {
    // Show message about redirecting
    const loadingElement = document.getElementById("loading");
    if (loadingElement) {
      loadingElement.textContent =
        "Redirecting to daily.dev to maintain your streak...";
    }

    // Redirect to daily.dev after a brief delay
    setTimeout(() => {
      window.location.href = DAILY_DEV_URL;
    }, REDIRECT_DELAY_MS);
  } catch (error) {
    console.error("Error handling incomplete streak:", error);
    showError("Could not redirect to daily.dev");
  }
}

/**
 * Handle the case when the streak has already been maintained
 */
function handleCompletedStreak() {
  try {
    // Update the loading message
    const loadingElement = document.getElementById("loading");
    if (loadingElement) {
      loadingElement.textContent =
        "You've already maintained your streak today!";
    }

    // Hide the spinner
    const spinnerElement = document.querySelector(".spinner");
    if (spinnerElement) {
      spinnerElement.style.display = "none";
    }

    // Add a button to visit daily.dev anyway
    addVisitButton();
  } catch (error) {
    console.error("Error handling completed streak:", error);
    showError("Could not update the page");
  }
}

/**
 * Add a button to visit daily.dev
 */
function addVisitButton() {
  const container = document.querySelector(".newtab-container");
  if (!container) return;

  const visitButton = document.createElement("button");
  visitButton.textContent = "Visit daily.dev anyway";
  visitButton.className = "btn";
  visitButton.style.marginTop = "20px";

  visitButton.addEventListener("click", () => {
    try {
      window.location.href = DAILY_DEV_URL;
    } catch (error) {
      console.error("Error navigating to daily.dev:", error);
      showError("Could not navigate to daily.dev");
    }
  });

  container.appendChild(visitButton);
}

/**
 * Display an error message on the page
 * @param {string} message - The error message to display
 */
function showError(message) {
  const loadingElement = document.getElementById("loading");
  if (loadingElement) {
    loadingElement.textContent = `Error: ${message}`;
    loadingElement.style.color = "#721c24";
    loadingElement.style.backgroundColor = "#f8d7da";
    loadingElement.style.padding = "10px";
    loadingElement.style.borderRadius = "4px";
  }

  const spinnerElement = document.querySelector(".spinner");
  if (spinnerElement) {
    spinnerElement.style.display = "none";
  }
}
