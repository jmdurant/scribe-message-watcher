// Startup debug log to verify injection
debugLog('Content script loaded at', window.location.href);

// SPA navigation helper: tries pushState first, falls back to location.assign
function navigateWithinSPA(url) {
  try {
    history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch (e) {
    window.location.assign(url);
  }
}

// Immediately cache visitUuid if on a visit notes page
const notesUuidMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
if (notesUuidMatch) {
  const visitUuid = notesUuidMatch[1];
  chrome.storage.local.set({ lastVisitUuid: visitUuid }, () => {
    debugLog('Cached visitUuid on load:', visitUuid);
  });
}

// Track elements that existed at page load so MutationObserver ignores them
const _existingNoteElements = new Set();
document.querySelectorAll('.scribe-text, .dictation-text, .note-text, .transcript-text').forEach(el => {
  _existingNoteElements.add(el);
});
debugLog('Existing note elements at page load:', _existingNoteElements.size);

// Debounce notifyBackground so rapid DOM mutations don't send multiple notifications
let _notifyDebounceTimer = null;

function notifyBackground() {
  if (_notifyDebounceTimer) return;
  _notifyDebounceTimer = setTimeout(() => { _notifyDebounceTimer = null; }, 2000);

  debugLog("notifyBackground - New message detected, sending NEW_MESSAGE to background script");
  debugLog("Current URL:", window.location.href);

  chrome.runtime.sendMessage({
    type: "NEW_MESSAGE",
    url: window.location.href,
    timestamp: Date.now()
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending NEW_MESSAGE:", chrome.runtime.lastError);
    } else if (response) {
      debugLog("Got response from background for NEW_MESSAGE:", response);
    }
  });
}

const observer = new MutationObserver((mutations) => {
  debugLog("MutationObserver - Mutations detected:", mutations.length);

  for (let i = 0; i < Math.min(mutations.length, 5); i++) {
    const mutation = mutations[i];
    debugLog("Mutation " + i + " - type: " + mutation.type + ", target: " + mutation.target.nodeName);

    if (mutation.type === 'childList') {
      debugLog("Mutation " + i + " - addedNodes: " + mutation.addedNodes.length + ", removedNodes: " + mutation.removedNodes.length);

      for (let j = 0; j < Math.min(mutation.addedNodes.length, 3); j++) {
        const node = mutation.addedNodes[j];
        debugLog("Mutation " + i + " - addedNode " + j + ": nodeType=" + node.nodeType + ", nodeName=" + node.nodeName + ", classes=" + (node.classList ? [...node.classList].join(',') : 'none'));
      }
    }
  }

  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      const newNoteNodes = [...mutation.addedNodes].filter(
        (node) =>
          node.nodeType === 1 &&
          node.classList &&
          !_existingNoteElements.has(node) &&
          (node.classList.contains("scribe-text") ||
           node.classList.contains("dictation-text") ||
           node.classList.contains("note-text") ||
           node.classList.contains("transcript-text") ||
           node.querySelector('.scribe-text, .dictation-text, .note-text, .transcript-text'))
      );
      if (newNoteNodes.length > 0) {
        debugLog("MutationObserver - Detected new note element(s) added to DOM:", newNoteNodes.length);
        notifyBackground();
      }
    }
    if (
      mutation.type === "characterData" &&
      mutation.target.parentElement &&
      mutation.target.parentElement.classList.contains("scribe-text") &&
      !_existingNoteElements.has(mutation.target.parentElement)
    ) {
      debugLog("MutationObserver - Detected characterData change in new scribe-text element");
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
        window.postMessage({ type: 'REFETCH_NOTES' }, '*');
      }
    }
  }, 500);
})();

