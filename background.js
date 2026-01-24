// On extension startup, close all doximity.com tabs
chrome.tabs.query({}, (tabs) => {
  tabs.forEach(tab => {
    if (tab.url && tab.url.includes('doximity.com')) {
      chrome.tabs.remove(tab.id);
    }
  });
});

let NOTES_URL = "https://www.doximity.com/scribe/visit_notes/"; // Default, user-configurable
let lastNoteIds = [];
let pollingInterval = 60000; // 60 seconds default

// Listen for a message from the popup/options page to set the URL
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[DEBUG] Background onMessage - received message:", msg.type, "with data:", JSON.stringify(msg));

  if (msg.type === "SET_NOTES_URL" && msg.url) {
    NOTES_URL = msg.url;
    lastNoteIds = []; // Reset
    checkForNewNotes();
    sendResponse({ status: "ok" });
  }

  // Handle icon update from content script (e.g., after polling finds the mic button)
  if (msg.type === "UPDATE_MIC_ICON") {
    console.log("[DEBUG] UPDATE_MIC_ICON received:", msg);
    if (msg.micActive) {
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
      chrome.action.setTitle({ title: 'Scribe Message Watcher - Recording' });
    } else if (msg.isResume) {
      chrome.action.setBadgeText({ text: '❚❚' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
      chrome.action.setTitle({ title: 'Scribe Message Watcher - Paused' });
    }
    sendResponse({ success: true });
    return;
  }

  if (msg.type === "NEW_MESSAGE") {
    console.log("[DEBUG] NEW_MESSAGE received in background script");
    console.log("[DEBUG] Sender information:", sender.tab ? sender.tab.url : "non-tab sender");
    console.log("[DEBUG] Message details:", 
      msg.url ? `URL: ${msg.url}` : "No URL provided", 
      msg.navigationAware ? "Navigation-aware: true" : "",
      msg.fromNavigation ? "From navigation: true" : "");
    
    // Show direct notification when we get a NEW_MESSAGE event from the content script
    // rather than waiting for checkForNewNotes to compare note IDs
    console.log("[DEBUG] Showing direct notification for NEW_MESSAGE event");
    chrome.action.setBadgeText({ text: "NEW" });
    chrome.action.setBadgeBackgroundColor({ color: "#2C90ED" });
    chrome.action.setTitle({ title: "New message detected!" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon-48.png",
      title: "New Dictation Detected",
      message: "A new dictation was detected in Doximity Scribe"
    }, (notificationId) => {
      console.log("[DEBUG] Direct notification created with ID:", notificationId);
      if (chrome.runtime.lastError) {
        console.error("[DEBUG] Error creating direct notification:", chrome.runtime.lastError);
      }
    });
    
    // If this is a message from a navigation, we should wait a bit longer
    // to let the page finish loading
    const checkDelay = msg.fromNavigation ? 1500 : 500;
    
    // Immediately check for new notes when notification comes from content script
    console.log("[DEBUG] Setting timeout for checkForNewNotes with delay:", checkDelay);
    setTimeout(() => {
      console.log("[DEBUG] Delayed checkForNewNotes starting after", checkDelay, "ms");
      checkForNewNotes();
    }, checkDelay);
    
    // Send a response to confirm receipt
    if (sendResponse) {
      sendResponse({ success: true, message: "NEW_MESSAGE received by background script" });
    }
    
    return true; // Keep the message port open for the async sendResponse
  }
});

function getScribeTab(callback) {
  chrome.tabs.query({}, (tabs) => {
    // Prefer visit_notes, then visits, then any scribe page
    let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visit_notes'));
    if (!scribeTab) {
      scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits'));
    }
    if (!scribeTab) {
      scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/home'));
    }
    if (!scribeTab) {
      // Fallback: any scribe page that's not login
      scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe'));
    }
    // Treat login page as not logged in
    if (scribeTab && !(scribeTab.url && scribeTab.url.includes('doximity.com/session/new'))) {
      callback(scribeTab);
    } else {
      callback(null);
    }
  });
}

