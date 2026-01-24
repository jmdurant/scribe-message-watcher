// popup.js
const statusDiv = document.getElementById('status');
const instructionsDiv = document.querySelector('.instructions');

const notesListDiv = document.createElement('div');
notesListDiv.id = 'notesList';
notesListDiv.style.marginBottom = '10px'; // Restore margin-bottom to 10px
notesListDiv.style.marginTop = '0'; // Remove any margin-top from notesListDiv for tight stacking
document.body.appendChild(notesListDiv);

let allNoteBodies = {};
let pendingScrapeNotes = null;
let doximityTabId = null;
let practiceQIntegrationEnabled = false;
let dotExpanderIntegrationEnabled = false;

// Popup state persistence
// Modes: 'notes' (viewing notes list) or 'recording' (take notes/mic controls view)
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
      // Only use saved state if it's less than 30 minutes old
      const age = Date.now() - (result.popupState.timestamp || 0);
      if (age < 30 * 60 * 1000) {
        popupMode = result.popupState.mode || 'notes';
      }
    }
    callback && callback();
  });
}

// Fetch integration settings from chrome.storage.sync before rendering notes
chrome.storage.sync.get(['practiceQIntegrationEnabled', 'dotExpanderIntegrationEnabled'], function(result) {
  practiceQIntegrationEnabled = !!result.practiceQIntegrationEnabled;
  dotExpanderIntegrationEnabled = !!result.dotExpanderIntegrationEnabled;
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ALL_NOTE_BODIES' && msg.data) {
    console.log("[DEBUG] Received ALL_NOTE_BODIES message with data keys:", Object.keys(msg.data));
    console.log("[DEBUG] Previous allNoteBodies keys:", Object.keys(allNoteBodies));
    
    allNoteBodies = msg.data;
    console.log("[DEBUG] Updated allNoteBodies, new keys:", Object.keys(allNoteBodies));
    
    // Re-render notes with full bodies if needed
    if (window.lastNotes && Array.isArray(window.lastNotes)) {
      console.log("[DEBUG] Re-rendering notes with updated bodies for lastNotes:", window.lastNotes);
      showNotes(window.lastNotes, 'DOM');
    } else {
      console.log("[DEBUG] No window.lastNotes available to re-render");
    }
    
    // If we have pending notes for scraping, clear the instruction message since we got bodies
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

function showLoading() {
  const loadingIndicator = document.getElementById('loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'block';
  }
  instructionsDiv.style.display = 'none';
  notesListDiv.style.display = 'none';
  notesListDiv.innerHTML = '';
}

function hideLoading() {
  const loadingIndicator = document.getElementById('loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
}

function showInstructions(show, msg) {
  // Hide loading indicator
  hideLoading();
  
  instructionsDiv.style.display = show ? '' : 'none';
  if (msg) {
    instructionsDiv.textContent = msg;
  }
  if (show && msg && msg.includes('log in')) {
    let loginBtn = document.getElementById('scribe-login-btn');
    if (!loginBtn) {
      loginBtn = document.createElement('button');
      loginBtn.id = 'scribe-login-btn';
      loginBtn.textContent = 'Open Doximity Scribe to Log In';
      loginBtn.style.marginTop = '10px';
      loginBtn.style.padding = '8px 18px';
      loginBtn.style.fontSize = '1em';
      loginBtn.style.background = '#2C90ED';
      loginBtn.style.color = '#fff';
      loginBtn.style.border = 'none';
      loginBtn.style.borderRadius = '4px';
      loginBtn.style.cursor = 'pointer';
      loginBtn.onclick = () => {
        // Look for existing Doximity tab first, navigate it instead of creating new
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
      instructionsDiv.appendChild(loginBtn);
    }
  } else {
    const oldBtn = document.getElementById('scribe-login-btn');
    if (oldBtn) oldBtn.remove();
  }
}

function showNotes(notes, source) {
  console.log("[DEBUG] showNotes - Starting with notes:", notes);
  console.log("[DEBUG] showNotes - Current allNoteBodies keys:", Object.keys(allNoteBodies));
  
  // Hide loading indicator
  hideLoading();
  
  // Make sure the notes list div is visible
  notesListDiv.style.display = 'block';
  
  // Always sort newest to oldest
  // Ensure it can handle notes without created_at or with different date formats
  notes.sort((a, b) => {
    // Handle cases where created_at might not exist or is in different formats
    let dateA = a.created_at ? new Date(a.created_at) : new Date(0);
    let dateB = b.created_at ? new Date(b.created_at) : new Date(0);
    
    // Safety check if dates are invalid
    if (isNaN(dateA.getTime())) dateA = new Date(0);
    if (isNaN(dateB.getTime())) dateB = new Date(0);
    
    return dateB - dateA;
  });
  console.log("[DEBUG] showNotes - After sorting, first note:", notes.length > 0 ? notes[0].uuid : "No notes");
  
  notesListDiv.innerHTML = '';
  
  // Check if we have missing bodies and need to add the retry button
  const anyMissingBodies = notes.some(note => {
    const noteKey = note.uuid || note.label;
    return !allNoteBodies[noteKey] || allNoteBodies[noteKey].length < 10;
  });
  
  if (anyMissingBodies && pendingScrapeNotes) {
    addRetryButton();
  }
  
  if (notes.length === 0) {
    // --- Start Custom 'No Notes Found' Display ---
    instructionsDiv.innerHTML = `
      <p>No notes found.<br>Click below to begin dictation.</p>
      <img id="activate-dox-icon" src="icon-128.png" alt="Activate Doximity Tab" 
           style="display: block; margin: 10px auto 0 auto; cursor: pointer; width: 64px; height: 64px;" 
           title="Activate Doximity Tab">
    `;
    instructionsDiv.style.display = 'block';
    notesListDiv.innerHTML = ''; // Clear notes list area
    notesListDiv.style.display = 'none';

    // Add click listener to the icon
    const icon = document.getElementById('activate-dox-icon');
    if (icon) {
      icon.onclick = () => {
        // Find and activate Doximity tab (reuse logic if available, simplified here)
        chrome.tabs.query({ url: ['*://www.doximity.com/scribe/*', '*://*.doximity.com/session/new*'] }, (tabs) => {
          let scribeTab = tabs.find(tab => tab.url && tab.url.includes('/scribe/'));
          if (!scribeTab) {
            scribeTab = tabs.find(tab => tab.url && tab.url.includes('/session/new')); // Fallback to login
          }
          if (scribeTab) {
              chrome.tabs.update(scribeTab.id, { active: true });
              window.close(); // Close popup after activation
          } else {
              // Open a new tab if none found
              chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', active: true });
          }
        });
      };
    }
    // --- End Custom 'No Notes Found' Display ---
    return;
  }
  // TEMP: Log the first note object for debugging
  if (notes.length > 0) {
    console.log('[DEBUG] First note object:', notes[0]);
    console.log('[DEBUG] First note UUID:', notes[0].uuid);
    console.log('[DEBUG] First note body in allNoteBodies:', allNoteBodies[notes[0].uuid]);
  }

  // If PracticeQ integration is enabled, try to move a matched note to the top
  let matchedIdx = -1;
  if (practiceQIntegrationEnabled && typeof isNoteInVisitWindow === 'function') {
    // Find the first note that matches PracticeQ visit window
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      let title = note.note_label || note.label || '';
      if (window.practiceQClientData && isNoteInVisitWindow(title, window.practiceQClientData)) {
        matchedIdx = i;
        break;
      }
    }
    if (matchedIdx > 0) {
      // Move matched note to the top
      const [matchedNote] = notes.splice(matchedIdx, 1);
      notes.unshift(matchedNote);
    }
  }

  let openIdx = notes.findIndex(note => note.body_from_dom);
  if (openIdx === -1) openIdx = 0;
  // Async-safe rendering for PracticeQ integration
  if (practiceQIntegrationEnabled) {
    const renderedNotes = new Array(notes.length);
    let completed = 0;
    notes.forEach((note, idx) => {
      const noteKey = note.uuid || note.label;
      const hasBody = !!note.body_from_dom || !!allNoteBodies[noteKey];
      let body = note.body_from_dom || allNoteBodies[noteKey] || '';
      
      console.log(`[DEBUG] Note ${idx} - UUID/Label: ${noteKey}, hasBody: ${hasBody}, bodyLength: ${body.length}`);
      
      let title = note.note_label || note.label || '';
      // Handle body_from_cache notes that might have generic labels
      if (note.body_from_cache && title.includes('Note') && title.includes('...')) {
        // Try to extract a better title from the note body
        const firstLine = body.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 5 && firstLine.length < 100) {
          title = firstLine;
        }
      }
      
      if (hasBody) {
        chrome.tabs.query({ url: '*://intakeq.com/#/client/*' }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CLIENT_DATA' }, (clientData) => {
              if (clientData && isNoteInVisitWindow(title, clientData)) {
                const filled = fillNoteTemplate(body, clientData);
                renderedNotes[idx] = renderNoteDivElement(idx, filled, note, hasBody, title);
              } else {
                renderedNotes[idx] = renderNoteDivElement(idx, body, note, hasBody, title);
              }
              completed++;
              if (completed === notes.length) {
                notesListDiv.innerHTML = '';
                renderedNotes.forEach(el => { if (el) notesListDiv.appendChild(el); });
              }
            });
          } else {
            renderedNotes[idx] = renderNoteDivElement(idx, body, note, hasBody, title);
            completed++;
            if (completed === notes.length) {
              notesListDiv.innerHTML = '';
              renderedNotes.forEach(el => { if (el) notesListDiv.appendChild(el); });
            }
          }
        });
      } else {
        renderedNotes[idx] = renderNoteDivElement(idx, body, note, hasBody, title);
        completed++;
        if (completed === notes.length) {
          notesListDiv.innerHTML = '';
          renderedNotes.forEach(el => { if (el) notesListDiv.appendChild(el); });
        }
      }
    });
  } else {
    // Synchronous rendering if integration is off
    notes.forEach((note, idx) => {
      const noteKey = note.uuid || note.label;
      const hasBody = !!note.body_from_dom || !!allNoteBodies[noteKey];
      let body = note.body_from_dom || allNoteBodies[noteKey] || '';
      
      console.log(`[DEBUG] Note ${idx} - UUID/Label: ${noteKey}, hasBody: ${hasBody}, bodyLength: ${body.length}`);
      
      let title = note.note_label || note.label || '';
      // Handle body_from_cache notes that might have generic labels
      if (note.body_from_cache && title.includes('Note') && title.includes('...')) {
        // Try to extract a better title from the note body
        const firstLine = body.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 5 && firstLine.length < 100) {
          title = firstLine;
        }
      }
      
      const el = renderNoteDivElement(idx, body, note, hasBody, title);
      notesListDiv.appendChild(el);
    });
  }
  // Show source
  const srcDiv = document.createElement('div');
  srcDiv.style.fontSize = '0.85em';
  srcDiv.style.color = '#888';
  srcDiv.style.marginTop = '6px';
  srcDiv.textContent = `Source: ${source === 'api' ? 'API' : 'DOM'}${notes.some(n => n.body_from_cache) ? ' (with cache fallback)' : ''}`;
  notesListDiv.appendChild(srcDiv);
  setPopupHeightToFirstNote();
}

