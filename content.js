// Startup debug log to verify injection
console.log('[Cascade Debug] Content script loaded at', window.location.href);

// Immediately cache visitUuid if on a visit notes page
const notesUuidMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
if (notesUuidMatch) {
  const visitUuid = notesUuidMatch[1];
  chrome.storage.local.set({ lastVisitUuid: visitUuid }, () => {
    console.log('[Cascade Debug] Cached visitUuid on load:', visitUuid);
  });
}

// Check if we detected a message on the previous page that didn't get processed due to navigation
try {
  const messageDetected = sessionStorage.getItem('scriberMessageDetected');
  const messageTimestamp = sessionStorage.getItem('scriberMessageTimestamp');
  
  if (messageDetected === 'true' && messageTimestamp) {
    const timestamp = parseInt(messageTimestamp, 10);
    const now = Date.now();
    // Only resend if the message was detected in the last 10 seconds
    if (!isNaN(timestamp) && (now - timestamp) < 10000) {
      console.log('[DEBUG] Detected unprocessed message from previous page, notifying background');
      
      // Clear the flag to prevent duplicate notifications
      sessionStorage.removeItem('scriberMessageDetected');
      sessionStorage.removeItem('scriberMessageTimestamp');
      
      // Send a delayed message to ensure the page is fully loaded
      setTimeout(() => {
        chrome.runtime.sendMessage({ 
          type: "NEW_MESSAGE",
          url: window.location.href,
          timestamp: now,
          fromNavigation: true,
          originalTimestamp: timestamp
        });
      }, 1000);
    } else if (messageDetected === 'true') {
      // Clear old message flags
      sessionStorage.removeItem('scriberMessageDetected');
      sessionStorage.removeItem('scriberMessageTimestamp');
    }
  }
} catch (e) {
  console.error('[DEBUG] Error checking sessionStorage:', e);
}

function notifyBackground() {
  console.log("[DEBUG] notifyBackground - New message detected, sending NEW_MESSAGE to background script");
  
  // Log the current DOM state
  console.log("[DEBUG] Current URL:", window.location.href);
  
  // Check for note elements and log them
  const noteElements = document.querySelectorAll('.scribe-text, .dictation-text, .note-text, .transcript-text');
  console.log("[DEBUG] Found note elements:", noteElements.length);
  
  if (noteElements.length > 0) {
    // Log the first element content
    const firstNoteElem = noteElements[0];
    const noteText = firstNoteElem.textContent.substring(0, 100);
    console.log("[DEBUG] First note element content preview:", noteText);
    console.log("[DEBUG] First note element classes:", firstNoteElem.className);
  }
  
  // Track that we detected a message, in case of navigation
  try {
    // Use sessionStorage to persist across navigation
    sessionStorage.setItem('scriberMessageDetected', 'true');
    sessionStorage.setItem('scriberMessageTimestamp', Date.now().toString());
  } catch (e) {
    console.error('[DEBUG] Error setting sessionStorage:', e);
  }
  
  // Send the message with additional data about the current page
  chrome.runtime.sendMessage({ 
    type: "NEW_MESSAGE",
    url: window.location.href,
    timestamp: Date.now(),
    navigationAware: true
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[DEBUG] Error sending NEW_MESSAGE:", chrome.runtime.lastError);
    } else if (response) {
      console.log("[DEBUG] Got response from background for NEW_MESSAGE:", response);
    }
  });
}

const observer = new MutationObserver((mutations) => {
  console.log("[DEBUG] MutationObserver - Mutations detected:", mutations.length);
  
  // Log more details for debugging
  for (let i = 0; i < Math.min(mutations.length, 5); i++) {
    const mutation = mutations[i];
    console.log(`[DEBUG] Mutation ${i} - type: ${mutation.type}, target: ${mutation.target.nodeName}`);
    
    if (mutation.type === 'childList') {
      console.log(`[DEBUG] Mutation ${i} - addedNodes: ${mutation.addedNodes.length}, removedNodes: ${mutation.removedNodes.length}`);
      
      // Log some details about the first few added nodes
      for (let j = 0; j < Math.min(mutation.addedNodes.length, 3); j++) {
        const node = mutation.addedNodes[j];
        console.log(`[DEBUG] Mutation ${i} - addedNode ${j}: nodeType=${node.nodeType}, nodeName=${node.nodeName}, classes=${node.classList ? [...node.classList].join(',') : 'none'}`);
      }
    }
  }
  
  for (const mutation of mutations) {
    if (
      mutation.type === "childList" &&
      [...mutation.addedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          node.classList &&
          node.classList.contains("scribe-text")
      )
    ) {
      console.log("[DEBUG] MutationObserver - Detected new scribe-text element added to DOM");
      notifyBackground();
    }
    if (
      mutation.type === "characterData" &&
      mutation.target.parentElement &&
      mutation.target.parentElement.classList.contains("scribe-text")
    ) {
      console.log("[DEBUG] MutationObserver - Detected characterData change in scribe-text element");
      notifyBackground();
    }
    
    // Try alternative selectors in case class names have changed
    if (
      mutation.type === "childList" &&
      [...mutation.addedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          node.classList &&
          (node.classList.contains("dictation-text") || 
           node.classList.contains("note-text") ||
           node.classList.contains("transcript-text") ||
           node.querySelector('.scribe-text, .dictation-text, .note-text, .transcript-text'))
      )
    ) {
      console.log("[DEBUG] MutationObserver - Detected new dictation text element with alternative class");
      notifyBackground();
    }
  }
});