function checkForNewNotes() {
  console.log("[DEBUG] checkForNewNotes - Starting check for new notes");
  
  getScribeTab((tab) => {
    if (!tab) {
      console.warn("[DEBUG] No Scribe tab open or not logged in. Notifications paused.");
      return;
    }
    
    console.log("[DEBUG] checkForNewNotes - Found Scribe tab:", tab.url);
    
    // First, check if tab is ready (only try to fetch if tab is complete)
    chrome.tabs.get(tab.id, (updatedTab) => {
      if (chrome.runtime.lastError) {
        console.error("[DEBUG] Error getting tab:", chrome.runtime.lastError);
        return;
      }
      
      if (updatedTab.status !== "complete") {
        console.log("[DEBUG] Tab is still loading, scheduling retry in 1 second");
        setTimeout(() => checkForNewNotes(), 1000);
        return;
      }
      
      // Now send the message to fetch notes
      console.log("[DEBUG] Sending FETCH_NOTES message to tab:", tab.id);
      chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[DEBUG] Content script not found in Scribe tab:", chrome.runtime.lastError);
          return;
        }
        if (!response || !response.success) {
          console.error("[DEBUG] Failed to fetch notes:", response && response.error);
          return;
        }
        
        console.log("[DEBUG] checkForNewNotes - FETCH_NOTES response received successfully");
        
        const data = response.data;
        const notes = (data.props && data.props.visit_notes) || [];
        console.log("[DEBUG] checkForNewNotes - Notes count:", notes.length);
        
        if (notes.length === 0) {
          console.log("[DEBUG] checkForNewNotes - No notes found, skipping notification check");
          return;
        }
        
        const noteIds = notes.map(n => n.uuid);
        
        console.log("[DEBUG] checkForNewNotes - Current noteIds:", noteIds);
        console.log("[DEBUG] checkForNewNotes - Previous lastNoteIds:", lastNoteIds);
        
        // ---> Check if the newest note ID is different from the last known newest ID
        let newNoteDetected = false;
        
        // Check primary condition: first note has changed
        if (lastNoteIds.length && noteIds.length > 0 && noteIds[0] !== lastNoteIds[0]) {
            console.log("[DEBUG] New note detected via first ID change");
            newNoteDetected = true;
        }
        
        // New case: new notes array has more notes than before (new notes added)
        if (!newNoteDetected && noteIds.length > lastNoteIds.length) {
            console.log("[DEBUG] New note detected via length increase - old length:", lastNoteIds.length, "new length:", noteIds.length);
            newNoteDetected = true;
        }
        
        // New case: check if any new IDs exist that weren't in the old set
        if (!newNoteDetected && lastNoteIds.length > 0) {
            for (const id of noteIds) {
                if (!lastNoteIds.includes(id)) {
                    console.log("[DEBUG] New note detected via new ID:", id);
                    newNoteDetected = true;
                    break;
                }
            }
        }
        
        // First run or empty previous array
        if (lastNoteIds.length === 0 && noteIds.length > 0) {
            console.log("[DEBUG] Initial notes detected, saving IDs without notification");
            lastNoteIds = noteIds; // Just save initial state
            return;
        }
        
        if (newNoteDetected) {
            const newNote = notes[0]; // Get the newest note object
            console.log("[DEBUG] NEW NOTE DETECTED:", newNote);
            console.log("[DEBUG] New note UUID:", newNote.uuid);
            console.log("[DEBUG] New note label:", newNote?.note_label);
            console.log("[DEBUG] New note content preview:", newNote?.body?.substring(0, 100) || "No body available");

            // --- Create standard notification (existing code) ---
            console.log("[DEBUG] Setting badge text to NEW");
            chrome.action.setBadgeText({ text: "NEW" }, () => {
              if (chrome.runtime.lastError) {
                console.error("[DEBUG] Error setting badge text:", chrome.runtime.lastError);
              }
            });
            
            console.log("[DEBUG] Setting badge background color");
            chrome.action.setBadgeBackgroundColor({ color: "#2C90ED" }, () => {
              if (chrome.runtime.lastError) {
                console.error("[DEBUG] Error setting badge color:", chrome.runtime.lastError);
              }
            });
            
            console.log("[DEBUG] Setting action title");
            chrome.action.setTitle({ title: "New message detected!" }, () => {
              if (chrome.runtime.lastError) {
                console.error("[DEBUG] Error setting title:", chrome.runtime.lastError);
              }
            });
            
            console.log("[DEBUG] Creating notification");
            chrome.notifications.create({
              type: "basic",
              iconUrl: "icon-48.png",
              title: "New Visit Note",
              message: newNote?.note_label || "A new note has arrived."
            }, (notificationId) => {
              console.log("[DEBUG] Notification created with ID:", notificationId);
              if (chrome.runtime.lastError) {
                console.error("[DEBUG] Error creating notification:", chrome.runtime.lastError);
              }
            });

            // --- Send message to DotExpander (if integration is enabled) ---
            chrome.storage.sync.get(['dotExpanderIntegrationEnabled'], function(result) {
              if (!result.dotExpanderIntegrationEnabled) {
                console.log("[DEBUG] DotExpander integration disabled, skipping dictation send");
                return;
              }

              const dictationContent = newNote?.body || newNote?.content || newNote?.note_label || "No content available"; // Prioritize body/content, fallback to label

              // Attempt to get a timestamp from the note data, fallback to Date.now()
              let noteTimestamp = Date.now(); // Default to now
              const potentialTsField = newNote?.created_at || newNote?.timestamp;

              if (potentialTsField) {
                if (typeof potentialTsField === 'string') {
                    const parsedTs = Date.parse(potentialTsField); // Handles ISO 8601 etc.
                    if (!isNaN(parsedTs)) {
                        noteTimestamp = parsedTs;
                    }
                } else if (typeof potentialTsField === 'number') {
                    // Assume seconds if it's a small number (e.g., before year 2000 in sec), else ms
                    noteTimestamp = potentialTsField < 946684800 ? potentialTsField * 1000 : potentialTsField;
                }
              }

              const targetExtensionId = 'ljlmfclhdpcppglkaiieomhmpnfilagd';
              const messagePayload = {
                  type: 'SEND_VARIABLES',
                  variables: {
                      dictation: { value: dictationContent, timestamp: noteTimestamp }
                  }
              };

              console.log(`[Cascade Debug] Sending message to ${targetExtensionId}:`, messagePayload); // Debug log

              chrome.runtime.sendMessage(targetExtensionId, messagePayload, (response) => {
                  if (chrome.runtime.lastError) {
                      console.error(`[Cascade Error] Sending message to ${targetExtensionId}:`, chrome.runtime.lastError.message);
                  } else {
                      console.log(`[Cascade Debug] Response from ${targetExtensionId}:`, response);
                  }
              });
            });
            // --- End send message ---
        } else {
            console.log("[DEBUG] No new notes detected - current first:", noteIds[0], "previous first:", lastNoteIds[0]);
        }
        lastNoteIds = noteIds; // Update last known IDs
      });
    });
  });
}