function focusTab(tabId) {
  chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(tabId, { focused: true });
}

function showStatus(msg, color) {
  statusDiv.textContent = msg;
  statusDiv.style.color = color;
}

// Updated login detection: only treat as logged out if tab.url includes 'auth.doximity.com'
function isLoginPage(tab) {
  // Only treat as logged out if redirected to Doximity auth domain
  return tab.url && tab.url.includes('auth.doximity.com');
}

// Improved tab selection: always prefer /scribe/visit_notes/ with UUID
function findDoximityTabOrPrompt(callback) {
  chrome.tabs.query({}, function(tabs) {
    // Prefer tabs with /scribe/visit_notes/<uuid>
    const notesTab = tabs.find(tab => tab.url && tab.url.match(/\/scribe\/visit_notes\/[\w-]+/));
    if (notesTab) {
      console.log('[Cascade Debug] Chosen Doximity tab (notes):', notesTab.url);
      callback(notesTab);
      return;
    }
    // Fallback: any Doximity tab
    const doximityTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com'));
    if (doximityTab) {
      console.log('[Cascade Debug] Chosen Doximity tab (fallback):', doximityTab.url);
      callback(doximityTab);
      return;
    }
    
    // No tab found - we now handle this in fetchNotesAndShow
    console.log('[DEBUG] No Doximity tab found');
    callback(null);
  });
}

function fetchNotesViaContentScript(cb) {
  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, (response) => {
        cb(response);
      });
    } else {
      cb({ success: false, error: 'No Doximity tab found.' });
    }
  });
}

// 1. Add a diagnostic function to check cache keys vs note UUIDs
function debugCacheKeyMismatch(notes, cacheBodies) {
  console.log("====== CACHE KEY DIAGNOSTIC ======");
  console.log("Notes UUIDs:", notes.map(n => n.uuid || n.label));
  console.log("Cache keys:", Object.keys(cacheBodies));
  
  // Check each note UUID against cache
  notes.forEach((note, idx) => {
    const noteKey = note.uuid || note.label;
    console.log(`Note ${idx} (${noteKey}):`);
    console.log(`  - Direct match: ${!!cacheBodies[noteKey]}`);
    
    // Look for partial matches (in case UUIDs are truncated or formatted differently)
    const partialMatches = Object.keys(cacheBodies).filter(key => 
      key.includes(noteKey) || noteKey.includes(key)
    );
    console.log(`  - Partial matches: ${JSON.stringify(partialMatches)}`);
    
    if (partialMatches.length > 0) {
      partialMatches.forEach(key => {
        console.log(`    Key: ${key}, Body length: ${(cacheBodies[key] || '').length}`);
      });
    }
  });
  console.log("=================================");
}

// 2. Modify the fetchNotesAndShow function to check for key mismatch
function fetchNotesAndShow() {
  console.log('[DEBUG] fetchNotesAndShow called.');
  showLoading();
  // Fetch integration settings first
  chrome.storage.sync.get(['practiceQIntegrationEnabled', 'dotExpanderIntegrationEnabled'], function(result) {
    practiceQIntegrationEnabled = !!result.practiceQIntegrationEnabled;
    dotExpanderIntegrationEnabled = !!result.dotExpanderIntegrationEnabled;
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        doximityTabId = tab.id;
        if (tab.url && tab.url.match(/\/scribe\/visits\//)) {
          console.log('[DEBUG] On /scribe/visits/*, showing controls only.');
          notesListDiv.innerHTML = '';
          hideLoading(); // Make sure we hide the loading spinner
          showInstructions(false);
          fetchMicSelector();
          return;
        }
        console.log('[DEBUG] Sending FETCH_NOTES message to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, function(response) {
          if (!response || !response.success || !response.data) {
            console.log('[DEBUG] FETCH_NOTES failed or empty response:', response);
            hideLoading(); // Hide loading spinner
            showInstructions(true, 'Please log in to Doximity and open Scribe.');
            notesListDiv.innerHTML = '';
            return;
          }
          console.log('[DEBUG] FETCH_NOTES success, source:', response.source);
          let notes = (response.data.props && response.data.props.visit_notes) || [];
          console.log('[DEBUG] Notes received count:', notes.length);
          if (notes.length > 0) {
            console.log('[DEBUG] First note UUID:', notes[0].uuid);
          }
          
          // 1. Try to get cached note bodies
          console.log('[DEBUG] Sending GET_CACHED_NOTE_BODIES message to tab:', tab.id);
          chrome.tabs.sendMessage(tab.id, { type: 'GET_CACHED_NOTE_BODIES' }, function(cacheResp) {
            let cacheBodies = (cacheResp && cacheResp.success && cacheResp.data) ? cacheResp.data : {};
            console.log('[DEBUG] Cached note bodies received, keys:', Object.keys(cacheBodies));
            
            // Run diagnostic to check for key mismatches
            debugCacheKeyMismatch(notes, cacheBodies);
            
            // Fix potential key mismatch - try to match notes with cached bodies by fuzzy matching
            const updatedCacheBodies = {...cacheBodies};
            notes.forEach(note => {
              const noteKey = note.uuid || note.label;
              
              // If exact match exists, no need to fix
              if (updatedCacheBodies[noteKey]) return;
              
              // Try to find a partial match
              const partialMatches = Object.keys(cacheBodies).filter(key => 
                key.includes(noteKey) || noteKey.includes(key)
              );
              
              if (partialMatches.length > 0) {
                // Use the first partial match's body
                console.log(`[DEBUG] Found partial match for ${noteKey}:`, partialMatches[0]);
                updatedCacheBodies[noteKey] = cacheBodies[partialMatches[0]];
              }
            });
            
            allNoteBodies = updatedCacheBodies;
            
            // FALLBACK: If no notes were found via DOM/API but we have cached note bodies,
            // construct notes from the cache keys
            if (notes.length === 0 && Object.keys(cacheBodies).length > 0) {
              console.log('[DEBUG] No notes found but cache has bodies. Using cache to construct notes.');
              notes = Object.keys(cacheBodies).map(uuid => ({
                uuid: uuid,
                note_label: `Note ${uuid.substring(0, 8)}...`,
                created_at: new Date().toISOString(), // We don't have the real timestamp
                body_from_cache: true
              }));
              console.log('[DEBUG] Constructed notes from cache:', notes);
            }
            
            window.lastNotes = notes;
            
            // If cache is empty or incomplete, trigger scrape
            const missing = notes.some(n => {
              const key = n.uuid || n.label;
              const hasBody = !!updatedCacheBodies[key];
              console.log(`[DEBUG] Note ${key} has cached body: ${hasBody}`);
              return !hasBody;
            });
            
            // Always hide the loading spinner before showing content
            hideLoading();
            
            // Always show notes with whatever bodies we already have in cache first
            if (notes.length > 0) {
              showInstructions(false);
              console.log('[DEBUG] Calling showNotes immediately with cached bodies');
              showNotes(notes, response.source);
            } else {
              // --- Start Custom 'No Notes Found' Display ---
              instructionsDiv.innerHTML = `
                <p>No notes found.<br>Click below to begin dictation.</p>
                <img id="activate-dox-icon" src="icon-128.png" alt="Activate Doximity Tab" 
                     style="display: block; margin: 10px auto 0 auto; cursor: pointer; width: 64px; height: 64px;" 
                     title="Activate Doximity Tab">
              `;
              instructionsDiv.style.display = 'block';
              notesListDiv.innerHTML = ''; // Clear notes list area
              notesListDiv.style.display = 'none';

              // Add click listener to the icon
              const icon = document.getElementById('activate-dox-icon');
              if (icon) {
                icon.onclick = () => {
                  // Find and activate Doximity tab
                  chrome.tabs.query({ url: ['*://www.doximity.com/scribe/*', '*://*.doximity.com/session/new*'] }, (tabs) => {
                    let scribeTab = tabs.find(tab => tab.url && tab.url.includes('/scribe/'));
                    if (!scribeTab) {
                      scribeTab = tabs.find(tab => tab.url && tab.url.includes('/session/new')); // Fallback to login
                    }
                    if (scribeTab) {
                        chrome.tabs.update(scribeTab.id, { active: true });
                        window.close(); // Close popup after activation
                    } else {
                        // Open new tab if none found
                        chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', active: true });
                    }
                  });
                };
              }
              // --- End Custom 'No Notes Found' Display ---
            }
            
            // Only try to scrape if there are missing bodies
            if (missing) {
              console.log('[DEBUG] Missing bodies detected, sending SCRAPE_ALL_NOTE_BODIES for', notes.length, 'notes');
              chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_ALL_NOTE_BODIES', notes }, function(resp) {
                if (chrome.runtime.lastError) {
                  console.log('[DEBUG] Error sending SCRAPE_ALL_NOTE_BODIES:', chrome.runtime.lastError);
                  pendingScrapeNotes = notes;
                  // Don't overwrite the notes display, just show a toast-like message
                  const statusMsg = document.createElement('div');
                  statusMsg.textContent = 'Activate Doximity tab to load missing note bodies';
                  statusMsg.style.position = 'fixed';
                  statusMsg.style.bottom = '10px';
                  statusMsg.style.left = '50%';
                  statusMsg.style.transform = 'translateX(-50%)';
                  statusMsg.style.background = 'rgba(0,0,0,0.7)';
                  statusMsg.style.color = 'white';
                  statusMsg.style.padding = '8px 12px';
                  statusMsg.style.borderRadius = '4px';
                  statusMsg.style.fontSize = '12px';
                  statusMsg.style.zIndex = '9999';
                  document.body.appendChild(statusMsg);
                  setTimeout(() => {
                    statusMsg.style.opacity = '0';
                    statusMsg.style.transition = 'opacity 0.5s';
                    setTimeout(() => statusMsg.remove(), 500);
                  }, 3000);
                } else {
                  console.log('[DEBUG] SCRAPE_ALL_NOTE_BODIES sent successfully, response:', resp);
                  showStatus('Scraping all note bodies...', '#2C90ED');
                }
              });
            }
          });
        });
      } else {
        // No Doximity tab found, show error and connection options
        hideLoading();
        instructionsDiv.innerHTML = `
          <p>No Doximity Scribe tab found.</p>
          <button id="open-doximity-btn" style="width: 80%; margin: 10px auto; display: block;">Open Doximity Scribe</button>
        `;
        instructionsDiv.style.display = 'block';
        
        // Add click listener to open button
        const openBtn = document.getElementById('open-doximity-btn');
        if (openBtn) {
          openBtn.onclick = () => {
            // Look for existing Doximity tab first
            chrome.tabs.query({}, (tabs) => {
              let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com'));
              if (scribeTab) {
                chrome.tabs.update(scribeTab.id, { url: 'https://www.doximity.com/scribe/home', active: true });
              } else {
                chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', active: true });
              }
              window.close();
            });
          };
        }
      }
    });
  });
}

