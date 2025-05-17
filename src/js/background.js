/**
 * Daily.dev Streak Keeper - Background Script
 *
 * This script handles the core functionality of the extension:
 * - Automatically clicks on articles when visiting daily.dev (only if streak not maintained)
 * - Tracks and updates streak information
 * - Sends reminder notifications
 * - Implements failsafe mechanism to maintain streak automatically
 */

"use strict";

// Constants
const DAILY_DEV_URL = "https://app.daily.dev/";
const ARTICLE_LOAD_DELAY_MS = 2000;
const DAILY_CHECK_MINUTES = 1440; // 24 hours

// Reminder times
const FIRST_REMINDER_HOUR = 19; // 7:00 PM
const FIRST_REMINDER_MINUTE = 0;
const SECOND_REMINDER_HOUR = 22; // 10:00 PM
const SECOND_REMINDER_MINUTE = 0;

// Failsafe times
const FIRST_FAILSAFE_HOUR = 20; // 8:00 PM
const FIRST_FAILSAFE_MINUTE = 0;
const SECOND_FAILSAFE_HOUR = 22; // 10:15 PM
const SECOND_FAILSAFE_MINUTE = 15;

/**
 * Listen for tab updates to detect when daily.dev is loaded
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed if the page has fully loaded and is a daily.dev page
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("daily.dev")
  ) {
    handleDailyDevPageLoad(tabId);
  }
});

/**
 * Handle when a daily.dev page is loaded
 * @param {number} tabId - The ID of the tab that was updated
 */
function handleDailyDevPageLoad(tabId) {
  try {
    // Check if we've already completed the streak for today
    chrome.storage.local.get(["lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // Only click automatically if we haven't visited today yet
      if (!result.lastVisit || result.lastVisit !== today) {
        clickArticleAndUpdateStreak(tabId);
      } else {
        console.log("Streak already completed for today, not auto-clicking");
      }
    });
  } catch (error) {
    console.error("Error handling daily.dev page load:", error);
  }
}

/**
 * Click on an article and update the streak
 * @param {number} tabId - The ID of the tab to execute the script in
 */
function clickArticleAndUpdateStreak(tabId) {
  try {
    console.log("Attempting to click on an article in tab:", tabId);

    // Execute script to click on a post
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        function: clickFirstArticle,
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error("Error executing script:", chrome.runtime.lastError);
          return;
        }

        if (!results || !results[0] || !results[0].result) {
          console.error("No results returned from clickFirstArticle");
          return;
        }

        const status = results[0].result;
        console.log("Article click status:", status);

        // If we're already on an article page, update streak immediately
        if (
          status.clicked ||
          (status.articleUrl && status.articleUrl.includes("/posts/"))
        ) {
          console.log(
            "Article was clicked or already on article page, updating streak"
          );

          // If we successfully extracted a streak count from daily.dev, use it
          if (status.streakCount !== null && !isNaN(status.streakCount)) {
            console.log(
              "Using streak count from daily.dev:",
              status.streakCount
            );
            updateStreakWithCount(status.streakCount);
          } else {
            // Otherwise fall back to our internal tracking
            updateStreak();
          }
          return;
        }

        // If articles were found but click is happening asynchronously,
        // wait for the article page to load before updating streak
        if (status.articlesFound && status.linkFound) {
          console.log(
            "Article link found, waiting for page to load before updating streak"
          );

          // Set up a listener for when the tab navigates to an article page
          const articleLoadListener = (_, changeInfo, tab) => {
            if (
              changeInfo.status === "complete" &&
              tab.url &&
              tab.url.includes("/posts/")
            ) {
              console.log("Article page loaded:", tab.url);
              // Remove the listener once we've detected the article page
              chrome.tabs.onUpdated.removeListener(articleLoadListener);

              // Execute script to extract streak count from the article page
              chrome.scripting.executeScript(
                {
                  target: { tabId: tab.id },
                  function: extractStreakCountFromPage,
                },
                (results) => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "Error executing streak extraction script:",
                      chrome.runtime.lastError
                    );
                    // Fall back to internal tracking if extraction fails
                    updateStreak();
                    return;
                  }

                  if (
                    results &&
                    results[0] &&
                    results[0].result &&
                    !isNaN(results[0].result)
                  ) {
                    // Use the extracted streak count
                    console.log(
                      "Using streak count from article page:",
                      results[0].result
                    );
                    updateStreakWithCount(results[0].result);
                  } else {
                    // Fall back to internal tracking
                    updateStreak();
                  }
                }
              );
            }
          };

          // Add the listener
          chrome.tabs.onUpdated.addListener(articleLoadListener);

          // Set a timeout to remove the listener if the article doesn't load within 15 seconds
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(articleLoadListener);
            console.log("Removed article load listener after timeout");
          }, 15000);
        } else {
          console.error("Failed to find or click on an article:", status.error);
        }
      }
    );
  } catch (error) {
    console.error("Error clicking article:", error);
  }
}

