// popup.js — Globals, state management, init, and event listeners

const statusDiv = document.getElementById('status');
const instructionsDiv = document.querySelector('.instructions');

const notesListDiv = document.createElement('div');
notesListDiv.id = 'notesList';
notesListDiv.style.marginBottom = '10px';
notesListDiv.style.marginTop = '0';
document.body.appendChild(notesListDiv);

let allNoteBodies = {};
let pendingScrapeNotes = null;
let doximityTabId = null;
let displayedCount = 2;
let practiceQIntegrationEnabled = false;
let dotExpanderIntegrationEnabled = false;
let dotExpanderExtensionId = 'ljlmfclhdpcppglkaiieomhmpnfilagd';

// Popup state persistence
let popupMode = 'notes';

function savePopupState() {
  chrome.storage.local.set({
    popupState: {
      mode: popupMode,
      timestamp: Date.now()
    }
  });
}

function loadPopupState(callback) {
  chrome.storage.local.get('popupState', function(result) {
    if (result.popupState) {
      const age = Date.now() - (result.popupState.timestamp || 0);
      if (age < 30 * 60 * 1000) {
        popupMode = result.popupState.mode || 'notes';
      }
    }
    callback && callback();
  });
}

// Fetch integration settings from chrome.storage.sync at startup
chrome.storage.sync.get(['practiceQIntegrationEnabled', 'dotExpanderIntegrationEnabled', 'dotExpanderExtensionId'], function(result) {
  practiceQIntegrationEnabled = !!result.practiceQIntegrationEnabled;
  dotExpanderIntegrationEnabled = !!result.dotExpanderIntegrationEnabled;
  dotExpanderExtensionId = result.dotExpanderExtensionId || 'ljlmfclhdpcppglkaiieomhmpnfilagd';
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ALL_NOTE_BODIES' && msg.data) {
    debugLog("Received ALL_NOTE_BODIES message with data keys:", Object.keys(msg.data).length);
    allNoteBodies = msg.data;

    if (window.lastNotes && Array.isArray(window.lastNotes)) {
      showNotes(window.lastNotes, 'DOM');
    }

    if (pendingScrapeNotes) {
      showInstructions(false);
      pendingScrapeNotes = null;
    }
  }
  if (msg.type === 'ACTIVATE_DOXIMITY_TAB') {
    chrome.tabs.query({ url: '*://www.doximity.com/scribe/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      }
    });
    return true;
  }
});

// Fix focusTab: get tab.windowId first (Issue 5)
function focusTab(tabId) {
  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.update(tabId, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });
}

// Updated login detection
function isLoginPage(tab) {
  return tab.url && tab.url.includes('auth.doximity.com');
}

document.body.style.padding = '10px';
document.body.style.margin = '0';
document.body.style.boxSizing = 'border-box';

// Set initial height to auto
document.body.style.minHeight = '100px';
document.body.style.height = 'auto';
document.body.style.overflowY = 'hidden';
notesListDiv.style.maxHeight = 'none';
notesListDiv.style.overflowY = 'visible';

// --- Button creation ---
const takeNotesBtn = document.createElement('button');
takeNotesBtn.textContent = 'Take Notes';
takeNotesBtn.style.flex = '1';
takeNotesBtn.style.padding = '6px 0';
takeNotesBtn.style.fontSize = '1em';
takeNotesBtn.style.background = '#2C90ED';
takeNotesBtn.style.color = '#fff';
takeNotesBtn.style.border = 'none';
takeNotesBtn.style.borderRadius = '4px';
takeNotesBtn.style.cursor = 'pointer';

const stopNotesBtn = document.createElement('button');
stopNotesBtn.textContent = 'Cancel Notes';
stopNotesBtn.style.flex = '1';
stopNotesBtn.style.padding = '6px 0';
stopNotesBtn.style.fontSize = '1em';
stopNotesBtn.style.background = '#d32f2f';
stopNotesBtn.style.color = '#fff';
stopNotesBtn.style.border = 'none';
stopNotesBtn.style.borderRadius = '4px';
stopNotesBtn.style.cursor = 'pointer';

const btnContainer = document.createElement('div');
btnContainer.id = 'btn-container';
btnContainer.style.display = 'flex';
btnContainer.style.gap = '10px';
btnContainer.style.margin = '0 0 10px 0';
btnContainer.style.padding = '0';
btnContainer.style.alignItems = 'center';

btnContainer.appendChild(takeNotesBtn);
btnContainer.appendChild(stopNotesBtn);
stopNotesBtn.style.display = 'none';
const popupContainer = document.getElementById('popup-container') || document.body;
popupContainer.insertBefore(btnContainer, popupContainer.firstChild);

function reloadNotesListAndFetch(tab, cb) {
  chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_TO_VISIT_NOTES_LIST' }, function(navResp) {
    if (navResp && navResp.success) {
      const waitMs = navResp.navigated ? 2200 : 500;
      setTimeout(() => {
        fetchNotesAndShow();
        if (cb) cb();
      }, waitMs);
    } else {
      fetchNotesAndShow();
      if (cb) cb();
    }
  });
}

