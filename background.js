importScripts('shared.js');

// Allow content scripts and popup to access session storage (PHI stays in memory only)
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

let NOTES_URL = "https://www.doximity.com/scribe/visit_notes/";
let lastNoteIds = [];
let pollingInterval = 60000;

// Register OpenEMR content script for custom domain on startup
chrome.storage.sync.get(['openEmrIntegrationEnabled', 'openEmrDomain'], function(result) {
  if (result.openEmrIntegrationEnabled && result.openEmrDomain) {
    const domain = result.openEmrDomain;
    debugLog('Startup: registering OpenEMR content script for', domain);
    chrome.scripting.unregisterContentScripts({ ids: ['openemr-custom'] }).catch(() => {}).then(() => {
      chrome.scripting.registerContentScripts([{
        id: 'openemr-custom',
        matches: ['https://' + domain + '/*', 'http://' + domain + '/*'],
        js: ['shared.js', 'openemr_content.js'],
        runAt: 'document_idle'
      }]).catch(err => {
        console.warn('Startup: failed to register OpenEMR content script:', err);
      });
    });
  }
});

// --- Offscreen clipboard helper ---
let creatingOffscreenDocument;

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
  } else {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Copy dictation text to clipboard from notification.'
    });
    await creatingOffscreenDocument;
    creatingOffscreenDocument = null;
  }
}

async function copyToClipboard(text) {
  await setupOffscreenDocument();
  chrome.runtime.sendMessage({
    type: 'copy-to-clipboard',
    target: 'offscreen-clipboard',
    data: text
  });
}

// --- Notification button handler ---
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  debugLog("Notification button clicked:", notificationId, "buttonIndex:", buttonIndex);

  if (buttonIndex === 0) {
    // "Copy Content" — use the newest note ID to look up its body in cache
    const newestNoteId = lastNoteIds.length > 0 ? lastNoteIds[0] : null;
    chrome.storage.session.get('dox_note_bodies', (result) => {
      const bodies = result.dox_note_bodies || {};
      let bodyToCopy = null;

      if (newestNoteId && bodies[newestNoteId]) {
        bodyToCopy = bodies[newestNoteId];
        debugLog("Copy Content: Found body for newest note:", newestNoteId);
      } else {
        // Fallback: try partial match on newest note ID
        const matchKey = newestNoteId && Object.keys(bodies).find(key =>
          key.includes(newestNoteId) || newestNoteId.includes(key)
        );
        if (matchKey) {
          bodyToCopy = bodies[matchKey];
          debugLog("Copy Content: Found body via partial match:", matchKey);
        } else if (Object.keys(bodies).length > 0) {
          // Last resort: try to get the body from the content script
          debugLog("Copy Content: No match for newest note, fetching from content script");
          findDoximityTab((tab) => {
            if (tab) {
              chrome.tabs.sendMessage(tab.id, { type: 'GET_CACHED_NOTE_BODIES' }, (resp) => {
                if (resp && resp.success && resp.data) {
                  const freshBodies = resp.data;
                  const freshKey = newestNoteId && freshBodies[newestNoteId]
                    ? newestNoteId
                    : Object.keys(freshBodies)[0];
                  if (freshKey && freshBodies[freshKey]) {
                    copyToClipboard(freshBodies[freshKey]).then(() => {
                      debugLog("Copied note body from content script");
                      chrome.action.setBadgeText({ text: '\u2713' });
                      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
                      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
                    });
                  }
                }
              });
            }
          });
          chrome.notifications.clear(notificationId);
          return;
        }
      }

      if (bodyToCopy) {
        copyToClipboard(bodyToCopy).then(() => {
          debugLog("Copied newest note body to clipboard");
          chrome.action.setBadgeText({ text: '\u2713' });
          chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
          setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
        });
      }
    });
  }

  if (buttonIndex === 1) {
    // "Open Scribed Note" — focus the pinned Doximity Scribe tab
    findDoximityTab((tab) => {
      if (tab) {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.get(tab.windowId, (win) => {
          if (win) chrome.windows.update(tab.windowId, { focused: true });
        });
      }
    });
  }

  chrome.notifications.clear(notificationId);
});