/**
 * Function to be injected into the page to click the first article and extract streak count
 * This function is injected into the daily.dev page and attempts to find and click on an article
 * It also extracts the streak count from the daily.dev UI
 * @returns {object} Status object with information about the click attempt and streak count
 */
function clickFirstArticle() {
  // Create a status object to return detailed information about the click attempt
  const status = {
    articlesFound: false,
    linkFound: false,
    clicked: false,
    articleUrl: null,
    error: null,
    streakCount: null,
  };

  try {
    // Function to extract streak count from the daily.dev UI
    function extractStreakCount(statusObj) {
      try {
        // Try to find the streak element by ID first
        let streakElement = document.getElementById(
          "reading-streak-header-button"
        );

        // If not found by ID, try other selectors that might contain the streak count
        if (!streakElement) {
          const possibleSelectors = [
            '[data-testid="reading-streak-header-button"]',
            ".streak-counter",
            '[aria-label*="streak"]',
            '[title*="streak"]',
          ];

          for (const selector of possibleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              streakElement = element;
              break;
            }
          }
        }

        if (streakElement) {
          // Try to extract the number from the element
          const text = streakElement.textContent || streakElement.innerText;
          const matches = text.match(/\d+/);

          if (matches && matches.length > 0) {
            statusObj.streakCount = parseInt(matches[0], 10);
            console.log("Extracted streak count:", statusObj.streakCount);
          } else {
            // If we found the element but couldn't extract a number, check for attributes
            const ariaLabel = streakElement.getAttribute("aria-label");
            const title = streakElement.getAttribute("title");

            if (ariaLabel) {
              const ariaMatches = ariaLabel.match(/\d+/);
              if (ariaMatches && ariaMatches.length > 0) {
                statusObj.streakCount = parseInt(ariaMatches[0], 10);
                console.log(
                  "Extracted streak count from aria-label:",
                  statusObj.streakCount
                );
              }
            } else if (title) {
              const titleMatches = title.match(/\d+/);
              if (titleMatches && titleMatches.length > 0) {
                statusObj.streakCount = parseInt(titleMatches[0], 10);
                console.log(
                  "Extracted streak count from title:",
                  statusObj.streakCount
                );
              }
            }
          }
        }
      } catch (error) {
        console.error("Error extracting streak count:", error);
      }
    }

    // Try to extract the streak count from the daily.dev UI
    extractStreakCount(status);

    // Check if we're already on an article page (URL contains "/posts/")
    if (window.location.href.includes("/posts/")) {
      status.articlesFound = true;
      status.linkFound = true;
      status.clicked = true;
      status.articleUrl = window.location.href;
      console.log("Already on an article page:", status.articleUrl);
      return status;
    }

    // Wait for content to load and retry a few times if needed
    let retryCount = 0;
    const maxRetries = 5;

    const findAndClickArticle = () => {
      try {
        // Try different selectors that might match articles on daily.dev
        const selectors = [
          "article", // Standard article tag
          '[data-testid="post-card"]', // Post cards by test ID
          ".post-card", // Post cards by class
          ".card", // Generic cards
          'a[href*="/posts/"]', // Direct links to posts
        ];

        let articles = [];

        // Try each selector until we find articles
        for (const selector of selectors) {
          articles = document.querySelectorAll(selector);
          if (articles.length > 0) {
            console.log(
              `Found ${articles.length} articles using selector: ${selector}`
            );
            break;
          }
        }

        if (articles.length > 0) {
          status.articlesFound = true;

          // Find the first article with a valid link
          for (let i = 0; i < Math.min(articles.length, 5); i++) {
            const article = articles[i];

            // Try to find a link in the article
            let link = null;

            // If the article itself is a link
            if (
              article.tagName === "A" &&
              article.href &&
              article.href.includes("/posts/")
            ) {
              link = article;
            } else {
              // Otherwise look for links inside the article
              link =
                article.querySelector('a[href*="/posts/"]') ||
                article.querySelector("a");
            }

            if (link && link.href) {
              status.linkFound = true;
              status.articleUrl = link.href;

              // Scroll the article into view
              article.scrollIntoView({ behavior: "smooth", block: "center" });

              // Click the link
              setTimeout(() => {
                link.click();
                console.log("Clicked on article:", status.articleUrl);
                status.clicked = true;
              }, 500);

              return status;
            }
          }

          if (!status.linkFound) {
            console.error("No valid links found in any articles");
            status.error = "No valid links found";
          }
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(
              `No articles found yet, retrying (${retryCount}/${maxRetries})...`
            );
            setTimeout(findAndClickArticle, 1000);
          } else {
            console.error("No articles found after multiple attempts");
            status.error = "No articles found after multiple attempts";
          }
        }
      } catch (error) {
        console.error("Error in findAndClickArticle:", error);
        status.error = error.message;
      }

      return status;
    };

    return findAndClickArticle();
  } catch (error) {
    console.error("Error in clickFirstArticle:", error);
    status.error = error.message;
    return status;
  }
}