function observeScribeText() {
  const config = { childList: true, subtree: true, characterData: true };
  observer.observe(document.body, config);
}

observeScribeText();

// --- SPA Navigation Handling ---
(function monitorUrlChangeAndRefetchNotes() {
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (lastUrl.includes('/scribe/visit_notes')) {
        // Optionally, trigger a custom event or re-run your notes-fetching logic here
        window.postMessage({ type: 'REFETCH_NOTES' }, '*');
      }
    }
  }, 500);
})();

// Listen for REFETCH_NOTES event and re-fetch notes if popup asks
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'REFETCH_NOTES') {
    // No-op: This is just a hook for the popup to trigger a new fetch if needed
  }
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  console.log('[Cascade Debug] onMessage received:', msg, 'sender:', sender, 'window.location.href:', window.location.href);
  if (msg.type === 'FETCH_NOTES') {
    console.log('[Cascade Debug] FETCH_NOTES received');
    let responded = false;
    const timeout = setTimeout(() => {
      if (!responded) {
        sendResponse({ success: false, error: 'Timeout waiting for notes.' });
        responded = true;
      }
    }, 4000);

    fetch(window.location.href, { credentials: 'include' })
      .then(r => {
        const contentType = r.headers.get('content-type') || '';
        console.log('[DEBUG] Response content-type:', contentType);
        if (contentType.includes('application/json')) {
          return r.json().then(data => {
            console.log('[DEBUG] JSON API response received:', data);
            const visitNotes = (data.props && data.props.visit_notes) || [];
            console.log('[Cascade Debug] visitNotes (api):', visitNotes);
            if (!responded) {
              sendResponse({ success: true, data, source: 'api' });
              responded = true;
              clearTimeout(timeout);
            }
          });
        } else {
          const appDiv = document.getElementById('app');
          console.log('[DEBUG] appDiv found:', !!appDiv);
          if (!appDiv) {
            console.log('[DEBUG] Searching for alternative containers...');
            // Try alternative containers if the app div isn't found
            const possibleContainers = ['#root', '.app-container', '#app-root', 'main', 'body'];
            for (const selector of possibleContainers) {
              const container = document.querySelector(selector);
              if (container) {
                console.log('[DEBUG] Found alternative container:', selector);
                break;
              }
            }
            
            if (!responded) {
              sendResponse({ success: false, error: 'App div not found.' });
              responded = true;
              clearTimeout(timeout);
            }
            return;
          }
          const dataPage = appDiv.getAttribute('data-page');
          console.log('[DEBUG] dataPage attribute exists:', !!dataPage);
          if (!dataPage) {
            // Check for data in alternative formats
            console.log('[DEBUG] Checking for data in other attributes...');
            const dataAttrs = ['data-json', 'data-state', 'data-props', 'data-app'];
            let foundData = false;
            for (const attr of dataAttrs) {
              const data = appDiv.getAttribute(attr);
              if (data) {
                console.log('[DEBUG] Found data in attribute:', attr);
                foundData = true;
                break;
              }
            }
            
            // Attempt to look for notes directly in the DOM
            console.log('[DEBUG] Looking for notes directly in DOM...');
            const noteElements = document.querySelectorAll('.visit-notes-sidebar-note, .visit-note');
            console.log('[DEBUG] Direct DOM note elements found:', noteElements.length);
            
            if (!responded) {
              sendResponse({ success: false, error: 'data-page attribute missing.' });
              responded = true;
              clearTimeout(timeout);
            }
            return;
          }
          try {
            console.log('[DEBUG] Attempting to parse data-page JSON...');
            const parsed = JSON.parse(dataPage);
            console.log('[DEBUG] data-page parsed successfully:', parsed);
            console.log('[DEBUG] parsed.props exists:', !!parsed.props);
            console.log('[DEBUG] parsed.props.visit_notes exists:', !!(parsed.props && parsed.props.visit_notes));
            
            const visitNotes = (parsed.props && parsed.props.visit_notes) || [];
            console.log('[Cascade Debug] visitNotes (dom):', visitNotes);
            console.log('[DEBUG] visitNotes length:', visitNotes.length);
            
            if (!responded) {
              sendResponse({ success: true, data: parsed, source: 'dom' });
              responded = true;
              clearTimeout(timeout);
            }
          } catch (err) {
            console.log('[DEBUG] Error parsing data-page:', err);
            
            // Try to extract notes information directly from DOM as fallback
            console.log('[DEBUG] Attempting direct DOM extraction fallback...');
            const noteElements = document.querySelectorAll('.visit-notes-sidebar-note, .visit-note, .note-item');
            console.log('[DEBUG] Fallback DOM note elements found:', noteElements.length);
            
            // If we found note elements, create a minimal notes array
            const domExtractedNotes = [];
            if (noteElements.length > 0) {
              noteElements.forEach((el, idx) => {
                const title = el.textContent.trim();
                const uuid = el.dataset.uuid || el.dataset.noteId || `dom-note-${idx}`;
                domExtractedNotes.push({
                  uuid: uuid,
                  note_label: title,
                  created_at: new Date().toISOString()
                });
              });
              console.log('[DEBUG] DOM extracted notes:', domExtractedNotes);
              
              if (!responded) {
                sendResponse({ 
                  success: true, 
                  data: {props: {visit_notes: domExtractedNotes}}, 
                  source: 'dom-extracted' 
                });
                responded = true;
                clearTimeout(timeout);
              }
              return;
            }
            
            if (!responded) {
              sendResponse({ success: false, error: err.message });
              responded = true;
              clearTimeout(timeout);
            }
          }
        }
      })
      .catch(err => {
        console.log('[DEBUG] Error in fetch:', err);
        if (!responded) {
          sendResponse({ success: false, error: err.message });
          responded = true;
          clearTimeout(timeout);
        }
      });
    return true;
  }
  if (msg.type === 'TRIGGER_TAKE_NOTES') {
    const takeNotesBtn = document.querySelector('.visit-notes-template-take-notes-cta');
    if (takeNotesBtn) {
      takeNotesBtn.click();
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Take Notes button not found.' });
    }
    return true;
  }
  if (msg.type === 'TRIGGER_STOP_NOTES') {
    // Try to find Stop Notes, Discard, or Cancel button
    // Primary: use data-test attributes
    let stopBtn = document.querySelector('button[data-test-visit-session-discard]');
    if (!stopBtn) {
      stopBtn = document.querySelector('button[data-test-visit-session-cancel]');
    }
    if (!stopBtn) {
      // Fallback: look for button with text or class
      stopBtn = Array.from(document.querySelectorAll('button')).find(el =>
        (
          el.textContent.trim() === 'Stop Notes' ||
          el.textContent.trim() === 'Discard' ||
          el.classList.contains('visit-session-discard-button')
        ) &&
        !el.disabled &&
        el.offsetParent !== null
      );
    }
    if (stopBtn) {
      // If the Discard button is triggered, activate the Doximity tab
      if (stopBtn.hasAttribute('data-test-visit-session-discard') ||
          stopBtn.classList.contains('visit-session-discard-button')) {
        chrome.runtime.sendMessage({ type: 'ACTIVATE_DOXIMITY_TAB' });
      }
      stopBtn.click();
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Stop/Discard/Cancel button not found or not visible.' });
    }
    return true;
  }
  if (msg.type === 'OPEN_NOTE') {
    // Try to find the note in the sidebar by label or note_label and click it
    const label = msg.label || msg.note_label;
    if (label) {
      // Look for all sidebar note items
      const sidebarItems = Array.from(document.querySelectorAll('.visit-notes-sidebar .visit-notes-sidebar-note, .visit-notes-sidebar-note'));
      let found = false;
      for (const item of sidebarItems) {
        const text = item.innerText.trim();
        if (text === label || text.includes(label)) {
          item.click();
          found = true;
          break;
        }
      }
      sendResponse && sendResponse({ success: found });
    } else {
      sendResponse && sendResponse({ success: false, error: 'No label provided.' });
    }
    return true;
  }
  if (msg.type === 'GET_MICROPHONE_OPTIONS') {
    // Find the microphone select - look within the microphone list container
    // The ID is dynamically generated (v-1, v-2, etc.) so we use the container class
    let sel = document.querySelector('.visit-session-new-microphone-list select.dox-select-field');
    if (!sel) {
      // Fallback: look for select near a "Microphone" label
      const micLabel = Array.from(document.querySelectorAll('.dox-select-label-text')).find(
        el => el.textContent.trim() === 'Microphone'
      );
      if (micLabel) {
        const wrapper = micLabel.closest('.dox-select-wrapper');
        if (wrapper) {
          sel = wrapper.querySelector('select.dox-select-field');
        }
      }
    }
    if (sel) {
      const options = Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
      sendResponse && sendResponse({ success: true, options, selected: sel.value });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (msg.type === 'CHECK_MICROPHONE_PERMISSION') {
    // Check if browser has microphone permission for this origin
    navigator.permissions.query({ name: 'microphone' })
      .then(permissionStatus => {
        console.log('[Cascade Debug] Microphone permission state:', permissionStatus.state);
        sendResponse && sendResponse({
          success: true,
          state: permissionStatus.state // 'granted', 'denied', or 'prompt'
        });
      })
      .catch(err => {
        console.error('[Cascade Debug] Error checking microphone permission:', err);
        // Some browsers don't support this API, assume permission needs to be requested
        sendResponse && sendResponse({ success: false, error: err.message, state: 'unknown' });
      });
    return true; // Indicates we will send a response asynchronously
  }
  if (msg.type === 'SET_MICROPHONE') {
    // Find the microphone select using the same approach as GET_MICROPHONE_OPTIONS
    let sel = document.querySelector('.visit-session-new-microphone-list select.dox-select-field');
    if (!sel) {
      const micLabel = Array.from(document.querySelectorAll('.dox-select-label-text')).find(
        el => el.textContent.trim() === 'Microphone'
      );
      if (micLabel) {
        const wrapper = micLabel.closest('.dox-select-wrapper');
        if (wrapper) {
          sel = wrapper.querySelector('select.dox-select-field');
        }
      }
    }
    if (sel) {
      sel.value = msg.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (msg.type === 'GET_NOTE_TYPE_OPTIONS') {
    // Find the note type select by id or name
    let sel = document.querySelector('select#note_type_uuid, select[name="note_type_uuid"]');
    if (sel) {
      // Filter out disabled/hidden placeholder options
      const options = Array.from(sel.options)
        .filter(o => !o.disabled && !o.hidden && o.value)
        .map(o => ({ value: o.value, label: o.textContent.trim() }));
      sendResponse && sendResponse({ success: true, options, selected: sel.value });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (msg.type === 'SET_NOTE_TYPE') {
    // Find the note type select and set its value
    let sel = document.querySelector('select#note_type_uuid, select[name="note_type_uuid"]');
    if (sel) {
      sel.value = msg.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (msg.type === 'CLICK_MICROPHONE_BUTTON') {
    // Try to find and click the microphone/start/resume button
    let micBtn = null;

    // Primary: search through ALL labels to find Start, Record, or Resume
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume'].includes(text)) {
        micBtn = label.closest('button');
        console.log('[DEBUG] Found mic button via label:', text);
        break;
      }
    }

    if (!micBtn) {
      // Fallback: try data-test attributes
      micBtn = document.querySelector('button[data-test-visit-session-new-start-cta]');
      if (!micBtn) {
        // Resume button uses data-test-visit-session-cta
        micBtn = document.querySelector('button[data-test-visit-session-cta]');
      }
    }

    if (!micBtn) {
      // Last fallback: look for microphone icon SVG
      const micSvg = document.querySelector('svg[class*="icon-microphone"]');
      if (micSvg) {
        micBtn = micSvg.closest('button');
      }
    }

    if (micBtn) {
      micBtn.click();
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Microphone button not found.' });
    }
    return true;
  }
  if (msg.type === 'CLICK_GENERATE_NOTE_BUTTON') {
    // Try to find and click the Generate Note button
    // Primary: use the data-test attribute
    let btn = document.querySelector('button[data-test-visit-session-generate-note]');
    if (!btn) {
      // Fallback: look for button with text content 'Generate Note'
      btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent && b.textContent.trim().toLowerCase() === 'generate note'
      );
    }
    if (btn) {
      btn.click();
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Generate Note button not found.' });
    }
    return true;
  }
  if (msg.type === 'CLICK_CANCEL_BUTTON') {
    // Try to find and click the Discard button (to cancel/discard recording)
    // Primary: use the data-test attribute for discard
    let btn = document.querySelector('button[data-test-visit-session-discard]');
    if (!btn) {
      // Fallback: try cancel attribute
      btn = document.querySelector('button[data-test-visit-session-cancel]');
    }
    if (!btn) {
      // Fallback: look for button with text content 'Discard' or 'Cancel'
      btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent && ['discard', 'cancel'].includes(b.textContent.trim().toLowerCase())
      );
    }
    if (btn) {
      btn.click();
      // Wait for confirmation dialog, then click "Yes, discard"
      setTimeout(() => {
        let confirmBtn = document.querySelector('button[data-test-visit-session-delete]');
        if (!confirmBtn) {
          // Fallback: look for button with text "Yes, discard"
          confirmBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim().toLowerCase().includes('yes, discard')
          );
        }
        if (confirmBtn) {
          confirmBtn.click();
          console.log('[Cascade Debug] CLICK_CANCEL_BUTTON: Clicked confirmation button');
        }
      }, 500);
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Discard/Cancel button not found.' });
    }
    return true;
  }
  if (msg.type === 'CLICK_PAUSE_MICROPHONE_BUTTON') {
    // Try to find and click the Pause button using label text
    let pauseBtn = null;
    // Search through ALL labels to find the one with "Pause" text
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      if (label.textContent.trim() === 'Pause') {
        pauseBtn = label.closest('button');
        break;
      }
    }
    if (!pauseBtn) {
      // Fallback: look for pause icon SVG
      const pauseSvg = document.querySelector('svg.svg-dox-icons\\/icon-pause-filled, svg[class*="icon-pause"]');
      if (pauseSvg) {
        pauseBtn = pauseSvg.closest('button');
      }
    }
    if (pauseBtn) {
      pauseBtn.click();
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Pause button not found.' });
    }
    return true;
  }
  if (msg.type === 'GET_MICROPHONE_STATE') {
    // Detect microphone state by looking at ALL label texts
    const labels = document.querySelectorAll('.visit-session-cta-label');
    const labelTexts = Array.from(labels).map(l => l.textContent.trim());

    let micActive = false;
    let isResume = false;

    // Determine state based on which labels are present
    if (labelTexts.includes('Pause')) {
      // Recording is active (pause button is visible)
      micActive = true;
      isResume = false;
    } else if (labelTexts.includes('Resume')) {
      // Recording is paused (resume button is visible)
      micActive = false;
      isResume = true;
    } else if (labelTexts.includes('Start') || labelTexts.includes('Record')) {
      // Not recording yet
      micActive = false;
      isResume = false;
    }

    console.log('[EXT][GET_MICROPHONE_STATE] labelTexts:', labelTexts, 'micActive:', micActive, 'isResume:', isResume);
    sendResponse && sendResponse({ success: true, micActive, isResume });
    return true;
  }
  if (msg.type === 'SCRAPE_ALL_NOTE_BODIES' && Array.isArray(msg.notes)) {
    scrapeAllNoteBodiesAndSend(msg.notes).then(() => {
      sendResponse && sendResponse({ success: true });
    });
    return true;
  }
  if (msg.type === 'GET_CACHED_NOTE_BODIES') {
    console.log('[DEBUG] GET_CACHED_NOTE_BODIES received');
    
    // 1. First, try to get cached bodies from storage
    chrome.storage.local.get('dox_note_bodies', (result) => {
      const cachedBodies = result.dox_note_bodies || {};
      console.log('[DEBUG] Loaded cached bodies from storage:', Object.keys(cachedBodies));
      
      // 2. Try to extract the currently visible note body from the DOM
      const visibleNoteBody = extractVisibleNoteBody();
      
      // 3. Add the visible note to our cache if we found it
      if (visibleNoteBody.uuid && visibleNoteBody.body) {
        console.log('[DEBUG] Found visible note body for UUID:', visibleNoteBody.uuid);
        cachedBodies[visibleNoteBody.uuid] = visibleNoteBody.body;
        
        // Update the storage with this latest body
        chrome.storage.local.set({ dox_note_bodies: cachedBodies });
      }
      
      // 4. Return all cached bodies including the newly extracted one
      sendResponse && sendResponse({ success: true, data: cachedBodies });
    });
    return true;
  }
  if (msg.type === 'NAVIGATE_TO_VISIT_NOTES_LIST') {
    console.log('[Cascade Debug] NAVIGATE_TO_VISIT_NOTES_LIST received at', new Date().toISOString());
    console.log('[Cascade Debug] Current URL:', window.location.href);
    let visitUuid = null;
    const match = window.location.href.match(/visit_notes\/(\w+-\w+-\w+-\w+-\w+)/);
    if (match) {
      visitUuid = match[1];
      cacheVisitUuid(visitUuid);
    } else {
      const sidebarLink = document.querySelector('.visit-notes-sidebar a[href*="visit_notes/"]');
      if (sidebarLink) {
        const m = sidebarLink.href.match(/visit_notes\/(\w+-\w+-\w+-\w+-\w+)/);
        if (m) {
          visitUuid = m[1];
          cacheVisitUuid(visitUuid);
        }
      }
    }
    console.log('[Cascade Debug] UUID not found in DOM/URL, checking cache...');
    if (visitUuid) {
      const targetUrl = `/scribe/visit_notes/${visitUuid}`;
      if (!window.location.pathname.startsWith(`/scribe/visit_notes/${visitUuid}`)) {
        console.log('[Cascade Debug] Navigating to:', targetUrl);
        window.location.assign(targetUrl);
        setTimeout(() => {
          console.log('[Cascade Debug] Navigation done (direct uuid path)');
          sendResponse && sendResponse({ success: true, navigated: true, url: targetUrl });
        }, 2200);
      } else {
        const sidebarLink = document.querySelector('.visit-notes-sidebar a[href*="visit_notes/"]');
        if (sidebarLink) {
          console.log('[Cascade Debug] Clicking sidebar link:', sidebarLink.href);
          sidebarLink.click();
          setTimeout(() => {
            console.log('[Cascade Debug] Navigation done (sidebar link)');
            sendResponse && sendResponse({ success: true, navigated: true, url: sidebarLink.href, viaSidebar: true });
          }, 2200);
        } else {
          sendResponse && sendResponse({ success: true, navigated: false, url: targetUrl });
        }
      }
    } else {
      chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
        console.log('[Cascade Debug] Cache lookup result:', lastVisitUuid);
        if (lastVisitUuid) {
          const targetUrl = `/scribe/visit_notes/${lastVisitUuid}`;
          console.log('[Cascade Debug] Using cached visitUuid, navigating to:', targetUrl);
          window.location.assign(targetUrl);
          setTimeout(() => {
            console.log('[Cascade Debug] Navigation done (from cache)');
            sendResponse && sendResponse({ success: true, navigated: true, url: targetUrl, fromCache: true });
          }, 2200);
        } else {
          console.log('[Cascade Debug] Could not determine visit UUID, cache empty');
          sendResponse && sendResponse({ success: false, error: 'Could not determine visit UUID.', url: window.location.href });
        }
      });
    }
    return true;
  }
  if (msg.type === 'CHECK_AND_TOGGLE_MICROPHONE') {
    // Search through ALL labels to find Start, Record, Resume, or Pause
    let micBtn = null;
    let clickedLabel = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
        micBtn = label.closest('button,[role="button"],a');
        clickedLabel = text;
        console.log('[Cascade Debug] CHECK_AND_TOGGLE_MICROPHONE: Found button via label:', text);
        break;
      }
    }

    if (micBtn) {
      micBtn.click();
      console.log('[Cascade Debug] CHECK_AND_TOGGLE_MICROPHONE: toggled (already present).');
      // Return the new state after clicking
      // If we clicked Start/Record/Resume, we're now recording (micActive)
      // If we clicked Pause, we're now paused (isResume)
      const nowRecording = ['Start', 'Record', 'Resume'].includes(clickedLabel);
      const nowPaused = clickedLabel === 'Pause';
      if (sendResponse) {
        sendResponse({ success: true, micActive: nowRecording, isResume: nowPaused, clicked: clickedLabel });
      }
    } else {
      // If not present, try to navigate to /scribe/visits/new and auto-toggle after load
      if (!window.location.href.includes('/scribe/visits/new')) {
        window.location.href = 'https://www.doximity.com/scribe/visits/new';
        // After navigation, content script will reload and this message will be resent by background.js
        if (sendResponse) sendResponse({ success: false, navigating: true });
      } else {
        // Wait for the element to appear (polling)
        let attempts = 0;
        const maxAttempts = 50; // ~10 seconds
        const interval = setInterval(() => {
          let micBtn2 = null;
          let clickedLabel2 = null;
          const labels2 = document.querySelectorAll('.visit-session-cta-label');
          for (const label of labels2) {
            const text = label.textContent.trim();
            if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
              micBtn2 = label.closest('button,[role="button"],a');
              clickedLabel2 = text;
              console.log('[Cascade Debug] Polling found button via label:', text);
              break;
            }
          }
          console.log('[Cascade Debug] Polling for microphone button, attempt', attempts+1, '/', maxAttempts, micBtn2 ? 'FOUND' : 'not found');
          if (micBtn2) {
            micBtn2.click();
            clearInterval(interval);
            console.log('[Cascade Debug] CHECK_AND_TOGGLE_MICROPHONE: toggled after navigation.');
            // Send message to background to update icon immediately
            const nowRecording = ['Start', 'Record', 'Resume'].includes(clickedLabel2);
            const nowPaused = clickedLabel2 === 'Pause';
            chrome.runtime.sendMessage({
              type: 'UPDATE_MIC_ICON',
              micActive: nowRecording,
              isResume: nowPaused,
              clicked: clickedLabel2
            });
          }
          attempts++;
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            console.warn('[Cascade Debug] Polling ended, microphone button not found after navigation.');
          }
        }, 200);
        if (sendResponse) sendResponse({ success: false, polling: true });
      }
    }
    return true; // Keep message channel open for async response
  }
  if (msg.type === 'TOGGLE_MICROPHONE_SHORTCUT') {
    // Search through ALL labels to find Start, Record, Resume, or Pause
    let micBtn = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
        micBtn = label.closest('button,[role="button"],a');
        console.log('[Cascade Debug] Global shortcut: Found button via label:', text);
        break;
      }
    }

    if (micBtn) {
      micBtn.click();
      console.log('[Cascade Debug] Global shortcut: Microphone button toggled.');
    } else {
      console.warn('[Cascade Debug] Global shortcut: Microphone button not found (no Start/Record/Resume/Pause label).');
    }
  }
  if (msg.type === 'EXTRACT_VISIBLE_NOTE') {
    console.log('[DEBUG] EXTRACT_VISIBLE_NOTE received for UUID:', msg.uuid);
    
    // First check if we're already on the right note page
    const urlMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
    const currentUuid = urlMatch ? urlMatch[1] : null;
    
    // If we're already on the right page, extract immediately
    if (currentUuid === msg.uuid) {
      const noteData = extractVisibleNoteBody();
      if (noteData.body) {
        console.log('[DEBUG] Extracted note body immediately, length:', noteData.body.length);
        
        // Also update the cache
        chrome.storage.local.get('dox_note_bodies', (result) => {
          const bodies = result.dox_note_bodies || {};
          bodies[msg.uuid] = noteData.body;
          chrome.storage.local.set({ dox_note_bodies: bodies });
        });
        
        sendResponse({ success: true, body: noteData.body });
      } else {
        console.log('[DEBUG] Failed to extract note body immediately');
        sendResponse({ success: false, error: 'Could not extract note body' });
      }
    } else {
      // Need to navigate to the note first
      console.log('[DEBUG] Navigating to note UUID:', msg.uuid);
      window.location.href = `/scribe/visit_notes/${msg.uuid}`;
      
      // Schedule extraction after navigation
      setTimeout(() => {
        const noteData = extractVisibleNoteBody();
        if (noteData.body) {
          console.log('[DEBUG] Extracted note body after navigation, length:', noteData.body.length);
          
          // Update the cache
          chrome.storage.local.get('dox_note_bodies', (result) => {
            const bodies = result.dox_note_bodies || {};
            bodies[msg.uuid] = noteData.body;
            chrome.storage.local.set({ dox_note_bodies: bodies });
          });
          
          sendResponse({ success: true, body: noteData.body });
        } else {
          console.log('[DEBUG] Failed to extract note body after navigation');
          sendResponse({ success: false, error: 'Could not extract note body after navigation' });
        }
      }, 1000);
    }
    return true;
  }
  if (msg.type === 'GET_NOTE_TYPES') {
    // Try to find and extract the note types from the DOM
    const noteTypesContainer = document.querySelector('.visit-session-note-types-list');
    if (noteTypesContainer) {
      // Extract note type information from the DOM
      const noteTypes = Array.from(noteTypesContainer.querySelectorAll('.visit-session-note-types-list-item'))
        .map(item => {
          const span = item.querySelector('span');
          return {
            text: span ? span.textContent.trim() : '',
            disabled: item.closest('[disabled="true"]') !== null
          };
        })
        .filter(type => type.text); // Filter out any empty items
      
      console.log('[Cascade Debug] Found note types:', noteTypes);
      sendResponse({ success: true, noteTypes });
    } else {
      console.log('[Cascade Debug] Note types container not found');
      sendResponse({ success: false, error: 'Note types container not found' });
    }
    return true;
  }
  if (msg.type === 'CLICK_NOTE_TYPE') {
    if (!msg.noteType) {
      sendResponse({ success: false, error: 'No note type specified' });
      return true;
    }
    
    // Try to find the note type in the list and click it
    const noteTypeItems = document.querySelectorAll('.visit-session-note-types-list-item');
    let found = false;
    
    for (const item of noteTypeItems) {
      const span = item.querySelector('span');
      if (span && span.textContent.trim() === msg.noteType && !item.closest('[disabled="true"]')) {
        console.log('[Cascade Debug] Clicking note type:', msg.noteType);
        item.click();
        found = true;
        break;
      }
    }
    
    if (found) {
      sendResponse({ success: true });
    } else {
      console.log('[Cascade Debug] Note type not found or disabled:', msg.noteType);
      sendResponse({ success: false, error: 'Note type not found or disabled' });
    }
    return true;
  }
});