function popupInit() {
  console.log("Popup initialized");

  // Load saved popup state before initializing
  loadPopupState(function() {
    console.log("[DEBUG] Loaded popup state, mode:", popupMode);
    initPopupView();
  });
}

function initPopupView() {
  try {
    showLoading();

    // Set a timeout to ensure we always show something after 5 seconds
    const timeoutId = setTimeout(() => {
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator && loadingIndicator.style.display !== 'none') {
        console.log("[DEBUG] Loading timeout reached, showing fallback message");
        hideLoading();
        instructionsDiv.innerHTML = `
          <p>Waiting for Doximity Scribe connection...</p>
          <button id="open-doximity-btn" style="width: 80%; margin: 10px auto; display: block;">Open Doximity Scribe</button>
        `;
        instructionsDiv.style.display = 'block';

        const openBtn = document.getElementById('open-doximity-btn');
        if (openBtn) {
          openBtn.onclick = () => {
            // Look for existing Doximity tab first
            chrome.tabs.query({}, (tabs) => {
              let scribeTab = tabs.find(tab => tab.url && tab.url.includes('doximity.com'));
              if (scribeTab) {
                chrome.tabs.update(scribeTab.id, { url: 'https://www.doximity.com/scribe/home', active: true });
              } else {
                chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', active: true });
              }
              window.close();
            });
          };
        }
      }
    }, 5000);

    findDoximityTabOrPrompt(function(tab) {
      clearTimeout(timeoutId); // Clear the timeout since we got a response

      // Check if we should restore recording view
      if (popupMode === 'recording') {
        // Check if Doximity is still on a recording-related page or if recording is active
        if (tab && tab.url && tab.url.match(/\/scribe\/visits\//)) {
          console.log('[DEBUG] popupInit: Restoring recording mode on /scribe/visits/*');
          notesListDiv.innerHTML = '';
          hideLoading();
          showInstructions(false);
          // Toggle button visibility for recording view
          takeNotesBtn.style.display = 'none';
          stopNotesBtn.style.display = 'block';
          // Create all control divs in correct order first
          ensureControlDivsExist();
          // Then fetch and populate them
          fetchMicSelector();
          return;
        }
      }

      // Default behavior based on URL
      if (tab && tab.url && tab.url.match(/\/scribe\/visits\//)) {
        console.log('[DEBUG] popupInit: On /scribe/visits/*, showing controls only.');
        popupMode = 'recording';
        savePopupState();
        notesListDiv.innerHTML = '';
        hideLoading();
        showInstructions(false);
        // Toggle button visibility for recording view
        takeNotesBtn.style.display = 'none';
        stopNotesBtn.style.display = 'block';
        fetchMicSelector();
      } else {
        popupMode = 'notes';
        savePopupState();
        // Toggle button visibility for notes view
        takeNotesBtn.style.display = 'block';
        stopNotesBtn.style.display = 'none';
        fetchNotesAndShow();
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error in popupInit:", error);
    // Fallback for any unexpected errors
    hideLoading();
    instructionsDiv.innerHTML = `
      <p>An error occurred while loading.</p>
      <p style="font-size: 0.8em; color: #666;">${error.message}</p>
      <button id="retry-btn" style="width: 80%; margin: 10px auto; display: block;">Retry</button>
    `;
    instructionsDiv.style.display = 'block';
    
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.onclick = popupInit;
    }
  }
}

function setPopupHeightToFirstNote() {
  setTimeout(() => {
    // Let content determine height naturally
    document.body.style.height = 'auto';
    document.body.style.overflowY = 'hidden';
    notesListDiv.style.maxHeight = 'none';
    notesListDiv.style.overflowY = 'visible';
  }, 50);
}

document.body.style.padding = '10px';
document.body.style.margin = '0';
document.body.style.boxSizing = 'border-box';

// --- Microphone Selector UI ---
function renderMicSelector(options, selected) {
  let micDiv = document.getElementById('mic-selector-div');
  if (!micDiv) {
    micDiv = document.createElement('div');
    micDiv.id = 'mic-selector-div';
    micDiv.style.margin = '12px 0';
    const btnContainer = document.getElementById('btn-container');
    if (btnContainer) {
      btnContainer.insertAdjacentElement('afterend', micDiv);
    } else {
      document.body.appendChild(micDiv);
    }
  }
  micDiv.innerHTML = '';
  const label = document.createElement('label');
  label.textContent = 'Microphone:';
  label.style.fontWeight = 'bold';
  label.style.display = 'block';
  label.style.marginBottom = '4px';
  const select = document.createElement('select');
  select.style.width = '100%';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selected) o.selected = true;
    select.appendChild(o);
  });
  select.onchange = function() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'SET_MICROPHONE', value: select.value });
      }
    });
  };
  micDiv.appendChild(label);
  micDiv.appendChild(select);
}

// --- Note Type Selector UI ---
function renderNoteTypeSelector(options, selected) {
  let noteTypeDiv = document.getElementById('note-type-selector-div');
  if (!noteTypeDiv) {
    noteTypeDiv = document.createElement('div');
    noteTypeDiv.id = 'note-type-selector-div';
    noteTypeDiv.style.margin = '12px 0';
    // Insert after mic-selector-div if present
    const micDiv = document.getElementById('mic-selector-div');
    if (micDiv) {
      micDiv.insertAdjacentElement('afterend', noteTypeDiv);
    } else {
      const btnContainer = document.getElementById('btn-container');
      if (btnContainer) {
        btnContainer.insertAdjacentElement('afterend', noteTypeDiv);
      } else {
        document.body.appendChild(noteTypeDiv);
      }
    }
  }
  noteTypeDiv.innerHTML = '';
  const label = document.createElement('label');
  label.textContent = 'Note Type:';
  label.style.fontWeight = 'bold';
  label.style.display = 'block';
  label.style.marginBottom = '4px';
  const select = document.createElement('select');
  select.style.width = '100%';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === selected) o.selected = true;
    select.appendChild(o);
  });
  select.onchange = function() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'SET_NOTE_TYPE', value: select.value });
      }
    });
  };
  noteTypeDiv.appendChild(label);
  noteTypeDiv.appendChild(select);
}

function fetchNoteTypeSelector() {
  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_NOTE_TYPE_OPTIONS' }, function(response) {
        const noteTypeDiv = document.getElementById('note-type-selector-div');
        if (response && response.success && response.options && response.options.length > 0) {
          console.log('[DEBUG] renderNoteTypeSelector with options:', response.options, 'selected:', response.selected);
          renderNoteTypeSelector(response.options, response.selected);
          if (noteTypeDiv) noteTypeDiv.style.display = '';
        } else {
          console.log('[DEBUG] No note type selector found on page. Hiding note type div.');
          if (noteTypeDiv) noteTypeDiv.style.display = 'none';
        }
      });
    }
  });
}