/**
 * Initialize extension when installed
 */
chrome.runtime.onInstalled.addListener(() => {
  try {
    // Initialize streak tracking
    chrome.storage.local.set(
      {
        streak: 0,
        lastVisit: null,
        streakMaintainedToday: false,
        syncedWithDailyDev: false,
        lastSyncTime: null,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error initializing storage:",
            chrome.runtime.lastError
          );
          return;
        }
        console.log("Streak tracking initialized");
      }
    );

    // Set up alarms
    setupAlarms();
  } catch (error) {
    console.error("Error during extension installation:", error);
  }
});

/**
 * Set up the reminder and failsafe alarms
 */
function setupAlarms() {
  try {
    // Create alarms for streak reminders (7:00 PM and 10:00 PM)
    chrome.alarms.create("firstStreakReminder", {
      periodInMinutes: DAILY_CHECK_MINUTES,
      when: getNextReminderTime(FIRST_REMINDER_HOUR, FIRST_REMINDER_MINUTE),
    });

    chrome.alarms.create("secondStreakReminder", {
      periodInMinutes: DAILY_CHECK_MINUTES,
      when: getNextReminderTime(SECOND_REMINDER_HOUR, SECOND_REMINDER_MINUTE),
    });

    // Create alarms for failsafe mechanisms (8:00 PM and 10:15 PM)
    chrome.alarms.create("firstStreakFailsafe", {
      periodInMinutes: DAILY_CHECK_MINUTES,
      when: getNextReminderTime(FIRST_FAILSAFE_HOUR, FIRST_FAILSAFE_MINUTE),
    });

    chrome.alarms.create("secondStreakFailsafe", {
      periodInMinutes: DAILY_CHECK_MINUTES,
      when: getNextReminderTime(SECOND_FAILSAFE_HOUR, SECOND_FAILSAFE_MINUTE),
    });

    console.log("Alarms set up successfully");
  } catch (error) {
    console.error("Error setting up alarms:", error);
  }
}

/**
 * Function to be injected into the page to extract the streak count
 * @returns {number|null} The extracted streak count or null if not found
 */