window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'REFETCH_NOTES') {
    // Hook for the popup to trigger a new fetch if needed
  }
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  debugLog('onMessage received:', msg.type, 'window.location.href:', window.location.href);
  if (msg.type === 'FETCH_NOTES') {
    debugLog('FETCH_NOTES received');
    let responded = false;
    const timeout = setTimeout(() => {
      if (!responded) {
        sendResponse({ success: false, error: 'Timeout waiting for notes.' });
        responded = true;
      }
    }, 4000);

    // Validate URL origin before fetching
    if (window.location.origin !== 'https://www.doximity.com') {
      if (!responded) {
        sendResponse({ success: false, error: 'Not on doximity.com origin.' });
        responded = true;
        clearTimeout(timeout);
      }
      return true;
    }

    fetch(window.location.href, { credentials: 'include' })
      .then(r => {
        const contentType = r.headers.get('content-type') || '';
        debugLog('Response content-type:', contentType);
        if (contentType.includes('application/json')) {
          return r.json().then(data => {
            debugLog('JSON API response received');
            const visitNotes = (data.props && data.props.visit_notes) || [];
            debugLog('visitNotes (api):', visitNotes.length, 'notes');
            if (!responded) {
              sendResponse({ success: true, data, source: 'api' });
              responded = true;
              clearTimeout(timeout);
            }
          });
        } else {
          const appDiv = document.getElementById('app');
          debugLog('appDiv found:', !!appDiv);
          if (!appDiv) {
            debugLog('Searching for alternative containers...');
            const possibleContainers = ['#root', '.app-container', '#app-root', 'main', 'body'];
            for (const selector of possibleContainers) {
              const container = document.querySelector(selector);
              if (container) {
                debugLog('Found alternative container:', selector);
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
          debugLog('dataPage attribute exists:', !!dataPage);
          if (!dataPage) {
            debugLog('Checking for data in other attributes...');
            const dataAttrs = ['data-json', 'data-state', 'data-props', 'data-app'];
            for (const attr of dataAttrs) {
              const data = appDiv.getAttribute(attr);
              if (data) {
                debugLog('Found data in attribute:', attr);
                break;
              }
            }

            debugLog('Looking for notes directly in DOM...');
            const noteElements = document.querySelectorAll('.visit-notes-sidebar-note, .visit-note');
            debugLog('Direct DOM note elements found:', noteElements.length);

            if (!responded) {
              sendResponse({ success: false, error: 'data-page attribute missing.' });
              responded = true;
              clearTimeout(timeout);
            }
            return;
          }
          try {
            debugLog('Attempting to parse data-page JSON...');
            const parsed = JSON.parse(dataPage);
            debugLog('data-page parsed successfully');

            const visitNotes = (parsed.props && parsed.props.visit_notes) || [];
            debugLog('visitNotes (dom):', visitNotes.length, 'notes');

            if (!responded) {
              sendResponse({ success: true, data: parsed, source: 'dom' });
              responded = true;
              clearTimeout(timeout);
            }
          } catch (err) {
            debugLog('Error parsing data-page:', err);

            debugLog('Attempting direct DOM extraction fallback...');
            const noteElements = document.querySelectorAll('.visit-notes-sidebar-note, .visit-note, .note-item');
            debugLog('Fallback DOM note elements found:', noteElements.length);

            const domExtractedNotes = [];
            if (noteElements.length > 0) {
              noteElements.forEach((el, idx) => {
                const title = el.textContent.trim();
                const uuid = el.dataset.uuid || el.dataset.noteId || 'dom-note-' + idx;
                domExtractedNotes.push({
                  uuid: uuid,
                  note_label: title,
                  created_at: new Date().toISOString()
                });
              });
              debugLog('DOM extracted notes:', domExtractedNotes.length);

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
        debugLog('Error in fetch:', err);
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
    let stopBtn = document.querySelector('button[data-test-visit-session-discard]');
    if (!stopBtn) {
      stopBtn = document.querySelector('button[data-test-visit-session-cancel]');
    }
    if (!stopBtn) {
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
    const label = msg.label || msg.note_label;
    if (label) {
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
      const options = Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
      sendResponse && sendResponse({ success: true, options, selected: sel.value });
    } else {
      sendResponse && sendResponse({ success: false });
    }
    return true;
  }
  if (msg.type === 'CHECK_MICROPHONE_PERMISSION') {
    navigator.permissions.query({ name: 'microphone' })
      .then(permissionStatus => {
        debugLog('Microphone permission state:', permissionStatus.state);
        sendResponse && sendResponse({
          success: true,
          state: permissionStatus.state
        });
      })
      .catch(err => {
        console.error('Error checking microphone permission:', err);
        sendResponse && sendResponse({ success: false, error: err.message, state: 'unknown' });
      });
    return true;
  }
  if (msg.type === 'SET_MICROPHONE') {
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
    let sel = document.querySelector('select#note_type_uuid, select[name="note_type_uuid"]');
    if (sel) {
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
    let micBtn = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume'].includes(text)) {
        micBtn = label.closest('button');
        debugLog('Found mic button via label:', text);
        break;
      }
    }

    if (!micBtn) {
      micBtn = document.querySelector('button[data-test-visit-session-new-start-cta]');
      if (!micBtn) {
        micBtn = document.querySelector('button[data-test-visit-session-cta]');
      }
    }

    if (!micBtn) {
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
    let btn = document.querySelector('button[data-test-visit-session-generate-note]');
    if (!btn) {
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
    let btn = document.querySelector('button[data-test-visit-session-discard]');
    if (!btn) {
      btn = document.querySelector('button[data-test-visit-session-cancel]');
    }
    if (!btn) {
      btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent && ['discard', 'cancel'].includes(b.textContent.trim().toLowerCase())
      );
    }
    if (btn) {
      btn.click();
      setTimeout(() => {
        let confirmBtn = document.querySelector('button[data-test-visit-session-delete]');
        if (!confirmBtn) {
          confirmBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim().toLowerCase().includes('yes, discard')
          );
        }
        if (confirmBtn) {
          confirmBtn.click();
          debugLog('CLICK_CANCEL_BUTTON: Clicked confirmation button');
        }
      }, 500);
      sendResponse && sendResponse({ success: true });
    } else {
      sendResponse && sendResponse({ success: false, error: 'Discard/Cancel button not found.' });
    }
    return true;
  }
  if (msg.type === 'CLICK_PAUSE_MICROPHONE_BUTTON') {
    let pauseBtn = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      if (label.textContent.trim() === 'Pause') {
        pauseBtn = label.closest('button');
        break;
      }
    }
    if (!pauseBtn) {
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
    const labels = document.querySelectorAll('.visit-session-cta-label');
    const labelTexts = Array.from(labels).map(l => l.textContent.trim());

    let micActive = false;
    let isResume = false;

    if (labelTexts.includes('Pause')) {
      micActive = true;
      isResume = false;
    } else if (labelTexts.includes('Resume')) {
      micActive = false;
      isResume = true;
    } else if (labelTexts.includes('Start') || labelTexts.includes('Record')) {
      micActive = false;
      isResume = false;
    }

    debugLog('GET_MICROPHONE_STATE labelTexts:', labelTexts, 'micActive:', micActive, 'isResume:', isResume);
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
    debugLog('GET_CACHED_NOTE_BODIES received');

    chrome.storage.local.get('dox_note_bodies', (result) => {
      const cachedBodies = result.dox_note_bodies || {};
      debugLog('Loaded cached bodies from storage:', Object.keys(cachedBodies));

      const visibleNoteBody = extractVisibleNoteBody();

      if (visibleNoteBody.uuid && visibleNoteBody.body) {
        debugLog('Found visible note body for UUID:', visibleNoteBody.uuid);
        cachedBodies[visibleNoteBody.uuid] = visibleNoteBody.body;
        chrome.storage.local.set({ dox_note_bodies: cachedBodies });
      }

      sendResponse && sendResponse({ success: true, data: cachedBodies });
    });
    return true;
  }
  if (msg.type === 'NAVIGATE_TO_VISIT_NOTES_LIST') {
    debugLog('NAVIGATE_TO_VISIT_NOTES_LIST received');
    debugLog('Current URL:', window.location.href);
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
    debugLog('UUID not found in DOM/URL, checking cache...');
    if (visitUuid) {
      const targetUrl = '/scribe/visit_notes/' + visitUuid;
      if (!window.location.pathname.startsWith('/scribe/visit_notes/' + visitUuid)) {
        debugLog('Navigating to:', targetUrl);
        navigateWithinSPA(targetUrl);
        setTimeout(() => {
          debugLog('Navigation done (direct uuid path)');
          sendResponse && sendResponse({ success: true, navigated: true, url: targetUrl });
        }, 2200);
      } else {
        const sidebarLink = document.querySelector('.visit-notes-sidebar a[href*="visit_notes/"]');
        if (sidebarLink) {
          debugLog('Clicking sidebar link:', sidebarLink.href);
          sidebarLink.click();
          setTimeout(() => {
            debugLog('Navigation done (sidebar link)');
            sendResponse && sendResponse({ success: true, navigated: true, url: sidebarLink.href, viaSidebar: true });
          }, 2200);
        } else {
          sendResponse && sendResponse({ success: true, navigated: false, url: targetUrl });
        }
      }
    } else {
      chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
        debugLog('Cache lookup result:', lastVisitUuid);
        if (lastVisitUuid) {
          const targetUrl = '/scribe/visit_notes/' + lastVisitUuid;
          debugLog('Using cached visitUuid, navigating to:', targetUrl);
          navigateWithinSPA(targetUrl);
          setTimeout(() => {
            debugLog('Navigation done (from cache)');
            sendResponse && sendResponse({ success: true, navigated: true, url: targetUrl, fromCache: true });
          }, 2200);
        } else {
          debugLog('Could not determine visit UUID, cache empty');
          sendResponse && sendResponse({ success: false, error: 'Could not determine visit UUID.', url: window.location.href });
        }
      });
    }
    return true;
  }
  if (msg.type === 'CHECK_AND_TOGGLE_MICROPHONE') {
    let micBtn = null;
    let clickedLabel = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
        micBtn = label.closest('button,[role="button"],a');
        clickedLabel = text;
        debugLog('CHECK_AND_TOGGLE_MICROPHONE: Found button via label:', text);
        break;
      }
    }

    if (micBtn) {
      micBtn.click();
      debugLog('CHECK_AND_TOGGLE_MICROPHONE: toggled (already present).');
      const nowRecording = ['Start', 'Record', 'Resume'].includes(clickedLabel);
      const nowPaused = clickedLabel === 'Pause';
      if (sendResponse) {
        sendResponse({ success: true, micActive: nowRecording, isResume: nowPaused, clicked: clickedLabel });
      }
    } else {
      if (!window.location.href.includes('/scribe/visits/new')) {
        navigateWithinSPA('https://www.doximity.com/scribe/visits/new');
        if (sendResponse) sendResponse({ success: false, navigating: true });
      } else {
        let attempts = 0;
        const maxAttempts = 50;
        const interval = setInterval(() => {
          let micBtn2 = null;
          let clickedLabel2 = null;
          const labels2 = document.querySelectorAll('.visit-session-cta-label');
          for (const label of labels2) {
            const text = label.textContent.trim();
            if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
              micBtn2 = label.closest('button,[role="button"],a');
              clickedLabel2 = text;
              debugLog('Polling found button via label:', text);
              break;
            }
          }
          debugLog('Polling for microphone button, attempt', attempts + 1, '/', maxAttempts, micBtn2 ? 'FOUND' : 'not found');
          if (micBtn2) {
            micBtn2.click();
            clearInterval(interval);
            debugLog('CHECK_AND_TOGGLE_MICROPHONE: toggled after navigation.');
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
            console.warn('Polling ended, microphone button not found after navigation.');
          }
        }, 200);
        if (sendResponse) sendResponse({ success: false, polling: true });
      }
    }
    return true;
  }
  if (msg.type === 'TOGGLE_MICROPHONE_SHORTCUT') {
    let micBtn = null;
    const labels = document.querySelectorAll('.visit-session-cta-label');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (['Start', 'Record', 'Resume', 'Pause'].includes(text)) {
        micBtn = label.closest('button,[role="button"],a');
        debugLog('Global shortcut: Found button via label:', text);
        break;
      }
    }

    if (micBtn) {
      micBtn.click();
      debugLog('Global shortcut: Microphone button toggled.');
    } else {
      console.warn('Global shortcut: Microphone button not found (no Start/Record/Resume/Pause label).');
    }
  }
  if (msg.type === 'EXTRACT_VISIBLE_NOTE') {
    debugLog('EXTRACT_VISIBLE_NOTE received for UUID:', msg.uuid);

    const urlMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
    const currentUuid = urlMatch ? urlMatch[1] : null;

    if (currentUuid === msg.uuid) {
      const noteData = extractVisibleNoteBody();
      if (noteData.body) {
        debugLog('Extracted note body immediately, length:', noteData.body.length);
        chrome.storage.local.get('dox_note_bodies', (result) => {
          const bodies = result.dox_note_bodies || {};
          bodies[msg.uuid] = noteData.body;
          chrome.storage.local.set({ dox_note_bodies: bodies });
        });
        sendResponse({ success: true, body: noteData.body });
      } else {
        debugLog('Failed to extract note body immediately');
        sendResponse({ success: false, error: 'Could not extract note body' });
      }
    } else {
      debugLog('Navigating to note UUID:', msg.uuid);
      navigateWithinSPA('/scribe/visit_notes/' + msg.uuid);

      setTimeout(() => {
        const noteData = extractVisibleNoteBody();
        if (noteData.body) {
          debugLog('Extracted note body after navigation, length:', noteData.body.length);
          chrome.storage.local.get('dox_note_bodies', (result) => {
            const bodies = result.dox_note_bodies || {};
            bodies[msg.uuid] = noteData.body;
            chrome.storage.local.set({ dox_note_bodies: bodies });
          });
          sendResponse({ success: true, body: noteData.body });
        } else {
          debugLog('Failed to extract note body after navigation');
          sendResponse({ success: false, error: 'Could not extract note body after navigation' });
        }
      }, 1000);
    }
    return true;
  }
});