function cacheVisitUuid(visitUuid) {
  if (visitUuid) {
    chrome.storage.local.set({ lastVisitUuid: visitUuid }, () => {
      console.log('[Cascade Debug] Cached visitUuid:', visitUuid);
    });
  }
}

// Scrape all note bodies via DOM, store in chrome.storage.local, and send to popup
async function scrapeAllNoteBodiesAndSend(notes) {
  console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Starting with notes:", notes);
  
  // First get any cached bodies we already have
  let existingBodies = {};
  try {
    const result = await new Promise(resolve => {
      chrome.storage.local.get('dox_note_bodies', (data) => resolve(data || {}));
    });
    existingBodies = result.dox_note_bodies || {};
    console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Loaded existing cached bodies:", Object.keys(existingBodies));
  } catch (err) {
    console.error("[DEBUG] Error loading cached bodies:", err);
  }
  
  const results = {...existingBodies}; // Start with existing bodies
  
  // Try multiple approaches to extract note bodies
  for (const note of notes) {
    const noteKey = note.uuid || note.label;
    console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Processing note:", noteKey);
    
    // Skip if we already have the body cached
    if (results[noteKey] && results[noteKey].length > 10) {
      console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Using existing body from cache for", noteKey);
      continue;
    }
    
    // Approach 1: Navigate using UUID
    if (note.uuid) {
      if (!window.location.href.endsWith(note.uuid)) {
        console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Navigating to note:", note.uuid);
        try {
          window.location.href = `/scribe/visit_notes/${note.uuid}`;
          await new Promise(resolve => setTimeout(resolve, 800)); // Allow more time for SPA navigation
        } catch (e) {
          console.error("[DEBUG] Navigation error:", e);
        }
      }
    } 
    // Approach 2: Click sidebar item
    else {
      console.log("[DEBUG] scrapeAllNoteBodiesAndSend - No UUID, looking for sidebar item by label:", note.label || note.note_label);
      
      // Try multiple selectors to find the sidebar item
      const selectors = [
        '.visit-notes-sidebar .dox-list-item',
        '.visit-notes-sidebar-note',
        '.note-item',
        '.sidebar-item',
        '[data-test-visit-note-item]'
      ];
      
      let sidebarItem = null;
      for (const selector of selectors) {
        const items = Array.from(document.querySelectorAll(selector));
        sidebarItem = items.find(el => {
          const text = el.textContent.trim();
          return text === note.label || text === note.note_label || 
                 text.includes(note.label) || text.includes(note.note_label);
        });
        if (sidebarItem) {
          console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Found sidebar item with selector:", selector);
          break;
        }
      }
      
      if (sidebarItem) {
        console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Found sidebar item, clicking");
        try {
          sidebarItem.click();
          await new Promise(resolve => setTimeout(resolve, 800)); // Allow more time for content to load
        } catch (e) {
          console.error("[DEBUG] Sidebar click error:", e);
        }
      } else {
        console.log("[DEBUG] scrapeAllNoteBodiesAndSend - No sidebar item found for label:", note.label || note.note_label);
      }
    }
    
    // Try multiple selectors to find the note body
    let bodyText = '';
    const bodySelectors = [
      '.visit-note .scribe-text',
      '.visit-note-content',
      '.note-body',
      '.visit-note-body',
      '.scribe-text',
      '[data-test-visit-note-content]'
    ];
    
    for (const selector of bodySelectors) {
      const domBodyElem = document.querySelector(selector);
      if (domBodyElem) {
        bodyText = domBodyElem.innerText.trim();
        console.log(`[DEBUG] Found body with selector: ${selector}, length: ${bodyText.length}`);
        if (bodyText.length > 10) break; // Use this body if it has meaningful content
      }
    }
    
    // Try additional approaches if no body found
    if (!bodyText || bodyText.length < 10) {
      // Look for any div with substantial text content that might be the note
      const allDivs = Array.from(document.querySelectorAll('div'));
      const contentDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        return text.length > 100 && 
               !div.querySelector('div') && // No nested divs (likely a container)
               div.clientHeight > 50; // Has visible height
      });
      
      if (contentDivs.length > 0) {
        // Sort by content length, descending
        contentDivs.sort((a, b) => b.innerText.length - a.innerText.length);
        bodyText = contentDivs[0].innerText.trim();
        console.log(`[DEBUG] Found body via content div search, length: ${bodyText.length}`);
      }
    }
    
    // Use this non-empty body or keep existing cache if available
    if (bodyText && bodyText.length > 10) {
      console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Got new body text for", noteKey, "length:", bodyText.length, "preview:", bodyText.substring(0, 50));
      results[noteKey] = bodyText;
    } else {
      console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Could not find body for", noteKey);
      // Keep existing body from cache if available
      if (!results[noteKey]) {
        results[noteKey] = '(Note body could not be retrieved)';
      }
    }
  }
  
  console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Final results object keys:", Object.keys(results));
  
  // Store in chrome.storage.local
  chrome.storage.local.set({ dox_note_bodies: results }, () => {
    console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Stored bodies in chrome.storage.local");
    // Send all bodies to popup if open
    chrome.runtime.sendMessage({ type: 'ALL_NOTE_BODIES', data: results }, (response) => {
      console.log("[DEBUG] scrapeAllNoteBodiesAndSend - Sent ALL_NOTE_BODIES message, response:", response || "No response/error");
    });
  });
  
  return results;
}