// Listen for a message from the popup/options page to set the URL
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  debugLog("Background onMessage - received message:", msg.type, "with data:", JSON.stringify(msg));

  // Dynamic OpenEMR content script registration for custom domains
  if (msg.type === 'REGISTER_OPENEMR_DOMAIN') {
    const domain = msg.domain || 'demo.openemr.io';
    debugLog('Registering OpenEMR content script for domain:', domain);
    // Unregister first to avoid duplicates
    chrome.scripting.unregisterContentScripts({ ids: ['openemr-custom'] }).catch(() => {}).then(() => {
      chrome.scripting.registerContentScripts([{
        id: 'openemr-custom',
        matches: ['https://' + domain + '/*', 'http://' + domain + '/*'],
        js: ['shared.js', 'openemr_content.js'],
        runAt: 'document_idle'
      }]).then(() => {
        debugLog('OpenEMR content script registered for', domain);
      }).catch(err => {
        console.warn('Failed to register OpenEMR content script:', err);
      });
    });
    sendResponse({ success: true });
    return;
  }

  if (msg.type === 'UNREGISTER_OPENEMR_DOMAIN') {
    debugLog('Unregistering OpenEMR content script');
    chrome.scripting.unregisterContentScripts({ ids: ['openemr-custom'] }).catch(() => {});
    sendResponse({ success: true });
    return;
  }

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

    // Only notify if the Scribe tab is NOT the active tab — if the user
    // is already looking at it, they don't need a notification.
    if (sender.tab) {
      chrome.tabs.get(sender.tab.id, (tab) => {
        if (chrome.runtime.lastError || !tab) return;

        chrome.windows.get(tab.windowId, (win) => {
          const isUserLooking = tab.active && win && win.focused;
          debugLog("NEW_MESSAGE - tab active:", tab.active, "window focused:", win && win.focused);

          if (!isUserLooking) {
            chrome.action.setBadgeText({ text: "NEW" });
            chrome.action.setBadgeBackgroundColor({ color: "#2C90ED" });
            chrome.action.setTitle({ title: "New message detected!" });
            chrome.notifications.create({
              type: "basic",
              iconUrl: "icon-48.png",
              title: "New Dictation Detected",
              message: "A new dictation was detected in Doximity Scribe",
              buttons: [{ title: "Copy Content" }, { title: "Open Scribed Note" }]
            }, (notificationId) => {
              debugLog("Notification created with ID:", notificationId);
              if (chrome.runtime.lastError) {
                console.error("Error creating notification:", chrome.runtime.lastError);
              }
            });
          } else {
            debugLog("NEW_MESSAGE - Skipping notification, user is looking at Scribe tab");
          }

          // Sync note IDs either way
          setTimeout(() => syncNoteIds(), 1500);
        });
      });
    } else {
      // No sender tab — show notification as fallback
      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: "#2C90ED" });
      chrome.action.setTitle({ title: "New message detected!" });
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon-48.png",
        title: "New Dictation Detected",
        message: "A new dictation was detected in Doximity Scribe",
        buttons: [{ title: "Copy Content" }, { title: "Open Scribed Note" }]
      });
      setTimeout(() => syncNoteIds(), 1500);
    }

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

        // If the newest note has a body in the API response, cache it
        const newestNote = notes[0];
        const newestBody = newestNote?.body || newestNote?.content;
        if (newestNote?.uuid && newestBody && newestBody.length > 10) {
          chrome.storage.session.get('dox_note_bodies', (result) => {
            const bodies = result.dox_note_bodies || {};
            if (!bodies[newestNote.uuid]) {
              bodies[newestNote.uuid] = newestBody;
              chrome.storage.session.set({ dox_note_bodies: bodies });
              debugLog("syncNoteIds - Cached newest note body:", newestNote.uuid);
            }
          });
        }

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
                scribe: { value: dictationContent, timestamp: noteTimestamp }
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

        // Send to Doximity Services Sidebar if integration is enabled
        if (lastNoteIds.length > 0) {
          const sidebarNote = notes[0];
          chrome.storage.sync.get(['sidebarIntegrationEnabled', 'sidebarExtensionId'], function(result) {
            if (!result.sidebarIntegrationEnabled) return;

            const sidebarDictation = sidebarNote?.body || sidebarNote?.content || sidebarNote?.note_label || "No content available";

            let sidebarTimestamp = Date.now();
            const sidebarTsField = sidebarNote?.created_at || sidebarNote?.timestamp;

            if (sidebarTsField) {
              if (typeof sidebarTsField === 'string') {
                const parsed = Date.parse(sidebarTsField);
                if (!isNaN(parsed)) sidebarTimestamp = parsed;
              } else if (typeof sidebarTsField === 'number') {
                sidebarTimestamp = sidebarTsField < 1e10 ? sidebarTsField * 1000 : sidebarTsField;
              }
            }

            const sidebarExtId = result.sidebarExtensionId;
            if (!sidebarExtId) {
              debugLog("Sidebar integration enabled but no extension ID configured");
              return;
            }

            chrome.runtime.sendMessage(sidebarExtId, {
              type: 'SEND_VARIABLES',
              variables: {
                scribe: { value: sidebarDictation, timestamp: sidebarTimestamp }
              }
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("Error sending to Sidebar:", chrome.runtime.lastError.message);
              } else {
                debugLog("Sidebar response:", response);
              }
            });
          });
        }
      });
    });
  });
}