function cacheVisitUuid(visitUuid) {
  if (visitUuid) {
    chrome.storage.local.set({ lastVisitUuid: visitUuid }, () => {
      debugLog('Cached visitUuid:', visitUuid);
    });
  }
}

// Scrape all note bodies via DOM, store in chrome.storage.local, and send to popup
async function scrapeAllNoteBodiesAndSend(notes) {
  debugLog("scrapeAllNoteBodiesAndSend - Starting with notes:", notes.length);

  let existingBodies = {};
  try {
    const result = await new Promise(resolve => {
      chrome.storage.local.get('dox_note_bodies', (data) => resolve(data || {}));
    });
    existingBodies = result.dox_note_bodies || {};
    debugLog("scrapeAllNoteBodiesAndSend - Loaded existing cached bodies:", Object.keys(existingBodies).length);
  } catch (err) {
    console.error("Error loading cached bodies:", err);
  }

  const results = {...existingBodies};

  for (const note of notes) {
    const noteKey = note.uuid || note.label;
    debugLog("scrapeAllNoteBodiesAndSend - Processing note:", noteKey);

    if (results[noteKey] && results[noteKey].length > 10) {
      debugLog("scrapeAllNoteBodiesAndSend - Using existing body from cache for", noteKey);
      continue;
    }

    if (note.uuid) {
      if (!window.location.href.endsWith(note.uuid)) {
        debugLog("scrapeAllNoteBodiesAndSend - Navigating to note:", note.uuid);
        try {
          navigateWithinSPA('/scribe/visit_notes/' + note.uuid);
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (e) {
          console.error("Navigation error:", e);
        }
      }
    }
    else {
      debugLog("scrapeAllNoteBodiesAndSend - No UUID, looking for sidebar item by label:", note.label || note.note_label);

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
          debugLog("scrapeAllNoteBodiesAndSend - Found sidebar item with selector:", selector);
          break;
        }
      }

      if (sidebarItem) {
        debugLog("scrapeAllNoteBodiesAndSend - Found sidebar item, clicking");
        try {
          sidebarItem.click();
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (e) {
          console.error("Sidebar click error:", e);
        }
      } else {
        debugLog("scrapeAllNoteBodiesAndSend - No sidebar item found for label:", note.label || note.note_label);
      }
    }

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
        debugLog("Found body with selector: " + selector + ", length: " + bodyText.length);
        if (bodyText.length > 10) break;
      }
    }

    if (!bodyText || bodyText.length < 10) {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const contentDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        return text.length > 100 &&
               !div.querySelector('div') &&
               div.clientHeight > 50;
      });

      if (contentDivs.length > 0) {
        contentDivs.sort((a, b) => b.innerText.length - a.innerText.length);
        bodyText = contentDivs[0].innerText.trim();
        debugLog("Found body via content div search, length: " + bodyText.length);
      }
    }

    if (bodyText && bodyText.length > 10) {
      debugLog("scrapeAllNoteBodiesAndSend - Got new body text for", noteKey, "length:", bodyText.length);
      results[noteKey] = bodyText;
    } else {
      debugLog("scrapeAllNoteBodiesAndSend - Could not find body for", noteKey);
      if (!results[noteKey]) {
        results[noteKey] = '(Note body could not be retrieved)';
      }
    }
  }

  debugLog("scrapeAllNoteBodiesAndSend - Final results object keys:", Object.keys(results).length);

  chrome.storage.local.set({ dox_note_bodies: results }, () => {
    debugLog("scrapeAllNoteBodiesAndSend - Stored bodies in chrome.storage.local");
    chrome.runtime.sendMessage({ type: 'ALL_NOTE_BODIES', data: results }, (response) => {
      debugLog("scrapeAllNoteBodiesAndSend - Sent ALL_NOTE_BODIES message");
    });
  });

  return results;
}