function extractStreakCountFromPage() {
  try {
    // Try to find the streak element by ID first
    let streakElement = document.getElementById("reading-streak-header-button");

    // If not found by ID, try other selectors that might contain the streak count
    if (!streakElement) {
      const possibleSelectors = [
        '[data-testid="reading-streak-header-button"]',
        ".streak-counter",
        '[aria-label*="streak"]',
        '[title*="streak"]',
      ];

      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          streakElement = element;
          break;
        }
      }
    }

    if (streakElement) {
      // Try to extract the number from the element
      const text = streakElement.textContent || streakElement.innerText;
      const matches = text.match(/\d+/);

      if (matches && matches.length > 0) {
        return parseInt(matches[0], 10);
      } else {
        // If we found the element but couldn't extract a number, check for attributes
        const ariaLabel = streakElement.getAttribute("aria-label");
        const title = streakElement.getAttribute("title");

        if (ariaLabel) {
          const ariaMatches = ariaLabel.match(/\d+/);
          if (ariaMatches && ariaMatches.length > 0) {
            return parseInt(ariaMatches[0], 10);
          }
        } else if (title) {
          const titleMatches = title.match(/\d+/);
          if (titleMatches && titleMatches.length > 0) {
            return parseInt(titleMatches[0], 10);
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error extracting streak count:", error);
    return null;
  }
}

/**
 * Update the streak with the count extracted from daily.dev
 * @param {number} streakCount - The streak count from daily.dev
 */
function updateStreakWithCount(streakCount) {
  try {
    chrome.storage.local.get(["lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // Determine if this is a new visit for today
      const isFirstVisitToday = !result.lastVisit || result.lastVisit !== today;

      // Update storage with the synced streak information
      chrome.storage.local.set(
        {
          streak: streakCount,
          lastVisit: today,
          streakMaintainedToday: true,
          syncedWithDailyDev: true,
          lastSyncTime: Date.now(),
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error updating storage:", chrome.runtime.lastError);
            return;
          }
          console.log(`Streak synced with daily.dev: ${streakCount} days`);

          // Only show notification if this is the first visit today
          if (isFirstVisitToday) {
            // Show a notification that the streak has been maintained
            chrome.notifications.create({
              type: "basic",
              iconUrl: "../images/icon128.png",
              title: "Daily.dev Streak Maintained!",
              message: `Your streak is now ${streakCount} days (synced with daily.dev). You won't receive any more reminders today.`,
              priority: 0,
            });
          }
        }
      );
    });
  } catch (error) {
    console.error("Error updating streak with count:", error);
  }
}

/**
 * Update the user's streak information using internal tracking
 * This is a fallback when we can't extract the streak count from daily.dev
 */
function updateStreak() {
  try {
    chrome.storage.local.get(["streak", "lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // If this is the first visit of the day
      if (!result.lastVisit || result.lastVisit !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayString = yesterday.toDateString();

        let newStreak = 1;
        let streakStatus = "started"; // For new streaks

        // If yesterday was the last visit, increment streak
        if (result.lastVisit === yesterdayString) {
          newStreak = result.streak + 1;
          streakStatus = "continued";
        } else if (result.lastVisit) {
          // If there was a previous visit but not yesterday, streak was broken
          streakStatus = "reset";
        }

        // Update storage with new streak information
        chrome.storage.local.set(
          {
            streak: newStreak,
            lastVisit: today,
            streakMaintainedToday: true,
            syncedWithDailyDev: false,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error updating storage:",
                chrome.runtime.lastError
              );
              return;
            }
            console.log(
              `Streak ${streakStatus} and updated to ${newStreak} days (internal tracking)`
            );

            // Show a notification that the streak has been maintained
            chrome.notifications.create({
              type: "basic",
              iconUrl: "../images/icon128.png",
              title: "Daily.dev Streak Maintained!",
              message:
                streakStatus === "continued"
                  ? `Great job! Your streak is now ${newStreak} days. You won't receive any more reminders today.`
                  : "You've maintained your streak for today! You won't receive any more reminders until tomorrow.",
              priority: 0,
            });
          }
        );
      } else {
        console.log("Streak already updated today, no changes needed");
      }
    });
  } catch (error) {
    console.error("Error updating streak:", error);
  }
}

/**
 * Get the timestamp for the next reminder with configurable time
 * @param {number} hour - Hour for the reminder (24-hour format)
 * @param {number} minute - Minute for the reminder
 * @returns {number} Timestamp for the next reminder
 */
function getNextReminderTime(hour = 23, minute = 0) {
  try {
    const now = new Date();
    const reminder = new Date();
    reminder.setHours(hour, minute, 0, 0);

    // If it's already past the specified time, schedule for tomorrow
    if (now > reminder) {
      reminder.setDate(reminder.getDate() + 1);
    }

    return reminder.getTime();
  } catch (error) {
    console.error("Error calculating reminder time:", error);
    // Return a default time (24 hours from now) in case of error
    return Date.now() + 24 * 60 * 60 * 1000;
  }
}

/**
 * Format a time in 24-hour format to a user-friendly string (e.g., "8:00 PM")
 * @param {number} hour - Hour in 24-hour format
 * @param {number} minute - Minute
 * @returns {string} Formatted time string
 */
function formatTime(hour, minute) {
  try {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);

    // Format the time as "h:mm A" (e.g., "8:00 PM")
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch (error) {
    console.error("Error formatting time:", error);
    return `${hour}:${minute < 10 ? "0" + minute : minute}`;
  }
}