// On startup, ensure a pinned Doximity Scribe tab exists.
// Reuses an existing tab if found — never closes user tabs.
function ensurePinnedScribeTab() {
  chrome.tabs.query({}, (tabs) => {
    const scribeTabs = tabs.filter(tab => tab.url && tab.url.includes('doximity.com/scribe'));

    if (scribeTabs.length > 0) {
      // Already have a Scribe tab — pin it if not already pinned
      const existing = scribeTabs[0];
      if (!existing.pinned) {
        chrome.tabs.update(existing.id, { pinned: true });
        debugLog('Pinned existing Scribe tab:', existing.id);
      } else {
        debugLog('Scribe tab already pinned:', existing.id);
      }
      // Sync notes once the tab is ready
      if (existing.status === 'complete') {
        syncNoteIds();
      } else {
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === existing.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            syncNoteIds();
          }
        });
      }
      return;
    }

    // Check for any doximity.com tab (e.g. login page, home) — reuse and navigate
    const doximityTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com'));
    if (doximityTab) {
      chrome.tabs.update(doximityTab.id, { url: 'https://www.doximity.com/scribe/home', pinned: true }, function() {
        debugLog('Reused existing Doximity tab, navigated to scribe/home:', doximityTab.id);
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === doximityTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            syncNoteIds();
          }
        });
      });
      return;
    }

    // No Doximity tab at all — create one
    chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', pinned: true, active: false }, function(tab) {
      debugLog('Created new pinned Scribe tab:', tab.id);
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          syncNoteIds();
        }
      });
    });
  });
}

// Run this on extension load
ensurePinnedScribeTab();

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
    // Notify the popup (if open) to switch to recording mode
    chrome.runtime.sendMessage({ type: 'SHORTCUT_MIC_TOGGLED' }).catch(() => {});

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
          // Also check for any doximity.com tab that navigated away from scribe
          if (!scribeTab) {
            scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com') &&
              !tab.url.includes('auth.doximity.com') && !tab.url.includes('doximity.com/session/new'));
          }
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
    // Notify the popup (if open) to switch back to notes mode
    chrome.runtime.sendMessage({ type: 'SHORTCUT_GENERATE_NOTE' }).catch(() => {});

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
    // Notify the popup (if open) to switch back to notes mode
    chrome.runtime.sendMessage({ type: 'SHORTCUT_CANCEL_RECORDING' }).catch(() => {});

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
  // Chrome limits commands to 4 max — open-take-notes commented out for now
  // else if (command === 'open-take-notes') {
  //   chrome.storage.local.set({ openInTakeNotesMode: true }, () => {
  //     chrome.action.openPopup();
  //   });
  // }
});
