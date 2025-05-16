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
    // Execute script to click on a post
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        function: clickFirstArticle,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Error executing script:", chrome.runtime.lastError);
          return;
        }

        console.log("Article click script executed successfully");

        // Since the actual click happens after a timeout in the injected script,
        // we'll wait a bit longer before updating the streak
        setTimeout(() => {
          updateStreak();
        }, ARTICLE_LOAD_DELAY_MS + 1000); // Wait a bit longer than the delay in clickFirstArticle
      }
    );
  } catch (error) {
    console.error("Error clicking article:", error);
  }
}

/**
 * Function to be injected into the page to click the first article
 * @returns {boolean} Whether the click was successful
 */
function clickFirstArticle() {
  // Wait for content to load completely
  setTimeout(() => {
    try {
      // Find and click on the first post
      const posts = document.querySelectorAll("article");
      if (posts.length > 0) {
        const link = posts[0].querySelector("a");
        if (link) {
          link.click();
          console.log("Clicked on post to maintain streak");
          return true;
        } else {
          console.error("No link found in the first article");
          return false;
        }
      } else {
        console.error("No articles found on the page");
        return false;
      }
    } catch (error) {
      console.error("Error clicking article:", error);
      return false;
    }
  }, ARTICLE_LOAD_DELAY_MS);

  // Return true to indicate the script was executed
  // The actual click will happen asynchronously after the timeout
  return true;
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
 * Update the user's streak information
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
              `Streak ${streakStatus} and updated to ${newStreak} days`
            );

            // Show a notification that the streak has been maintained
            chrome.notifications.create({
              type: "basic",
              iconUrl: "../images/icon128.png",
              title: "Daily.dev Streak Maintained!",
              message:
                streakStatus === "continued"
                  ? `Great job! Your streak is now ${newStreak} days.`
                  : "You've maintained your streak for today!",
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
        // Determine notification message based on urgency
        const title = isUrgent
          ? "URGENT: Daily.dev Streak About to Expire!"
          : "Daily.dev Streak Reminder";

        const message = isUrgent
          ? "Your streak will expire soon! Open a new tab now to maintain your streak."
          : "Don't forget to visit daily.dev today to maintain your streak!";

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
        chrome.tabs.create({ url: DAILY_DEV_URL }, () => {
          if (chrome.runtime.lastError) {
            console.error("Error creating tab:", chrome.runtime.lastError);
            return;
          }
          console.log("Failsafe: Opened daily.dev tab to maintain streak");

          // The tab update listener will handle clicking on an article
          // and updating the streak once the page loads
        });
      } else {
        console.log("Failsafe check: Streak already maintained for today");
      }
    });
  } catch (error) {
    console.error("Error executing streak failsafe:", error);
  }
}