function fetchMicSelector() {
  console.log('[DEBUG] fetchMicSelector called.');
  // Ensure all control divs exist in correct order first
  ensureControlDivsExist();
  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_MICROPHONE_OPTIONS' }, function(response) {
        const micDiv = document.getElementById('mic-selector-div');
        if (response && response.success && response.options && response.options.length > 0) {
          console.log('[DEBUG] renderMicSelector with options:', response.options, 'selected:', response.selected);
          renderMicSelector(response.options, response.selected);
          if (micDiv) micDiv.style.display = '';
        } else {
          console.log('[DEBUG] No mic selector present (likely recording). Hiding mic selector div.');
          if (micDiv) micDiv.style.display = 'none';
        }
        // Also fetch note type selector
        fetchNoteTypeSelector();
        // Always render mic/pause and generate note buttons, even if selector is missing
        syncMicStateAndRender();
        renderGenerateNoteButton();
      });
    }
  });
}

function safeSendMessage(tabId, msg, callback, retries = 5, interval = 300) {
  chrome.tabs.sendMessage(tabId, msg, function(response) {
    if (chrome.runtime.lastError) {
      if (retries > 0) {
        setTimeout(() => safeSendMessage(tabId, msg, callback, retries - 1, interval), interval);
      } else {
        console.warn('[POPUP][safeSendMessage] Could not connect to content script after retries:', msg, chrome.runtime.lastError);
        callback && callback(null);
      }
      return;
    }
    callback && callback(response);
  });
}

function syncMicStateAndRender() {
  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
        console.log('[POPUP][syncMicStateAndRender] response:', response);
        if (response && response.success) {
          renderMicButton(response.micActive, response.isResume);
          updateExtensionIcon(response.micActive, response.isResume);
        } else {
          // Always render a mic button even if we can't get state
          console.log('[POPUP][syncMicStateAndRender] No valid response, rendering default mic button');
          renderMicButton(false, false);
          updateExtensionIcon(false, false);
        }
      });
    } else {
      // No tab, still render a default mic button
      console.log('[POPUP][syncMicStateAndRender] No tab found, rendering default mic button');
      renderMicButton(false, false);
      updateExtensionIcon(false, false);
    }
  });
}

// Update extension icon badge to show recording status
function updateExtensionIcon(micActive, isResume) {
  if (micActive) {
    // Recording - show red badge
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher - Recording' });
  } else if (isResume) {
    // Paused - show yellow/orange badge
    chrome.action.setBadgeText({ text: '❚❚' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher - Paused' });
  } else {
    // Not recording - clear badge
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Scribe Message Watcher' });
  }
}

function renderMicButton(micActive = false, isResume = false) {
  let micBtnDiv = document.getElementById('mic-btn-div');
  if (!micBtnDiv) {
    micBtnDiv = document.createElement('div');
    micBtnDiv.id = 'mic-btn-div';
    micBtnDiv.style.textAlign = 'center';
    micBtnDiv.style.margin = '12px 0';
    // Insert after note-type-selector-div, or mic-selector-div, or btn-container
    const noteTypeDiv = document.getElementById('note-type-selector-div');
    const micSelectorDiv = document.getElementById('mic-selector-div');
    const btnContainer = document.getElementById('btn-container');
    if (noteTypeDiv) {
      noteTypeDiv.insertAdjacentElement('afterend', micBtnDiv);
    } else if (micSelectorDiv) {
      micSelectorDiv.insertAdjacentElement('afterend', micBtnDiv);
    } else if (btnContainer) {
      btnContainer.insertAdjacentElement('afterend', micBtnDiv);
    } else {
      document.body.appendChild(micBtnDiv);
    }
  }
  micBtnDiv.innerHTML = '';
  const btn = document.createElement('button');
  btn.style.background = '#fff';
  btn.style.border = '1px solid #1976d2';
  btn.style.borderRadius = '50%';
  btn.style.width = '48px';
  btn.style.height = '48px';
  btn.style.cursor = 'pointer';
  if (micActive) {
    btn.title = 'Pause Microphone';
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 50 50" fill="#d32f2f" xmlns="http://www.w3.org/2000/svg"><path d="M16.5 4h-7A4.505 4.505 0 0 0 5 8.5v33C5 43.981 7.019 46 9.5 46h7c2.481 0 4.5-2.019 4.5-4.5v-33C21 6.019 18.981 4 16.5 4zm24 0h-7A4.505 4.505 0 0 0 29 8.5v33c0 2.481 2.019 4.5 4.5 4.5h7c2.481 0 4.5-2.019 4.5-4.5v-33C45 6.019 42.981 4 40.5 4z"/></svg>';
  } else if (isResume) {
    btn.title = 'Resume Microphone';
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 50 50" fill="#1976d2" xmlns="http://www.w3.org/2000/svg"><path d="M25.001 34.017c5.514 0 10-4.486 10-10v-12c0-5.515-4.486-10-10-10s-10 4.485-10 10v12c0 5.514 4.486 10 10 10zm16.044-10.01a1.5 1.5 0 0 0-3 0c0 7.192-5.852 13.044-13.044 13.044s-13.044-5.852-13.044-13.044a1.5 1.5 0 0 0-3 0c0 8.34 6.399 15.208 14.544 15.968v6.508a1.5 1.5 0 0 0 3 0v-6.508c8.145-.76 14.544-7.628 14.544-15.968z"/></svg>';
  } else {
    btn.title = 'Activate Microphone';
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 50 50" fill="#1976d2" xmlns="http://www.w3.org/2000/svg"><path d="M25.001 34.017c5.514 0 10-4.486 10-10v-12c0-5.515-4.486-10-10-10s-10 4.485-10 10v12c0 5.514 4.486 10 10 10zm16.044-10.01a1.5 1.5 0 0 0-3 0c0 7.192-5.852 13.044-13.044 13.044s-13.044-5.852-13.044-13.044a1.5 1.5 0 0 0-3 0c0 8.34 6.399 15.208 14.544 15.968v6.508a1.5 1.5 0 0 0 3 0v-6.508c8.145-.76 14.544-7.628 14.544-15.968z"/></svg>';
  }
  btn.onclick = function() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        console.log('[POPUP][MicButton] micActive before click:', micActive, 'isResume:', isResume);
        if (!micActive) {
          safeSendMessage(tab.id, { type: 'CLICK_MICROPHONE_BUTTON' }, function() {
            pollMicStateAndRender();
          });
        } else {
          safeSendMessage(tab.id, { type: 'CLICK_PAUSE_MICROPHONE_BUTTON' }, function() {
            // Poll for paused state since DOM needs time to update
            pollForPausedState();
          });
        }
      }
    });
  };
  micBtnDiv.appendChild(btn);
}

function pollMicStateAndRender(maxRetries = 10, interval = 100) {
  let attempts = 0;
  function poll() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
          if (response && response.success && response.micActive) {
            renderMicButton(response.micActive, response.isResume);
            updateExtensionIcon(response.micActive, response.isResume);
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(poll, interval);
          } else {
            // Fallback: just sync final state
            syncMicStateAndRender();
          }
        });
      }
    });
  }
  poll();
}

// Poll for paused state (isResume = true) after clicking pause
function pollForPausedState(maxRetries = 10, interval = 100) {
  let attempts = 0;
  function poll() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
          console.log('[DEBUG] pollForPausedState attempt', attempts, 'response:', response);
          if (response && response.success && response.isResume) {
            // Successfully paused - show resume button
            renderMicButton(false, true);
            updateExtensionIcon(false, true);
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(poll, interval);
          } else {
            // Fallback: just sync final state
            syncMicStateAndRender();
          }
        });
      }
    });
  }
  poll();
}

// --- Generate Note Button ---
function renderGenerateNoteButton() {
  let genDiv = document.getElementById('generate-note-div');
  if (!genDiv) {
    genDiv = document.createElement('div');
    genDiv.id = 'generate-note-div';
    genDiv.style.textAlign = 'center';
    genDiv.style.margin = '12px 0';
    // Insert after mic-btn-div if present, else append to notesListDiv or body
    const micBtnDiv = document.getElementById('mic-btn-div');
    if (micBtnDiv) {
      micBtnDiv.insertAdjacentElement('afterend', genDiv);
    } else if (notesListDiv) {
      notesListDiv.appendChild(genDiv);
    } else {
      document.body.appendChild(genDiv);
    }
  }
  genDiv.innerHTML = '';
  const btn = document.createElement('button');
  btn.textContent = 'Generate Note';
  btn.style.background = '#1976d2';
  btn.style.border = 'none';
  btn.style.color = '#fff';
  btn.style.borderRadius = '4px';
  btn.style.padding = '10px 22px';
  btn.style.fontSize = '1em';
  btn.style.cursor = 'pointer';
  btn.onclick = function() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        // First, click the Generate Note button
        safeSendMessage(tab.id, { type: 'CLICK_GENERATE_NOTE_BUTTON' }, response => {
          // After clicking, check for and display note type options
          setTimeout(() => {
            safeSendMessage(tab.id, { type: 'GET_NOTE_TYPES' }, noteTypesResponse => {
              if (noteTypesResponse && noteTypesResponse.success && noteTypesResponse.noteTypes && noteTypesResponse.noteTypes.length > 0) {
                showNoteTypeOptions(tab.id, noteTypesResponse.noteTypes);
              } else {
                // If we can't get note types, just focus the tab
                chrome.tabs.update(tab.id, { active: true });
              }
            });
          }, 500); // Small delay to allow the note types to appear in the DOM
        });
      }
    });
  };
  genDiv.appendChild(btn);
}

