/**
 * Daily.dev Streak Keeper - Popup Script
 *
 * This script handles the popup UI functionality:
 * - Displays the current streak count
 * - Shows whether the streak has been maintained today
 * - Provides a button to visit daily.dev if needed
 */

"use strict";

/**
 * Initialize the popup when the DOM is fully loaded
 */
document.addEventListener("DOMContentLoaded", () => {
  initializePopup();
});

/**
 * Initialize the popup UI with streak information
 */
function initializePopup() {
  try {
    // Get streak information from storage
    chrome.storage.local.get(["streak", "lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        showError("Could not access streak information");
        return;
      }

      updateStreakDisplay(result);
    });
  } catch (error) {
    console.error("Error initializing popup:", error);
    showError("An error occurred while loading the popup");
  }
}

/**
 * Update the streak display with the current streak information
 * @param {Object} streakData - Object containing streak and lastVisit data
 */
function updateStreakDisplay(streakData) {
  try {
    // Set streak count
    const streakCount = streakData.streak || 0;
    document.getElementById("streak-count").textContent = streakCount;

    // Get today's date for comparison
    const today = new Date().toDateString();
    const statusEl = document.getElementById("status-message");

    // Check if streak has been maintained today
    if (streakData.lastVisit === today) {
      updateStatusForCompletedStreak(statusEl);
    } else {
      updateStatusForIncompleteStreak(statusEl);
    }
  } catch (error) {
    console.error("Error updating streak display:", error);
    showError("Could not display streak information");
  }
}

/**
 * Update the status message for a completed streak
 * @param {HTMLElement} statusElement - The status message element
 */
function updateStatusForCompletedStreak(statusElement) {
  statusElement.textContent = "You've maintained your streak today!";
  statusElement.classList.add("status-success");
}

/**
 * Update the status message for an incomplete streak
 * @param {HTMLElement} statusElement - The status message element
 */
function updateStatusForIncompleteStreak(statusElement) {
  statusElement.textContent = "You need to visit daily.dev today!";
  statusElement.classList.add("status-warning");

  // Add a button to visit daily.dev
  const visitButton = createVisitButton();

  statusElement.appendChild(document.createElement("br"));
  statusElement.appendChild(visitButton);
}

/**
 * Create a button to visit daily.dev
 * @returns {HTMLButtonElement} The created button
 */
function createVisitButton() {
  const visitButton = document.createElement("button");
  visitButton.textContent = "Visit daily.dev now";
  visitButton.className = "btn btn-block";

  visitButton.addEventListener("click", () => {
    try {
      chrome.tabs.create({ url: "https://app.daily.dev/" });
      window.close();
    } catch (error) {
      console.error("Error opening daily.dev tab:", error);
      showError("Could not open daily.dev");
    }
  });

  return visitButton;
}

/**
 * Display an error message in the popup
 * @param {string} message - The error message to display
 */
function showError(message) {
  const statusEl = document.getElementById("status-message");
  if (statusEl) {
    statusEl.textContent = `Error: ${message}`;
    statusEl.classList.add("status-warning");
  }
}