function openScribeHomeIfNotOpen() {
  chrome.tabs.query({}, (tabs) => {
    const scribeHomeUrl = 'https://www.doximity.com/scribe/home';
    const alreadyOpen = tabs.some(tab => tab.url && tab.url.startsWith(scribeHomeUrl));
    if (!alreadyOpen) {
      chrome.tabs.create({ url: scribeHomeUrl, pinned: true, active: false }, function(tab) {
        // Wait for tab to finish loading before checking for notes
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, updatedTab) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            checkForNewNotes();
          }
        });
      });
    }
  });
}

// Run this on extension load
openScribeHomeIfNotOpen();

console.log("[DEBUG] Setting up polling interval at", pollingInterval, "ms");
setInterval(checkForNewNotes, pollingInterval);

// Also poll mic state to update extension icon
setInterval(checkMicStateAndUpdateIcon, 5000); // Check every 5 seconds

function checkMicStateAndUpdateIcon() {
  getScribeTab((tab) => {
    if (!tab) {
      // No Scribe tab, clear recording indicator
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Scribe Message Watcher" });
      return;
    }

    // Only check if on visits page (where recording happens)
    if (!tab.url || !tab.url.includes('/scribe/visits/')) {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Scribe Message Watcher" });
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready, ignore
        return;
      }

      if (response && response.success) {
        if (response.micActive) {
          // Recording - show red badge
          chrome.action.setBadgeText({ text: '●' });
          chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher - Recording' });
        } else if (response.isResume) {
          // Paused - show orange badge
          chrome.action.setBadgeText({ text: '❚❚' });
          chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher - Paused' });
        } else {
          // Not recording - clear badge
          chrome.action.setBadgeText({ text: '' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher' });
        }
      }
    });
  });
}

// Optional: clear badge when icon is clicked
chrome.action.onClicked.addListener(() => {
  console.log("[DEBUG] Extension icon clicked, clearing badge");
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "No new messages" });
});