// Function to display note type options
function showNoteTypeOptions(tabId, noteTypes) {
  // Clear the current popup content
  hideLoading();
  instructionsDiv.style.display = 'none';
  notesListDiv.style.display = 'none';
  
  // Remove any existing UI elements
  const existingElements = [
    document.getElementById('mic-selector-div'),
    document.getElementById('mic-btn-div'),
    document.getElementById('generate-note-div')
  ];
  existingElements.forEach(el => { if (el) el.remove(); });
  
  // Create container for note type options
  const container = document.createElement('div');
  container.id = 'note-types-container';
  container.style.padding = '10px';
  
  // Add title
  const title = document.createElement('h3');
  title.textContent = 'Select Note Type';
  title.style.textAlign = 'center';
  title.style.margin = '0 0 15px 0';
  title.style.color = '#1976d2';
  container.appendChild(title);
  
  // Add note type buttons
  noteTypes.forEach(noteType => {
    const button = document.createElement('button');
    button.textContent = noteType.text;
    button.style.display = 'block';
    button.style.width = '100%';
    button.style.padding = '10px';
    button.style.margin = '8px 0';
    button.style.background = noteType.disabled ? '#f0f0f0' : '#ffffff';
    button.style.color = noteType.disabled ? '#999' : '#1976d2';
    button.style.border = '1px solid #ddd';
    button.style.borderRadius = '4px';
    button.style.textAlign = 'left';
    button.style.fontSize = '1em';
    button.style.cursor = noteType.disabled ? 'not-allowed' : 'pointer';
    button.disabled = noteType.disabled;
    
    if (!noteType.disabled) {
      button.onmouseover = function() {
        this.style.background = '#f5f9ff';
        this.style.borderColor = '#1976d2';
      };
      
      button.onmouseout = function() {
        this.style.background = '#ffffff';
        this.style.borderColor = '#ddd';
      };
      
      button.onclick = function() {
        // Send message to content script to click this note type
        safeSendMessage(tabId, { 
          type: 'CLICK_NOTE_TYPE', 
          noteType: noteType.text 
        }, response => {
          if (response && response.success) {
            // After clicking, just close popup without activating tab
            window.close();
          } else {
            // Show error if selection failed
            button.style.background = '#fff0f0';
            button.style.borderColor = '#ff6b6b';
            button.textContent = 'Error selecting ' + noteType.text;
            setTimeout(() => {
              button.style.background = '#ffffff';
              button.style.borderColor = '#ddd';
              button.textContent = noteType.text;
            }, 2000);
          }
        });
      };
    }
    
    container.appendChild(button);
  });
  
  // Add a back button
  const backButton = document.createElement('button');
  backButton.textContent = 'Back';
  backButton.style.display = 'block';
  backButton.style.width = '50%';
  backButton.style.margin = '20px auto 0';
  backButton.style.padding = '8px';
  backButton.style.background = '#f0f0f0';
  backButton.style.border = '1px solid #ddd';
  backButton.style.borderRadius = '4px';
  backButton.style.cursor = 'pointer';
  backButton.onclick = function() {
    // Remove the note types container
    container.remove();
    // Reinitialize the popup
    popupInit();
  };
  container.appendChild(backButton);
  
  // Add to document
  document.body.appendChild(container);
}

function clearNotesAndShowMicControls() {
  notesListDiv.innerHTML = '';
  // Create placeholder divs in correct order so async callbacks can populate them
  ensureControlDivsExist();
}

// Ensure all control divs exist in correct order: mic-selector -> note-type -> mic-btn -> generate-note
function ensureControlDivsExist() {
  const btnContainer = document.getElementById('btn-container');

  // Create mic-selector-div if not exists
  let micSelectorDiv = document.getElementById('mic-selector-div');
  if (!micSelectorDiv) {
    micSelectorDiv = document.createElement('div');
    micSelectorDiv.id = 'mic-selector-div';
    micSelectorDiv.style.margin = '12px 0';
    if (btnContainer) {
      btnContainer.insertAdjacentElement('afterend', micSelectorDiv);
    } else {
      document.body.appendChild(micSelectorDiv);
    }
  }

  // Create note-type-selector-div if not exists
  let noteTypeDiv = document.getElementById('note-type-selector-div');
  if (!noteTypeDiv) {
    noteTypeDiv = document.createElement('div');
    noteTypeDiv.id = 'note-type-selector-div';
    noteTypeDiv.style.margin = '12px 0';
    micSelectorDiv.insertAdjacentElement('afterend', noteTypeDiv);
  }

  // Create mic-btn-div if not exists
  let micBtnDiv = document.getElementById('mic-btn-div');
  if (!micBtnDiv) {
    micBtnDiv = document.createElement('div');
    micBtnDiv.id = 'mic-btn-div';
    micBtnDiv.style.textAlign = 'center';
    micBtnDiv.style.margin = '12px 0';
    noteTypeDiv.insertAdjacentElement('afterend', micBtnDiv);
  }

  // Create generate-note-div if not exists
  let genDiv = document.getElementById('generate-note-div');
  if (!genDiv) {
    genDiv = document.createElement('div');
    genDiv.id = 'generate-note-div';
    genDiv.style.textAlign = 'center';
    genDiv.style.margin = '12px 0';
    micBtnDiv.insertAdjacentElement('afterend', genDiv);
  }
}

function retryFetchMicSelector(maxRetries = 10, interval = 300) {
  let attempts = 0;
  function tryFetch() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_OPTIONS' }, function(response) {
          if (response && response.success && response.options && response.options.length > 0) {
            console.log('[DEBUG] renderMicSelector with options:', response.options, 'selected:', response.selected);
            renderMicSelector(response.options, response.selected);
            // Also fetch note type selector
            fetchNoteTypeSelector();
            syncMicStateAndRender();
            renderGenerateNoteButton();
            // Success, stop retrying
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(tryFetch, interval);
          } else {
            // Max retries reached - check if it's a permission issue
            console.log('[DEBUG] Max retries reached, checking microphone permission...');
            checkMicPermissionAndActivateTab(tab);
          }
        });
      }
    });
  }
  tryFetch();
}

// Check microphone permission and activate tab if permission needs to be granted
function checkMicPermissionAndActivateTab(tab) {
  // First check if recording is active - if so, mic selector is hidden intentionally
  safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(micStateResponse) {
    console.log('[DEBUG] Mic state before permission check:', micStateResponse);

    if (micStateResponse && micStateResponse.success && (micStateResponse.micActive || micStateResponse.isResume)) {
      // Recording is active or paused - mic selector is intentionally hidden
      // Just render controls without showing any error message
      console.log('[DEBUG] Recording active/paused, mic selector hidden intentionally');
      syncMicStateAndRender();
      fetchNoteTypeSelector();
      renderGenerateNoteButton();
      return;
    }

    // Not recording - check if it's a permission issue
    safeSendMessage(tab.id, { type: 'CHECK_MICROPHONE_PERMISSION' }, function(response) {
      console.log('[DEBUG] Microphone permission check response:', response);

      if (response && response.success && response.state) {
        if (response.state === 'prompt' || response.state === 'denied') {
          console.log('[DEBUG] Microphone permission needs to be granted, activating tab');

          // Show a message to the user
          showMicPermissionMessage(response.state);

          // Activate the Doximity tab so user can grant permission
          chrome.tabs.update(tab.id, { active: true });
        } else if (response.state === 'granted') {
          // Permission is granted but mic selector still empty - might be a page issue
          console.log('[DEBUG] Microphone permission granted but selector empty - page may still be loading');
          showMicPermissionMessage('loading');
        }
      } else {
        // Couldn't check permission (API not supported), activate tab anyway
        console.log('[DEBUG] Could not check microphone permission, activating tab as fallback');
        showMicPermissionMessage('unknown');
        chrome.tabs.update(tab.id, { active: true });
      }

      // Always render the controls even if mic selector is empty
      syncMicStateAndRender();
      renderGenerateNoteButton();
    });
  });
}

// Show a message about microphone permission status
function showMicPermissionMessage(state) {
  let micDiv = document.getElementById('mic-selector-div');
  if (!micDiv) {
    micDiv = document.createElement('div');
    micDiv.id = 'mic-selector-div';
    micDiv.style.margin = '12px 0';
    const btnContainer = document.getElementById('btn-container');
    if (btnContainer) {
      btnContainer.insertAdjacentElement('afterend', micDiv);
    } else {
      document.body.appendChild(micDiv);
    }
  }

  micDiv.innerHTML = '';

  const messageDiv = document.createElement('div');
  messageDiv.style.padding = '10px';
  messageDiv.style.borderRadius = '4px';
  messageDiv.style.fontSize = '0.9em';
  messageDiv.style.textAlign = 'center';

  if (state === 'prompt') {
    messageDiv.style.background = '#fff3cd';
    messageDiv.style.border = '1px solid #ffc107';
    messageDiv.innerHTML = '<b>Microphone Permission Required</b><br>The Doximity tab has been activated.<br>Please allow microphone access when prompted.';
  } else if (state === 'denied') {
    messageDiv.style.background = '#f8d7da';
    messageDiv.style.border = '1px solid #f5c6cb';
    messageDiv.innerHTML = '<b>Microphone Access Denied</b><br>Please enable microphone access in your browser settings for Doximity.';
  } else if (state === 'loading') {
    messageDiv.style.background = '#d1ecf1';
    messageDiv.style.border = '1px solid #bee5eb';
    messageDiv.innerHTML = '<b>Loading Microphone Options</b><br>The page is still loading. Try clicking "Take Notes" again.';
  } else {
    messageDiv.style.background = '#e2e3e5';
    messageDiv.style.border = '1px solid #d6d8db';
    messageDiv.innerHTML = '<b>Microphone Setup</b><br>Please ensure microphone access is enabled on the Doximity page.';
  }

  micDiv.appendChild(messageDiv);

  // Add a button to retry
  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry';
  retryBtn.style.marginTop = '8px';
  retryBtn.style.padding = '6px 16px';
  retryBtn.style.background = '#2C90ED';
  retryBtn.style.color = '#fff';
  retryBtn.style.border = 'none';
  retryBtn.style.borderRadius = '4px';
  retryBtn.style.cursor = 'pointer';
  retryBtn.onclick = function() {
    retryBtn.textContent = 'Checking...';
    retryBtn.disabled = true;
    retryFetchMicSelector(15, 500);
  };
  micDiv.appendChild(retryBtn);
}