takeNotesBtn.onclick = () => {
  popupMode = 'recording';
  savePopupState();
  takeNotesBtn.style.display = 'none';
  stopNotesBtn.style.display = 'block';

  findDoximityTab(function(tab) {
    if (tab) {
      const visitsNewUrl = 'https://www.doximity.com/scribe/visits/new';
      if (tab.url && tab.url.includes('/scribe/visits/new')) {
        debugLog('Take Notes: Already on visits/new, skipping navigation');
        clearNotesAndShowMicControls();
        retryFetchMicSelector(15, 500);
        return;
      }

      debugLog('Take Notes: Navigating to', visitsNewUrl);
      chrome.tabs.update(tab.id, { url: visitsNewUrl }, function() {
        clearNotesAndShowMicControls();
        const listener = function(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            debugLog('Take Notes: Page loaded, fetching mic selector');
            setTimeout(() => {
              retryFetchMicSelector(15, 500);
            }, 500);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          retryFetchMicSelector();
        }, 10000);
      });
    } else {
      chrome.tabs.create({ url: 'https://www.doximity.com/scribe/visits/new', active: true }, function(newTab) {
        clearNotesAndShowMicControls();
        setTimeout(() => retryFetchMicSelector(15, 500), 2000);
      });
    }
  });
};

stopNotesBtn.onclick = () => {
  popupMode = 'notes';
  savePopupState();
  stopNotesBtn.style.display = 'none';
  takeNotesBtn.style.display = 'block';

  findDoximityTab(function(tab) {
    if (tab) {
      debugLog('Sending TRIGGER_STOP_NOTES to tab:', tab.url);
      safeSendMessage(tab.id, { type: 'TRIGGER_STOP_NOTES' }, function() {
        chrome.action.setBadgeText({ text: '\u2715' }); // ✕
        chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
        chrome.action.setTitle({ title: 'Scribe Message Watcher - Cancelled' });
        setTimeout(function() {
          chrome.action.setBadgeText({ text: '' });
          chrome.action.setTitle({ title: 'Scribe Message Watcher' });
        }, 3000);
        forceNavigateToCachedVisitNotes(tab);
        reloadNotesListAndFetch(tab);
        window.close();
      });
    }
  });
};

function forceNavigateToCachedVisitNotes(tab) {
  chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
    if (lastVisitUuid) {
      const url = 'https://www.doximity.com/scribe/visit_notes/' + lastVisitUuid;
      debugLog('Forcing navigation to:', url, 'in tab:', tab.id);
      chrome.tabs.update(tab.id, { url });
    } else {
      showInstructions(true, 'No cached visit UUID found. Please open a visit notes page first.');
    }
  });
}

function popupInit() {
  debugLog("Popup initialized");
  loadPopupState(function() {
    debugLog("Loaded popup state, mode:", popupMode);
    initPopupView();
  });
}

function initPopupView() {
  try {
    showLoading();

    const timeoutId = setTimeout(() => {
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator && loadingIndicator.style.display !== 'none') {
        debugLog("Loading timeout reached, showing fallback message");
        hideLoading();
        instructionsDiv.innerHTML =
          '<p>Waiting for Doximity Scribe connection...</p>' +
          '<button id="open-doximity-btn" style="width: 80%; margin: 10px auto; display: block;">Open Doximity Scribe</button>';
        instructionsDiv.style.display = 'block';

        const openBtn = document.getElementById('open-doximity-btn');
        if (openBtn) {
          openBtn.onclick = () => {
            chrome.tabs.query({}, (tabs) => {
              let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com'));
              if (scribeTab) {
                chrome.tabs.update(scribeTab.id, { url: 'https://www.doximity.com/scribe/home', active: true });
              } else {
                chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', pinned: true, active: true });
              }
              window.close();
            });
          };
        }
      }
    }, 5000);

    findDoximityTab(function(tab) {
      clearTimeout(timeoutId);

      if (popupMode === 'recording') {
        if (tab && tab.url && tab.url.match(/\/scribe\/visits\//)) {
          debugLog('popupInit: Restoring recording mode on /scribe/visits/*');
          notesListDiv.innerHTML = '';
          hideLoading();
          showInstructions(false);
          takeNotesBtn.style.display = 'none';
          stopNotesBtn.style.display = 'block';
          ensureControlDivsExist();
          fetchMicSelector();
          return;
        }
      }

      if (tab && tab.url && tab.url.match(/\/scribe\/visits\//)) {
        debugLog('popupInit: On /scribe/visits/*, showing controls only.');
        popupMode = 'recording';
        savePopupState();
        notesListDiv.innerHTML = '';
        hideLoading();
        showInstructions(false);
        takeNotesBtn.style.display = 'none';
        stopNotesBtn.style.display = 'block';
        fetchMicSelector();
      } else {
        popupMode = 'notes';
        savePopupState();
        takeNotesBtn.style.display = 'block';
        stopNotesBtn.style.display = 'none';
        fetchNotesAndShow();
      }
    });
  } catch (error) {
    console.error("Error in popupInit:", error);
    hideLoading();
    instructionsDiv.innerHTML =
      '<p>An error occurred while loading.</p>' +
      '<p style="font-size: 0.8em; color: #666;">' + error.message + '</p>' +
      '<button id="retry-btn" style="width: 80%; margin: 10px auto; display: block;">Retry</button>';
    instructionsDiv.style.display = 'block';

    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.onclick = popupInit;
    }
  }
}

// When popup is opened, clear the badge
document.addEventListener('DOMContentLoaded', function() {
  chrome.action.setBadgeText({ text: "" });
});

popupInit();