// Listen for the global keyboard shortcut to toggle the microphone
chrome.commands.onCommand.addListener(function(command) {
  if (command === 'toggle-microphone') {
    // Helper to update icon based on mic state
    function updateIconFromResponse(response) {
      if (response && response.success) {
        if (response.micActive) {
          chrome.action.setBadgeText({ text: '●' });
          chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher - Recording' });
        } else if (response.isResume) {
          chrome.action.setBadgeText({ text: '❚❚' });
          chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher - Paused' });
        }
        console.log('[DEBUG] Icon updated immediately after toggle:', response.clicked);
      }
    }

    chrome.tabs.query({}, (tabs) => {
      // Prefer visits/new tab (where recording happens)
      let visitsTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
      if (visitsTab) {
        // Don't activate - just send the message in the background
        chrome.tabs.sendMessage(visitsTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
      } else {
        // Fallback to any visits page (might be mid-recording on a specific visit)
        visitsTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
        if (visitsTab) {
          // Don't activate - just send the message in the background
          chrome.tabs.sendMessage(visitsTab.id, { type: 'CHECK_AND_TOGGLE_MICROPHONE' }, updateIconFromResponse);
        } else {
          // Look for any existing Doximity scribe tab to navigate (instead of creating new)
          let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe'));
          if (scribeTab) {
            // Navigate existing tab to visits/new (don't activate)
            chrome.tabs.update(scribeTab.id, { url: 'https://www.doximity.com/scribe/visits/new' }, function() {
              // Wait for tab to load, then send the message after a delay for React to render
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
            // No Doximity tab at all, create new one (in background)
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
  // --- Handle Alt+G for Generate Note ---
  else if (command === 'trigger-generate-note') {
    chrome.tabs.query({}, (tabs) => {
        // Find an active Scribe tab where Generate Note might be applicable
        // Prefer visits/new, then any visits/ page
        let targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
        if (!targetTab) {
            targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
        }

        if (targetTab) {
            console.log(`[Cascade Debug] Alt+G: Sending CLICK_GENERATE_NOTE_BUTTON to tab ${targetTab.id}`);
            chrome.tabs.sendMessage(targetTab.id, { type: 'CLICK_GENERATE_NOTE_BUTTON' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`[Cascade Error] Alt+G Error sending message to tab ${targetTab.id}: ${chrome.runtime.lastError.message}. Maybe content script isn't loaded?`);
                } else if (response && !response.success) {
                    console.warn(`[Cascade Warn] Alt+G: Generate Note button likely not found in tab ${targetTab.id}. Error: ${response.error}`);
                } else {
                    console.log(`[Cascade Debug] Alt+G: CLICK_GENERATE_NOTE_BUTTON success response from tab ${targetTab.id}:`, response);
                    // Show green checkmark badge for successful generate
                    chrome.action.setBadgeText({ text: '✓' });
                    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
                    chrome.action.setTitle({ title: 'Scribe Message Watcher - Generating Note' });
                    // Clear after 3 seconds
                    setTimeout(() => {
                        chrome.action.setBadgeText({ text: '' });
                        chrome.action.setTitle({ title: 'Scribe Message Watcher' });
                    }, 3000);
                }
            });
        } else {
            console.warn('[Cascade Warn] Alt+G: No suitable Doximity Scribe tab found (visits/).');
        }
    });
  }
  // --- End Handle Alt+G ---

  // --- Handle Alt+C for Cancel Recording ---
  else if (command === 'trigger-cancel-recording') {
    chrome.tabs.query({}, (tabs) => {
        // Find an active Scribe tab where Cancel might be applicable
        let targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/new'));
        if (!targetTab) {
            targetTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com/scribe/visits/'));
        }

        if (targetTab) {
            console.log(`[Cascade Debug] Alt+C: Sending CLICK_CANCEL_BUTTON to tab ${targetTab.id}`);
            chrome.tabs.sendMessage(targetTab.id, { type: 'CLICK_CANCEL_BUTTON' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`[Cascade Error] Alt+C Error: ${chrome.runtime.lastError.message}`);
                } else if (response && !response.success) {
                    console.warn(`[Cascade Warn] Alt+C: Cancel button not found. Error: ${response.error}`);
                } else {
                    console.log(`[Cascade Debug] Alt+C: CLICK_CANCEL_BUTTON success`, response);
                    // Show red X badge for cancelled recording
                    chrome.action.setBadgeText({ text: '✕' });
                    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
                    chrome.action.setTitle({ title: 'Scribe Message Watcher - Cancelled' });
                    // Clear after 3 seconds
                    setTimeout(() => {
                        chrome.action.setBadgeText({ text: '' });
                        chrome.action.setTitle({ title: 'Scribe Message Watcher' });
                    }, 3000);
                }
            });
        } else {
            console.warn('[Cascade Warn] Alt+C: No suitable Doximity Scribe tab found (visits/).');
        }
    });
  }
  // --- End Handle Alt+C ---
});