// Add debug logging to tab finding and Cancel Notes flow
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
btnContainer.style.alignItems = 'center'; // Vertically center the buttons

btnContainer.appendChild(takeNotesBtn);
btnContainer.appendChild(stopNotesBtn);
// Initially hide Cancel Notes - only show on recording view
stopNotesBtn.style.display = 'none';
const popupContainer = document.getElementById('popup-container') || document.body;
popupContainer.insertBefore(btnContainer, popupContainer.firstChild);

function reloadNotesListAndFetch(tab, cb) {
  chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_TO_VISIT_NOTES_LIST' }, function(navResp) {
    if (navResp && navResp.success) {
      // Wait longer if navigation occurred, then fetch notes
      const waitMs = navResp.navigated ? 2200 : 500;
      setTimeout(() => {
        fetchNotesAndShow();
        if (cb) cb();
      }, waitMs);
    } else {
      // Fallback: just fetch notes
      fetchNotesAndShow();
      if (cb) cb();
    }
  });
}

takeNotesBtn.onclick = () => {
  // Save state so we return to recording view if popup reopens
  popupMode = 'recording';
  savePopupState();

  // Toggle button visibility
  takeNotesBtn.style.display = 'none';
  stopNotesBtn.style.display = 'block';

  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      const visitsNewUrl = 'https://www.doximity.com/scribe/visits/new';

      // Check if already on visits/new - skip navigation if so
      if (tab.url && tab.url.includes('/scribe/visits/new')) {
        console.log('[DEBUG] Take Notes: Already on visits/new, skipping navigation');
        clearNotesAndShowMicControls();
        retryFetchMicSelector(15, 500);
        return;
      }

      // Navigate directly to visits/new page where mic selector is available
      console.log('[DEBUG] Take Notes: Navigating to', visitsNewUrl);

      chrome.tabs.update(tab.id, { url: visitsNewUrl }, function() {
        // Wait for page to load, then fetch mic options
        clearNotesAndShowMicControls();

        // Use chrome.tabs.onUpdated to detect when page is loaded
        const listener = function(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            console.log('[DEBUG] Take Notes: Page loaded, fetching mic selector');
            // Give the page a moment to render, then fetch mic options
            setTimeout(() => {
              retryFetchMicSelector(15, 500); // More retries, longer interval
            }, 500);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Fallback: if listener doesn't fire within 10s, try anyway
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          retryFetchMicSelector();
        }, 10000);
      });
    } else {
      // No Doximity tab found, open a new one
      chrome.tabs.create({ url: 'https://www.doximity.com/scribe/visits/new', active: true }, function(newTab) {
        clearNotesAndShowMicControls();
        setTimeout(() => retryFetchMicSelector(15, 500), 2000);
      });
    }
  });
};

stopNotesBtn.onclick = () => {
  // Save state so we return to notes view if popup reopens
  popupMode = 'notes';
  savePopupState();

  // Toggle button visibility
  stopNotesBtn.style.display = 'none';
  takeNotesBtn.style.display = 'block';

  findDoximityTabOrPrompt(function(tab) {
    if (tab) {
      console.log('[Cascade Debug] Sending TRIGGER_STOP_NOTES to tab:', tab.url);
      safeSendMessage(tab.id, { type: 'TRIGGER_STOP_NOTES' }, function() {
        forceNavigateToCachedVisitNotes(tab);
        reloadNotesListAndFetch(tab);
        window.close();
      });
    }
  });
};

// Helper: force navigation to cached visit notes UUID in the chosen tab
function forceNavigateToCachedVisitNotes(tab) {
  chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
    if (lastVisitUuid) {
      const url = `https://www.doximity.com/scribe/visit_notes/${lastVisitUuid}`;
      console.log('[Cascade Debug] Forcing navigation to:', url, 'in tab:', tab.id);
      chrome.tabs.update(tab.id, { url });
    } else {
      showInstructions(true, 'No cached visit UUID found. Please open a visit notes page first.');
    }
  });
}

// Example usage: call this in place of any navigation logic after Stop/Cancel/Discard
// E.g., in stopNotesBtn.onclick, after TRIGGER_STOP_NOTES:
// forceNavigateToCachedVisitNotes(tab);

function fillNoteTemplate(noteBody, clientData) {
  const replacements = {
    '[Name]': clientData.name,
    '[DOB]': clientData.DOB,
    '[MRN]': clientData.MRN,
    '[Referring Provider Name]': clientData.referring_provider,
    '[Consulting Provider Name]': clientData.provider,
    '[Date]': clientData.date,
  };
  let filled = noteBody;
  for (const [ph, val] of Object.entries(replacements)) {
    if (val) filled = filled.replaceAll(ph, val);
  }
  return filled;
}

