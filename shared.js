// shared.js — Shared utilities for background, content, and popup scripts

// Debug logging infrastructure
let _debugEnabled = false;

// Initialize debug state from storage
try {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['debugModeEnabled'], function(result) {
      _debugEnabled = !!result.debugModeEnabled;
    });

    // Listen for changes to debug mode
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area === 'sync' && changes.debugModeEnabled) {
        _debugEnabled = !!changes.debugModeEnabled.newValue;
      }
    });
  }
} catch (e) {
  // Silently ignore — storage may not be available in all contexts
}

function debugLog(...args) {
  if (_debugEnabled) {
    console.log('[DEBUG]', ...args);
  }
}

// Unified tab-finding with priority:
// visit_notes/<uuid> > visits/ > scribe/home > any scribe
// Excludes login pages
function findDoximityTab(callback) {
  chrome.tabs.query({}, function(tabs) {
    // Priority 1: visit_notes with UUID
    let tab = tabs.find(function(t) {
      return t.url && t.url.match(/doximity\.com\/scribe\/visit_notes\/[\w-]+/);
    });
    // Priority 2: visits page
    if (!tab) {
      tab = tabs.find(function(t) {
        return t.url && t.url.includes('doximity.com/scribe/visits/');
      });
    }
    // Priority 3: scribe home
    if (!tab) {
      tab = tabs.find(function(t) {
        return t.url && t.url.includes('doximity.com/scribe/home');
      });
    }
    // Priority 4: any scribe page
    if (!tab) {
      tab = tabs.find(function(t) {
        return t.url && t.url.includes('doximity.com/scribe');
      });
    }
    // Exclude login pages
    if (tab && tab.url && (tab.url.includes('doximity.com/session/new') || tab.url.includes('auth.doximity.com'))) {
      callback(null);
    } else {
      callback(tab || null);
    }
  });
}

// Unified badge update for mic state
function updateBadgeForMicState(micActive, isResume) {
  if (micActive) {
    chrome.action.setBadgeText({ text: '\u25CF' }); // ●
    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher - Recording' });
  } else if (isResume) {
    chrome.action.setBadgeText({ text: '\u275A\u275A' }); // ❚❚
    chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher - Paused' });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher' });
  }
}

// Safe message sender with retries
function safeSendMessage(tabId, msg, callback, retries, interval) {
  if (retries === undefined) retries = 5;
  if (interval === undefined) interval = 300;
  chrome.tabs.sendMessage(tabId, msg, function(response) {
    if (chrome.runtime.lastError) {
      if (retries > 0) {
        setTimeout(function() {
          safeSendMessage(tabId, msg, callback, retries - 1, interval);
        }, interval);
      } else {
        console.warn('[safeSendMessage] Could not connect to content script after retries:', msg, chrome.runtime.lastError);
        callback && callback(null);
      }
      return;
    }
    callback && callback(response);
  });
}