/**
 * Handle alarm events
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  try {
    // Check if streak has been maintained before taking any action
    chrome.storage.local.get(["lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // Only proceed if streak hasn't been maintained today
      if (!result.lastVisit || result.lastVisit !== today) {
        // Handle different alarm types
        if (
          alarm.name === "firstStreakReminder" ||
          alarm.name === "secondStreakReminder"
        ) {
          // Send appropriate reminder notification based on which alarm triggered
          const isSecondReminder = alarm.name === "secondStreakReminder";
          checkStreakAndNotify(isSecondReminder);
        } else if (
          alarm.name === "firstStreakFailsafe" ||
          alarm.name === "secondStreakFailsafe"
        ) {
          // Execute failsafe mechanism
          executeStreakFailsafe();
        }
      } else {
        console.log(
          `Alarm ${alarm.name} triggered, but streak already maintained for today. No action needed.`
        );
      }
    });
  } catch (error) {
    console.error(`Error handling alarm ${alarm.name}:`, error);
  }
});

/**
 * Check if user has visited today and notify if not
 * @param {boolean} isUrgent - Whether this is the urgent (second) reminder
 */
function checkStreakAndNotify(isUrgent = false) {
  try {
    chrome.storage.local.get(["streak", "lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // Only send notification if streak hasn't been maintained today
      if (!result.lastVisit || result.lastVisit !== today) {
        // Get the next failsafe time based on which reminder this is
        const nextFailsafeHour = isUrgent
          ? SECOND_FAILSAFE_HOUR
          : FIRST_FAILSAFE_HOUR;
        const nextFailsafeMinute = isUrgent
          ? SECOND_FAILSAFE_MINUTE
          : FIRST_FAILSAFE_MINUTE;

        // Format the time for display (e.g., "8:00 PM" or "10:15 PM")
        const failsafeTimeString = formatTime(
          nextFailsafeHour,
          nextFailsafeMinute
        );

        // Determine notification message based on urgency
        const title = isUrgent
          ? "URGENT: Daily.dev Streak About to Expire!"
          : "Daily.dev Streak Reminder";

        const message = isUrgent
          ? `Your streak will expire soon! The extension will automatically maintain your streak at ${failsafeTimeString} if you don't visit daily.dev before then.`
          : `Don't forget to visit daily.dev today to maintain your streak! A failsafe will activate at ${failsafeTimeString} if needed.`;

        // Show reminder notification
        chrome.notifications.create(
          {
            type: "basic",
            iconUrl: "../images/icon128.png",
            title: title,
            message: message,
            priority: isUrgent ? 2 : 1,
          },
          (notificationId) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error creating notification:",
                chrome.runtime.lastError
              );
              return;
            }
            console.log(
              `${isUrgent ? "Urgent" : "Regular"} reminder notification sent:`,
              notificationId
            );
          }
        );
      } else {
        console.log(
          "Streak already maintained for today, no notification needed"
        );
      }
    });
  } catch (error) {
    console.error("Error checking streak and notifying:", error);
  }
}

/**
 * Failsafe function to automatically open daily.dev and maintain streak
 * if user hasn't done so by the failsafe time
 */
function executeStreakFailsafe() {
  try {
    chrome.storage.local.get(["streak", "lastVisit"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error accessing storage:", chrome.runtime.lastError);
        return;
      }

      const today = new Date().toDateString();

      // Double-check that streak hasn't been maintained today
      if (!result.lastVisit || result.lastVisit !== today) {
        console.log("Executing streak failsafe mechanism");

        // Create a new tab with daily.dev
        chrome.tabs.create({ url: DAILY_DEV_URL }, (tab) => {
          if (chrome.runtime.lastError) {
            console.error("Error creating tab:", chrome.runtime.lastError);
            return;
          }
          console.log("Failsafe: Opened daily.dev tab to maintain streak");

          // Set up a listener to wait for the tab to fully load
          const tabLoadListener = (tabId, changeInfo, _) => {
            // Only proceed if this is our tab and it's fully loaded
            if (tabId === tab.id && changeInfo.status === "complete") {
              console.log(
                "Failsafe: daily.dev page loaded, attempting to click on article"
              );

              // Remove this listener as we don't need it anymore
              chrome.tabs.onUpdated.removeListener(tabLoadListener);

              // Wait a moment for the page to render before trying to click
              setTimeout(() => {
                // The tab is loaded, now try to click on an article
                clickArticleAndUpdateStreak(tab.id);
              }, 1000);
            }
          };

          // Add the listener
          chrome.tabs.onUpdated.addListener(tabLoadListener);

          // Set a timeout to remove the listener if something goes wrong
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(tabLoadListener);
          }, 30000); // 30 seconds timeout
        });
      } else {
        console.log("Failsafe check: Streak already maintained for today");
      }
    });
  } catch (error) {
    console.error("Error executing streak failsafe:", error);
  }
}