function parseDateTime(dateStr, timeStr) {
  // Accepts both 'Apr 16, 2025 8:42 AM' and '4/16/2025, 8:42:57 AM'
  // Try to parse with Date constructor, fallback to manual split
  let dt = new Date(`${dateStr} ${timeStr}`);
  if (!isNaN(dt)) return dt;
  // Try US short format: MM/DD/YYYY, HH:MM:SS AM/PM
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [_, m, d, y] = match;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timeStr.replace(/ /, '')}`);
  }
  return new Date(); // fallback
}

function isNoteInVisitWindow(noteTitle, clientData) {
  // Try both formats: 'Apr 16, 2025 8:42 AM' and '4/16/2025, 8:42:57 AM'
  let match = noteTitle.match(/^(\d{1,2}\/\d{1,2}\/\d{4}), (\d{1,2}:\d{2}:\d{2} [AP]M)/);
  let noteDT = null;
  if (match) {
    const [_, noteDate, noteTime] = match;
    noteDT = parseDateTime(noteDate, noteTime);
  } else {
    match = noteTitle.match(/^([A-Za-z]{3} \d{1,2}, \d{4}) (\d{1,2}:\d{2} (AM|PM))/);
    if (match) {
      const [_, noteDate, noteTime] = match;
      noteDT = parseDateTime(noteDate, noteTime);
    }
  }
  if (!noteDT) return false;
  const visitDate = clientData.date;
  const visitStart = clientData.visit_start;
  const visitEnd = clientData.visit_end;
  if (!visitDate || !visitStart || !visitEnd) return false;
  const visitStartDT = parseDateTime(visitDate, visitStart);
  const visitEndDT = parseDateTime(visitDate, visitEnd);
  return noteDT >= visitStartDT && noteDT <= visitEndDT;
}

function renderNoteDivElement(idx, body, note, hasBody, title) {
  const div = document.createElement('div');
  div.style.marginBottom = '10px';
  div.style.padding = '8px';
  div.style.background = hasBody ? '#f2f2f2' : '#fafafa';
  div.style.borderRadius = '4px';
  div.style.border = hasBody ? '2px solid #2C90ED' : '1px solid #ddd';
  div.style.cursor = 'pointer';
  
  // Create header with title and timestamp
  div.innerHTML = `<b>${title}</b><br><small>${note.created_at ? new Date(note.created_at).toLocaleString() : ''}</small>`;
  
  // Add note body if available
  if (hasBody) {
    div.innerHTML += `<br><pre style="white-space:pre-wrap;font-size:0.95em;margin:4px 0 0 0;">${body.substring(0, 200) + (body.length > 200 ? '...' : '')}</pre>`;
  }
  
  // Add the Copy button if we have a body
  if (hasBody) {
    // Create button container to keep them together
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '5px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '3px'; // Small gap between buttons
    
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    // Remove right margin since we're using gap in flex container
    copyBtn.style.padding = '1px 8px';
    copyBtn.style.lineHeight = '1.2';
    copyBtn.style.fontSize = '0.9em';
    copyBtn.style.height = 'auto';
    
    copyBtn.onclick = function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(body || '').then(function() {
        copyBtn.textContent = 'Copied!';
        setTimeout(function() { 
          copyBtn.textContent = 'Copy'; 
        }, 900);
      });
    };

    // Add Save Snippet button
    const saveSnippetBtn = document.createElement('button');
    saveSnippetBtn.textContent = 'Save Snippet';
    // Remove top margin since we're using the container's margin
    saveSnippetBtn.style.padding = '1px 8px';
    saveSnippetBtn.style.lineHeight = '1.2';
    saveSnippetBtn.style.fontSize = '0.9em';
    saveSnippetBtn.style.height = 'auto';

    saveSnippetBtn.onclick = function(e) {
      e.stopPropagation();
      const noteTimestampMs = note.created_at ? Date.parse(note.created_at) : Date.now();
      const defaultSnippetName = `Snippet-${formatTimestampForSnippetName(noteTimestampMs)}`;
      const noteBody = body || ''; // Use the body variable already in scope
      const targetExtensionId = 'ljlmfclhdpcppglkaiieomhmpnfilagd';

      // First, fetch available folders from the target extension
      saveSnippetBtn.textContent = 'Loading...';
      saveSnippetBtn.disabled = true;
      
      chrome.runtime.sendMessage(
        targetExtensionId,
        { type: 'GET_FOLDERS' },
        function(response) {
          saveSnippetBtn.textContent = 'Save Snippet';
          saveSnippetBtn.disabled = false;
          
          let folders = [];
          if (response?.success && response.folders) {
            console.log('[Cascade Debug] Received folder structure:', response.folders);
            // Convert to array if it's a single object
            folders = Array.isArray(response.folders) ? response.folders : [response.folders];
          } else {
            console.error('[Cascade Error] Failed to get folders:', response?.error || chrome.runtime.lastError);
            // Continue with an empty list, we'll have a default option
            folders = [{ id: 'snippets', name: 'Snippets', path: 'Snippets' }];
          }
          
          // Create and show the custom dialog with the folders
          showSnippetDialog(defaultSnippetName, folders, function(snippetName, folderId, folderName, createNewFolder) {
            // This is the callback function that runs when dialog is submitted
            console.log(`[Cascade Debug] Saving snippet with name: ${snippetName}, folder: ${folderName} (${folderId}), createNewFolder: ${createNewFolder}`);
            
            // First, test ping as suggested
            console.log(`[Cascade Debug] Testing simple ping to ${targetExtensionId}...`);
            chrome.runtime.sendMessage(
              targetExtensionId,
              { type: 'ping' },
              function(pingResponse) {
                console.log('[Cascade Debug] Simple ping response:', pingResponse);
                console.log('[Cascade Debug] Simple ping error:', chrome.runtime.lastError ? JSON.stringify(chrome.runtime.lastError, Object.getOwnPropertyNames(chrome.runtime.lastError)) : 'No error');
                
                // Continue with the original logic
                trySendingSnippet(snippetName, folderId, folderName, createNewFolder);
              }
            );
          });
        }
      );
      
      function trySendingSnippet(snippetName, folderId, folderName, createNewFolder) {
        // Simple ping to check if extension is available
        try {
          console.log(`[Cascade Debug] Checking if extension ${targetExtensionId} is available...`);
          
          let messagePayload;
          
          if (createNewFolder) {
            // Format for creating a new folder
            messagePayload = {
        type: 'updateStorage',
        data: {
          key: 'UserSnippets',
          value: {
            snippets: {
              type: 'folder',
                    name: 'Snippets', // Root folder
                    timestamp: Date.now(),
                    list: [
                      {
                        type: 'folder',
                        name: folderName, // This creates a new folder
                        timestamp: Date.now() + 1,
              list: [
                {
                  type: 'snip',
                  name: snippetName,
                  body: noteBody,
                            timestamp: noteTimestampMs
                }
                        ]
                      }
              ]
            }
          }
        }
      };
          } else {
            // Format for using an existing folder
            messagePayload = {
              type: 'updateStorage',
              data: {
                key: 'UserSnippets',
                targetFolderId: folderId, // ID from the folder picker
                value: {
                  snippets: {
                    type: 'snip',
                    name: snippetName,
                    body: noteBody,
                    timestamp: noteTimestampMs
                  }
                }
              }
            };
          }

      console.log(`[Cascade Debug] Sending Snippet to ${targetExtensionId}:`, messagePayload);
      saveSnippetBtn.textContent = 'Saving...';
      saveSnippetBtn.disabled = true;

          chrome.runtime.sendMessage(targetExtensionId, messagePayload, function(resp) {
        if (chrome.runtime.lastError) {
              handleExtensionError(chrome.runtime.lastError, targetExtensionId, noteBody);
        } else if (resp?.success) {
            console.log(`[Cascade Debug] Snippet saved response from ${targetExtensionId}:`, resp);
            saveSnippetBtn.textContent = 'Saved!';
              setTimeout(function() {
                 saveSnippetBtn.textContent = 'Save Snippet';
                 saveSnippetBtn.disabled = false;
             }, 1000);
        } else {
            console.error(`[Cascade Error] Snippet save failed in ${targetExtensionId}:`, resp?.error);
            saveSnippetBtn.textContent = 'Failed!';
              setTimeout(function() {
                 saveSnippetBtn.textContent = 'Save Snippet';
                 saveSnippetBtn.disabled = false;
             }, 1500);
        }
      });
        } catch (err) {
          handleExtensionError(err, targetExtensionId, noteBody);
        }
      }
      
      // Helper function to show the dialog for customizing snippet name and folder
      function showSnippetDialog(defaultName, folders, callback) {
        // Create a modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.position = 'fixed';
        backdrop.style.top = '0';
        backdrop.style.left = '0';
        backdrop.style.width = '100%';
        backdrop.style.height = '100%';
        backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
        backdrop.style.zIndex = '1000';
        backdrop.style.display = 'flex';
        backdrop.style.justifyContent = 'center';
        backdrop.style.alignItems = 'center';
        
        // Create modal dialog
        const dialog = document.createElement('div');
        dialog.style.backgroundColor = 'white';
        dialog.style.borderRadius = '8px';
        dialog.style.padding = '16px';
        dialog.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        dialog.style.width = '80%';
        dialog.style.maxWidth = '300px';
        
        // Dialog title
        const title = document.createElement('h3');
        title.textContent = 'Save Snippet';
        title.style.margin = '0 0 12px 0';
        title.style.fontSize = '1.1em';
        
        // Name input
        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Name:';
        nameLabel.style.display = 'block';
        nameLabel.style.marginBottom = '4px';
        nameLabel.style.fontWeight = 'bold';
        
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = defaultName;
        nameInput.style.width = '100%';
        nameInput.style.padding = '6px';
        nameInput.style.marginBottom = '12px';
        nameInput.style.boxSizing = 'border-box';
        nameInput.style.border = '1px solid #ccc';
        nameInput.style.borderRadius = '4px';
        
        // New folder checkbox
        const newFolderContainer = document.createElement('div');
        newFolderContainer.style.marginBottom = '12px';
        
        const newFolderCheckbox = document.createElement('input');
        newFolderCheckbox.type = 'checkbox';
        newFolderCheckbox.id = 'new-folder-checkbox';
        newFolderCheckbox.style.marginRight = '8px';
        
        const newFolderLabel = document.createElement('label');
        newFolderLabel.htmlFor = 'new-folder-checkbox';
        newFolderLabel.textContent = 'Create new folder';
        
        newFolderContainer.appendChild(newFolderCheckbox);
        newFolderContainer.appendChild(newFolderLabel);
        
        // New folder name input (initially hidden)
        const newFolderNameContainer = document.createElement('div');
        newFolderNameContainer.style.marginBottom = '12px';
        newFolderNameContainer.style.display = 'none';
        
        const newFolderNameLabel = document.createElement('label');
        newFolderNameLabel.textContent = 'New Folder Name:';
        newFolderNameLabel.style.display = 'block';
        newFolderNameLabel.style.marginBottom = '4px';
        newFolderNameLabel.style.fontWeight = 'bold';
        
        const newFolderNameInput = document.createElement('input');
        newFolderNameInput.type = 'text';
        newFolderNameInput.value = 'New Folder';
        newFolderNameInput.style.width = '100%';
        newFolderNameInput.style.padding = '6px';
        newFolderNameInput.style.boxSizing = 'border-box';
        newFolderNameInput.style.border = '1px solid #ccc';
        newFolderNameInput.style.borderRadius = '4px';
        
        newFolderNameContainer.appendChild(newFolderNameLabel);
        newFolderNameContainer.appendChild(newFolderNameInput);
        
        // Existing folder dropdown
        const existingFolderContainer = document.createElement('div');
        existingFolderContainer.style.marginBottom = '12px';
        
        const folderLabel = document.createElement('label');
        folderLabel.textContent = 'Select Folder:';
        folderLabel.style.display = 'block';
        folderLabel.style.marginBottom = '4px';
        folderLabel.style.fontWeight = 'bold';
        
        const folderSelect = document.createElement('select');
        folderSelect.style.width = '100%';
        folderSelect.style.padding = '6px';
        folderSelect.style.boxSizing = 'border-box';
        folderSelect.style.border = '1px solid #ccc';
        folderSelect.style.borderRadius = '4px';
        
        // Toggle between new folder and existing folder
        newFolderCheckbox.onchange = function() {
          if (newFolderCheckbox.checked) {
            existingFolderContainer.style.display = 'none';
            newFolderNameContainer.style.display = 'block';
          } else {
            existingFolderContainer.style.display = 'block';
            newFolderNameContainer.style.display = 'none';
          }
        };
        
        existingFolderContainer.appendChild(folderLabel);
        existingFolderContainer.appendChild(folderSelect);
        
        // Add a default option
        const defaultOption = document.createElement('option');
        defaultOption.value = 'snippets';
        defaultOption.textContent = 'Snippets (Default)';
        defaultOption.dataset.name = 'Snippets';
        folderSelect.appendChild(defaultOption);
        
        // Helper function to add folder options recursively
        function addFolderOptions(folderList, level = 0) {
          if (!folderList || folderList.length === 0) return;
          
          folderList.forEach(folder => {
            // Skip empty or invalid folders
            if (!folder || !folder.id) return;
            
            // Skip the default one if it has the same id
            if (folder.id === 'snippets' && folder.name === 'Snippets') return;
            
            const option = document.createElement('option');
            option.value = folder.id;
            // Add indentation for nested folders
            option.textContent = '  '.repeat(level) + (level > 0 ? '└ ' : '') + folder.name;
            option.dataset.name = folder.name;
            folderSelect.appendChild(option);
            
            // Add subfolders recursively
            if (folder.subfolders && Array.isArray(folder.subfolders) && folder.subfolders.length > 0) {
              console.log(`[Cascade Debug] Adding ${folder.subfolders.length} subfolders for ${folder.name}`);
              addFolderOptions(folder.subfolders, level + 1);
            }
          });
        }
        
        // Add all folders to the dropdown
        console.log('[Cascade Debug] Adding folders to dropdown:', folders);
        addFolderOptions(folders);
        
        // Button container
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.justifyContent = 'flex-end';
        btnContainer.style.gap = '8px';
        
        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.padding = '6px 12px';
        cancelBtn.style.border = '1px solid #ccc';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.backgroundColor = '#f8f8f8';
        cancelBtn.style.cursor = 'pointer';
        
        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.padding = '6px 12px';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '4px';
        saveBtn.style.backgroundColor = '#1976d2';
        saveBtn.style.color = 'white';
        saveBtn.style.cursor = 'pointer';
        
        // Add elements to dialog
        dialog.appendChild(title);
        dialog.appendChild(nameLabel);
        dialog.appendChild(nameInput);
        dialog.appendChild(newFolderContainer);
        dialog.appendChild(newFolderNameContainer);
        dialog.appendChild(existingFolderContainer);
        dialog.appendChild(btnContainer);
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(saveBtn);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        
        // Focus the name input
        setTimeout(() => nameInput.focus(), 50);
        
        // Handle button clicks
        cancelBtn.onclick = function() {
          document.body.removeChild(backdrop);
        };
        
        saveBtn.onclick = function() {
          const name = nameInput.value.trim() || defaultName;
          
          let folderId, folderName, createNewFolder;
          
          if (newFolderCheckbox.checked) {
            // Using new folder
            createNewFolder = true;
            folderName = newFolderNameInput.value.trim() || 'New Folder';
            folderId = 'snippets'; // Parent folder ID
          } else {
            // Using existing folder
            createNewFolder = false;
            folderId = folderSelect.value;
            // Get the folder name from the selected option
            folderName = folderSelect.options[folderSelect.selectedIndex].dataset.name || 
                        folderSelect.options[folderSelect.selectedIndex].textContent.trim().replace(/^[└ ]+/, '');
          }
          
          console.log(`[Cascade Debug] Selected folder: ID=${folderId}, Name=${folderName}, CreateNew=${createNewFolder}`);
          
          document.body.removeChild(backdrop);
          callback(name, folderId, folderName, createNewFolder);
        };
        
        // Allow pressing Enter to save
        nameInput.onkeydown = folderSelect.onkeydown = function(e) {
          if (e.key === 'Enter') {
            saveBtn.click();
          }
        };
      }
      
      // Helper function to handle extension communication errors
      function handleExtensionError(error, extensionId, noteBody) {
        console.error(`[Cascade Error] Communication with ${extensionId} failed:`, error);
        console.error(`Error details:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
        
        // Fallback to clipboard
        navigator.clipboard.writeText(noteBody).then(function() {
          saveSnippetBtn.textContent = 'Copied to clipboard!';
          // Show a more detailed error message
          const errorDiv = document.createElement('div');
          errorDiv.style.color = 'red';
          errorDiv.style.fontSize = '0.8em';
          errorDiv.style.marginTop = '3px';
          errorDiv.textContent = 'Target extension not available. Content copied to clipboard instead.';
          if (buttonContainer.nextSibling) {
            div.insertBefore(errorDiv, buttonContainer.nextSibling);
          } else {
            div.appendChild(errorDiv);
          }
          
          setTimeout(function() {
            saveSnippetBtn.textContent = 'Save Snippet';
            saveSnippetBtn.disabled = false;
            try {
              if (errorDiv && errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
              }
            } catch (e) {}
          }, 3000);
        }).catch(function() {
          saveSnippetBtn.textContent = 'Failed!';
          setTimeout(function() {
            saveSnippetBtn.textContent = 'Save Snippet';
            saveSnippetBtn.disabled = false;
          }, 1500);
        });
      }
    };
    
    // Add buttons to container
    buttonContainer.appendChild(copyBtn);
    // Only show Save Snippet button if DotExpander integration is enabled
    if (dotExpanderIntegrationEnabled) {
      buttonContainer.appendChild(saveSnippetBtn);
    }
    
    // Add container to div
    div.appendChild(document.createElement('br'));
    div.appendChild(buttonContainer);
  } else {
    // Add View Note button if we don't have a body
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '5px';
    
    const extractBtn = document.createElement('button');
    extractBtn.textContent = 'View Note';
    // Remove top margin since we're using the container's margin
    extractBtn.style.background = '#4CAF50';
    extractBtn.style.color = 'white';
    extractBtn.style.border = 'none';
    extractBtn.style.borderRadius = '4px';
    extractBtn.style.padding = '1px 8px';
    extractBtn.style.lineHeight = '1.2';
    extractBtn.style.fontSize = '0.9em';
    extractBtn.style.height = 'auto';
    
    extractBtn.onclick = function(e) {
      e.stopPropagation();
      findDoximityTabOrPrompt(function(tab) {
        if (tab) {
          if (note.uuid) {
            const url = `https://www.doximity.com/scribe/visit_notes/${note.uuid}`;
            chrome.tabs.update(tab.id, { url: url, active: true });
            extractBtn.textContent = 'Loading...';
            extractBtn.disabled = true;
            
            setTimeout(function() {
              chrome.tabs.sendMessage(tab.id, { 
                type: 'EXTRACT_VISIBLE_NOTE', 
                uuid: note.uuid 
              }, function(response) {
                if (response && response.success && response.body) {
                  console.log('[DEBUG] Successfully extracted body for', note.uuid);
                  // Update the display with the extracted body
                  const bodyText = response.body;
                  div.innerHTML += `<br><pre style="white-space:pre-wrap;font-size:0.95em;margin:4px 0 0 0;">${bodyText.substring(0, 200) + (bodyText.length > 200 ? '...' : '')}</pre>`;
                  
                  // Update cache
                  allNoteBodies[note.uuid] = bodyText;
                  chrome.storage.local.get('dox_note_bodies', function(result) {
                    const bodies = result.dox_note_bodies || {};
                    bodies[note.uuid] = bodyText;
                    chrome.storage.local.set({ dox_note_bodies: bodies });
                  });
                }
                extractBtn.textContent = 'View Note';
                extractBtn.disabled = false;
              });
            }, 1500);
          }
        }
      });
    };
    
    buttonContainer.appendChild(extractBtn);
    div.appendChild(document.createElement('br'));
    div.appendChild(buttonContainer);
  }
  
  // Make the whole div clickable to open the note in Doximity
  div.onclick = function() {
    findDoximityTabOrPrompt(function(tab) {
      if (tab) {
        if (note.uuid) {
          const url = `https://www.doximity.com/scribe/visit_notes/${note.uuid}`;
          chrome.tabs.update(tab.id, { url: url, active: true }, function() {
            window.close();
          });
        } else {
          chrome.tabs.sendMessage(tab.id, { type: 'OPEN_NOTE', label: note.label, note_label: note.note_label }, function() {
            window.close();
          });
        }
      }
    });
  };
  
  div.onmouseenter = function() { div.style.background = '#e6f0fb'; };
  div.onmouseleave = function() { div.style.background = hasBody ? '#f2f2f2' : '#fafafa'; };
  
  return div;
}