// Listen for click on the confirmation discard button and navigate to cached notes page
function handleConfirmDiscardNavigation() {
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a.dox-button.dox-button-destructive[data-test-visit-session-delete]');
    if (target) {
      // Give the SPA a longer moment (2s) to process the discard and remove beforeunload
      setTimeout(() => {
        window.onbeforeunload = null;
        window.removeEventListener('beforeunload', function(){});
        chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
          if (lastVisitUuid) {
            const url = `/scribe/visit_notes/${lastVisitUuid}`;
            console.log('[Cascade Debug] Navigating to cached notes page after discard confirm (2s delay):', url);
            window.location.assign(url);
          } else {
            console.warn('[Cascade Debug] No cached visitUuid found after discard confirm.');
          }
        });
      }, 2000); // Increased delay to 2 seconds
    }
  }, true);
}

handleConfirmDiscardNavigation();

// Keyboard shortcut: Ctrl+M (or Cmd+M) to toggle microphone record/pause/resume via label

document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    // Find the label (Record, Pause, Resume)
    const micLabel = document.querySelector('.visit-session-cta-label');
    if (micLabel) {
      const micBtn = micLabel.closest('button,[role="button"],a');
      if (micBtn) {
        micBtn.click();
        console.log('[Cascade Debug] Ctrl+M pressed: Microphone button toggled (via label).');
      } else {
        console.warn('[Cascade Debug] Ctrl+M pressed: No clickable parent for microphone label.');
      }
    } else {
      console.warn('[Cascade Debug] Ctrl+M pressed: Microphone label not found.');
    }
  }
});