// Listen for click on the confirmation discard button and navigate to cached notes page
function handleConfirmDiscardNavigation() {
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a.dox-button.dox-button-destructive[data-test-visit-session-delete]');
    if (target) {
      setTimeout(() => {
        window.onbeforeunload = null;
        window.removeEventListener('beforeunload', function(){});
        chrome.storage.local.get('lastVisitUuid', ({ lastVisitUuid }) => {
          if (lastVisitUuid) {
            const url = '/scribe/visit_notes/' + lastVisitUuid;
            debugLog('Navigating to cached notes page after discard confirm:', url);
            navigateWithinSPA(url);
          } else {
            console.warn('No cached visitUuid found after discard confirm.');
          }
        });
      }, 2000);
    }
  }, true);
}

handleConfirmDiscardNavigation();

// Keyboard shortcut: Ctrl+M (or Cmd+M) to toggle microphone record/pause/resume via label
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    const micLabel = document.querySelector('.visit-session-cta-label');
    if (micLabel) {
      const micBtn = micLabel.closest('button,[role="button"],a');
      if (micBtn) {
        micBtn.click();
        debugLog('Ctrl+M pressed: Microphone button toggled (via label).');
      } else {
        console.warn('Ctrl+M pressed: No clickable parent for microphone label.');
      }
    } else {
      console.warn('Ctrl+M pressed: Microphone label not found.');
    }
  }
});

function extractVisibleNoteBody() {
  debugLog('Extracting visible note body from DOM');
  const result = { uuid: null, body: null };

  const urlMatch = window.location.href.match(/\/scribe\/visit_notes\/([\w-]+)/);
  if (urlMatch && urlMatch[1]) {
    result.uuid = urlMatch[1];
    debugLog('Extracted UUID from URL:', result.uuid);
  }

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
        debugLog("Found visible note body with selector " + selector + ", length: " + text.length);
        break;
      }
    }
  }

  if (!result.body) {
    const contentDivs = Array.from(document.querySelectorAll('div')).filter(div => {
      const text = div.innerText.trim();
      return text.length > 100 &&
             !div.querySelector('div') &&
             div.clientHeight > 50;
    });

    if (contentDivs.length > 0) {
      contentDivs.sort((a, b) => b.innerText.length - a.innerText.length);
      result.body = contentDivs[0].innerText.trim();
      debugLog("Found body via content div search, length: " + result.body.length);
    }
  }

  return result;
}