// --- Helper function to format timestamp for snippet name ---
function formatTimestampForSnippetName(timestampMs) {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
// --- End helper function ---

// Set initial height to auto - let content determine size
document.body.style.minHeight = '100px';
document.body.style.height = 'auto';
document.body.style.overflowY = 'hidden';
notesListDiv.style.maxHeight = 'none';
notesListDiv.style.overflowY = 'visible';

function setPopupHeightToFirstNote() {
  setTimeout(() => {
    // Let content determine height naturally
    document.body.style.height = 'auto';
    document.body.style.overflowY = 'hidden';
    notesListDiv.style.maxHeight = 'none';
    notesListDiv.style.overflowY = 'visible';
  }, 50);
}

// Implement a retry mechanism for scraping bodies
function retryScrapeBodies() {
  if (!pendingScrapeNotes || !pendingScrapeNotes.length) return;
  
  console.log('[DEBUG] Retrying body scraping for', pendingScrapeNotes.length, 'notes');
  
  findDoximityTabOrPrompt(function(tab) {
    if (!tab) return;
    
    // Focus the tab first to make sure it's active
    chrome.tabs.update(tab.id, { active: true }, () => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { 
          type: 'SCRAPE_ALL_NOTE_BODIES', 
          notes: pendingScrapeNotes 
        }, function(resp) {
          if (chrome.runtime.lastError) {
            console.log('[DEBUG] Retry still failed:', chrome.runtime.lastError);
            // Schedule another retry
            setTimeout(retryScrapeBodies, 5000);
          } else {
            console.log('[DEBUG] Retry successful, response:', resp);
            pendingScrapeNotes = null;
          }
        });
      }, 1000); // Give a moment for the tab to become active
    });
  });
}

// Add retry button for when scraping fails
function addRetryButton() {
  // Remove any existing retry button
  const existingBtn = document.getElementById('retry-scrape-btn');
  if (existingBtn) existingBtn.remove();
  
  const retryBtn = document.createElement('button');
  retryBtn.id = 'retry-scrape-btn';
  retryBtn.textContent = 'Load Full Note Content';
  retryBtn.style.background = '#4CAF50';
  retryBtn.style.color = 'white';
  retryBtn.style.border = 'none';
  retryBtn.style.padding = '8px 12px';
  retryBtn.style.borderRadius = '4px';
  retryBtn.style.margin = '8px auto';
  retryBtn.style.display = 'block';
  retryBtn.style.cursor = 'pointer';
  
  retryBtn.onclick = () => {
    retryBtn.textContent = 'Loading...';
    retryBtn.disabled = true;
    
    // Activate the tab and retry scraping
    retryScrapeBodies();
    
    // Show success message temporarily
    setTimeout(() => {
      retryBtn.textContent = 'Activated Doximity Tab';
      setTimeout(() => {
        retryBtn.textContent = 'Load Full Note Content';
        retryBtn.disabled = false;
      }, 2000);
    }, 1000);
  };
  
  // Add to top of notes list
  if (notesListDiv.firstChild) {
    notesListDiv.insertBefore(retryBtn, notesListDiv.firstChild);
  } else {
    notesListDiv.appendChild(retryBtn);
  }
}

// When popup is opened, clear the badge
document.addEventListener('DOMContentLoaded', function() {
  // Clear the badge text
  chrome.action.setBadgeText({ text: "" });
});

popupInit();
