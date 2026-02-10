importScripts('shared.js');

let NOTES_URL = "https://www.doximity.com/scribe/visit_notes/";
let lastNoteIds = [];
let pollingInterval = 60000;

// Listen for a message from the popup/options page to set the URL
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  debugLog("Background onMessage - received message:", msg.type, "with data:", JSON.stringify(msg));

  if (msg.type === "SET_NOTES_URL" && msg.url) {
    NOTES_URL = msg.url;
    lastNoteIds = [];
    syncNoteIds();
    sendResponse({ status: "ok" });
  }

  if (msg.type === "UPDATE_MIC_ICON") {
    debugLog("UPDATE_MIC_ICON received:", msg);
    updateBadgeForMicState(msg.micActive, msg.isResume);
    sendResponse({ success: true });
    return;
  }

  if (msg.type === "NEW_MESSAGE") {
    debugLog("NEW_MESSAGE received in background script");
    debugLog("Sender:", sender.tab ? sender.tab.url : "non-tab sender");

    chrome.action.setBadgeText({ text: "NEW" });
    chrome.action.setBadgeBackgroundColor({ color: "#2C90ED" });
    chrome.action.setTitle({ title: "New message detected!" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon-48.png",
      title: "New Dictation Detected",
      message: "A new dictation was detected in Doximity Scribe"
    }, (notificationId) => {
      debugLog("Notification created with ID:", notificationId);
      if (chrome.runtime.lastError) {
        console.error("Error creating notification:", chrome.runtime.lastError);
      }
    });

    // Sync note IDs so polling doesn't re-notify for this note
    setTimeout(() => syncNoteIds(), 1500);

    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true;
  }
});

// Silently sync lastNoteIds so we stay up to date without firing notifications.
// Notifications are only triggered by the NEW_MESSAGE path from the MutationObserver.
function syncNoteIds() {
  debugLog("syncNoteIds - Syncing note IDs");

  findDoximityTab((tab) => {
    if (!tab) return;

    chrome.tabs.get(tab.id, (updatedTab) => {
      if (chrome.runtime.lastError || updatedTab.status !== "complete") return;

      chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) return;

        const data = response.data;
        const notes = (data.props && data.props.visit_notes) || [];

        if (notes.length === 0) return;

        const noteIds = notes.map(n => n.uuid);
        debugLog("syncNoteIds - Updated lastNoteIds, count:", noteIds.length);
        lastNoteIds = noteIds;

        // Send to DotExpander if a new note appeared and integration is enabled
        if (lastNoteIds.length > 0) {
          const newNote = notes[0];
          chrome.storage.sync.get(['dotExpanderIntegrationEnabled', 'dotExpanderExtensionId'], function(result) {
            if (!result.dotExpanderIntegrationEnabled) return;

            const dictationContent = newNote?.body || newNote?.content || newNote?.note_label || "No content available";

            let noteTimestamp = Date.now();
            const potentialTsField = newNote?.created_at || newNote?.timestamp;

            if (potentialTsField) {
              if (typeof potentialTsField === 'string') {
                const parsedTs = Date.parse(potentialTsField);
                if (!isNaN(parsedTs)) noteTimestamp = parsedTs;
              } else if (typeof potentialTsField === 'number') {
                noteTimestamp = potentialTsField < 1e10 ? potentialTsField * 1000 : potentialTsField;
              }
            }

            const targetExtensionId = result.dotExpanderExtensionId || 'ljlmfclhdpcppglkaiieomhmpnfilagd';
            chrome.runtime.sendMessage(targetExtensionId, {
              type: 'SEND_VARIABLES',
              variables: {
                dictation: { value: dictationContent, timestamp: noteTimestamp }
              }
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("Error sending to DotExpander:", chrome.runtime.lastError.message);
              } else {
                debugLog("DotExpander response:", response);
              }
            });
          });
        }
      });
    });
  });
}

// On startup, close any existing Doximity tabs and reopen Scribe as a pinned background tab.
// This ensures a clean pinned state every time Chrome or the extension starts.
function openScribeHomeAsPinnedTab() {
  chrome.tabs.query({}, (tabs) => {
    const scribeHomeUrl = 'https://www.doximity.com/scribe/home';
    const doximityTabs = tabs.filter(tab => tab.url && tab.url.includes('doximity.com'));
    doximityTabs.forEach(tab => chrome.tabs.remove(tab.id));

    chrome.tabs.create({ url: scribeHomeUrl, pinned: true, active: false }, function(tab) {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, updatedTab) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          syncNoteIds();
        }
      });
    });
  });
}

// Run this on extension load
openScribeHomeAsPinnedTab();

// Use chrome.alarms instead of setInterval (MV3 service workers can be suspended)
debugLog("Setting up chrome.alarms for polling");
chrome.alarms.create('checkNotes', { periodInMinutes: 1 });
chrome.alarms.create('checkMicState', { periodInMinutes: 0.5 });