function extractVisibleNoteBody() {
  console.log('[DEBUG] Extracting visible note body from DOM');
  const result = { uuid: null, body: null };
  
  // Try to extract UUID from the URL
  const urlMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
  if (urlMatch && urlMatch[1]) {
    result.uuid = urlMatch[1];
    console.log('[DEBUG] Extracted UUID from URL:', result.uuid);
  }
  
  // Try to get the body from multiple possible selectors
  const bodySelectors = [
    '.visit-note .scribe-text',
    '.visit-note-content',
    '.note-body',
    '.visit-note-body',
    '.scribe-text',
    '[data-test-visit-note-content]',
    '.visit-note'
  ];
  
  for (const selector of bodySelectors) {
    const bodyElem = document.querySelector(selector);
    if (bodyElem) {
      const text = bodyElem.innerText.trim();
      if (text.length > 10) {
        result.body = text;
        console.log(`[DEBUG] Found visible note body with selector ${selector}, length: ${text.length}`);
        break;
      }
    }
  }
  
  // If still no body found, try looking for any div with substantial text
  if (!result.body) {
    const contentDivs = Array.from(document.querySelectorAll('div')).filter(div => {
      const text = div.innerText.trim();
      return text.length > 100 && 
             !div.querySelector('div') && // No nested divs (likely a container)
             div.clientHeight > 50; // Has visible height
    });
    
    if (contentDivs.length > 0) {
      contentDivs.sort((a, b) => b.innerText.length - a.innerText.length);
      result.body = contentDivs[0].innerText.trim();
      console.log(`[DEBUG] Found body via content div search, length: ${result.body.length}`);
    }
  }
  
  return result;
}