let micCheckTimeout = null;

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkNotes') {
    syncNoteIds();
  } else if (alarm.name === 'checkMicState') {
    checkMicStateAndUpdateIcon();
  }
});

function scheduleFastMicCheck() {
  clearTimeout(micCheckTimeout);
  micCheckTimeout = setTimeout(checkMicStateAndUpdateIcon, 5000);
}

function checkMicStateAndUpdateIcon() {
  clearTimeout(micCheckTimeout);
  findDoximityTab((tab) => {
    if (!tab) {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Scribe Message Watcher" });
      return;
    }

    if (!tab.url || !tab.url.includes('/scribe/visits/')) {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Scribe Message Watcher" });
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (response && response.success) {
        if (response.micActive) {
          updateBadgeForMicState(true, false);
          scheduleFastMicCheck();
        } else if (response.isResume) {
          updateBadgeForMicState(false, true);
          scheduleFastMicCheck();
        } else {
          updateBadgeForMicState(false, false);
        }
      }
    });
  });
}

// Optional: clear badge when icon is clicked
chrome.action.onClicked.addListener(() => {
  debugLog("Extension icon clicked, clearing badge");
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "No new messages" });
});

// Listen for the global keyboard shortcut to toggle the microphone
chrome.commands.onCommand.addListener(function(command) {
  if (command === 'toggle-microphone') {
    function updateIconFromResponse(response) {
      if (response && response.success) {
        updateBadgeForMicState(response.micActive, response.isResume);
        debugLog('Icon updated immediately after toggle:', response.clicked);
      }
    }

    chrome.tabs.query({}, (tabs) => {
      let visitsTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
      if (visitsTab) {
        chrome.tabs.sendMessage(visitsTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
      } else {
        visitsTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
        if (visitsTab) {
          chrome.tabs.sendMessage(visitsTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
        } else {
          let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe'));
          if (scribeTab) {
            chrome.tabs.update(scribeTab.id, { url: 'https://www.doximity.com/scribe/visits/new' }, function() {
              chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId === scribeTab.id && changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  setTimeout(() => {
                    chrome.tabs.sendMessage(scribeTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
                  }, 1000);
                }
              });
            });
          } else {
            chrome.tabs.create({ url: 'https://www.doximity.com/scribe/visits/new', active: false }, function(newTab) {
              chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId === newTab.id && changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  setTimeout(() => {
                    chrome.tabs.sendMessage(newTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
                  }, 1000);
                }
              });
            });
          }
        }
      }
    });
  }
  else if (command === 'trigger-generate-note') {
    chrome.tabs.query({}, (tabs) => {
      let targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
      if (!targetTab) {
        targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
      }

      if (targetTab) {
        debugLog("Alt+G: Sending CLICK_GENERATE_NOTE_BUTTON to tab " + targetTab.id);
        chrome.tabs.sendMessage(targetTab.id, { type: 'CLICK_GENERATE_NOTE_BUTTON' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Alt+G Error sending message to tab " + targetTab.id + ": " + chrome.runtime.lastError.message);
          } else if (response && !response.success) {
            console.warn("Alt+G: Generate Note button likely not found in tab " + targetTab.id + ". Error: " + response.error);
          } else {
            debugLog("Alt+G: CLICK_GENERATE_NOTE_BUTTON success response from tab " + targetTab.id + ":", response);
            chrome.action.setBadgeText({ text: '\u2713' }); // ✓
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
            chrome.action.setTitle({ title: 'Scribe Message Watcher - Generating Note' });
            setTimeout(() => {
              chrome.action.setBadgeText({ text: '' });
              chrome.action.setTitle({ title: 'Scribe Message Watcher' });
            }, 3000);
          }
        });
      } else {
        console.warn('Alt+G: No suitable Doximity Scribe tab found (visits/).');
      }
    });
  }
  else if (command === 'trigger-cancel-recording') {
    chrome.tabs.query({}, (tabs) => {
      let targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
      if (!targetTab) {
        targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
      }

      if (targetTab) {
        debugLog("Alt+C: Sending CLICK_CANCEL_BUTTON to tab " + targetTab.id);
        chrome.tabs.sendMessage(targetTab.id, { type: 'CLICK_CANCEL_BUTTON' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Alt+C Error: " + chrome.runtime.lastError.message);
          } else if (response && !response.success) {
            console.warn("Alt+C: Cancel button not found. Error: " + response.error);
          } else {
            debugLog("Alt+C: CLICK_CANCEL_BUTTON success", response);
            chrome.action.setBadgeText({ text: '\u2715' }); // ✕
            chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
            chrome.action.setTitle({ title: 'Scribe Message Watcher - Cancelled' });
            setTimeout(() => {
              chrome.action.setBadgeText({ text: '' });
              chrome.action.setTitle({ title: 'Scribe Message Watcher' });
            }, 3000);
          }
        });
      } else {
        console.warn('Alt+C: No suitable Doximity Scribe tab found (visits/).');
      }
    });
  }
});
