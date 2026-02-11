// popup-controls.js — Microphone and recording controls

function fetchNoteTypeSelector() {
  findDoximityTab(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_NOTE_TYPE_OPTIONS' }, function(response) {
        const noteTypeDiv = document.getElementById('note-type-selector-div');
        if (response && response.success && response.options && response.options.length > 0) {
          debugLog('renderNoteTypeSelector with options:', response.options.length, 'selected:', response.selected);
          renderNoteTypeSelector(response.options, response.selected);
          if (noteTypeDiv) noteTypeDiv.style.display = '';
        } else {
          debugLog('No note type selector found on page. Hiding note type div.');
          if (noteTypeDiv) noteTypeDiv.style.display = 'none';
        }
      });
    }
  });
}

function fetchMicSelector() {
  debugLog('fetchMicSelector called.');
  ensureControlDivsExist();
  findDoximityTab(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_MICROPHONE_OPTIONS' }, function(response) {
        const micDiv = document.getElementById('mic-selector-div');
        if (response && response.success && response.options && response.options.length > 0) {
          debugLog('renderMicSelector with options:', response.options.length, 'selected:', response.selected);
          renderMicSelector(response.options, response.selected);
          if (micDiv) micDiv.style.display = '';
        } else {
          debugLog('No mic selector present (likely recording). Hiding mic selector div.');
          if (micDiv) micDiv.style.display = 'none';
        }
        hideLoading();
        fetchNoteTypeSelector();
        syncMicStateAndRender();
        renderGenerateNoteButton();
      });
    }
  });
}

function syncMicStateAndRender() {
  findDoximityTab(function(tab) {
    if (tab) {
      safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
        debugLog('syncMicStateAndRender response:', response);
        if (response && response.success) {
          renderMicButton(response.micActive, response.isResume);
          updateBadgeForMicState(response.micActive, response.isResume);
        } else {
          debugLog('syncMicStateAndRender: No valid response, rendering default mic button');
          renderMicButton(false, false);
          updateBadgeForMicState(false, false);
        }
      });
    } else {
      debugLog('syncMicStateAndRender: No tab found, rendering default mic button');
      renderMicButton(false, false);
      updateBadgeForMicState(false, false);
    }
  });
}

function updateExtensionIcon(micActive, isResume) {
  updateBadgeForMicState(micActive, isResume);
}

function ensureControlDivsExist() {
  const btnContainer = document.getElementById('btn-container');

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

  let noteTypeDiv = document.getElementById('note-type-selector-div');
  if (!noteTypeDiv) {
    noteTypeDiv = document.createElement('div');
    noteTypeDiv.id = 'note-type-selector-div';
    noteTypeDiv.style.margin = '12px 0';
    micSelectorDiv.insertAdjacentElement('afterend', noteTypeDiv);
  }

  let micBtnDiv = document.getElementById('mic-btn-div');
  if (!micBtnDiv) {
    micBtnDiv = document.createElement('div');
    micBtnDiv.id = 'mic-btn-div';
    micBtnDiv.style.textAlign = 'center';
    micBtnDiv.style.margin = '12px 0';
    noteTypeDiv.insertAdjacentElement('afterend', micBtnDiv);
  }

  let genDiv = document.getElementById('generate-note-div');
  if (!genDiv) {
    genDiv = document.createElement('div');
    genDiv.id = 'generate-note-div';
    genDiv.style.textAlign = 'center';
    genDiv.style.margin = '12px 0';
    micBtnDiv.insertAdjacentElement('afterend', genDiv);
  }
}

function retryFetchMicSelector(maxRetries, interval) {
  if (maxRetries === undefined) maxRetries = 10;
  if (interval === undefined) interval = 300;
  let attempts = 0;
  function tryFetch() {
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_OPTIONS' }, function(response) {
          if (response && response.success && response.options && response.options.length > 0) {
            debugLog('renderMicSelector with options:', response.options.length, 'selected:', response.selected);
            hideLoading();
            renderMicSelector(response.options, response.selected);
            fetchNoteTypeSelector();
            syncMicStateAndRender();
            renderGenerateNoteButton();
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(tryFetch, interval);
          } else {
            debugLog('Max retries reached, checking microphone permission...');
            hideLoading();
            checkMicPermissionAndActivateTab(tab);
          }
        });
      }
    });
  }
  tryFetch();
}

function checkMicPermissionAndActivateTab(tab) {
  safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(micStateResponse) {
    debugLog('Mic state before permission check:', micStateResponse);

    if (micStateResponse && micStateResponse.success && (micStateResponse.micActive || micStateResponse.isResume)) {
      debugLog('Recording active/paused, mic selector hidden intentionally');
      syncMicStateAndRender();
      fetchNoteTypeSelector();
      renderGenerateNoteButton();
      return;
    }

    safeSendMessage(tab.id, { type: 'CHECK_MICROPHONE_PERMISSION' }, function(response) {
      debugLog('Microphone permission check response:', response);

      if (response && response.success && response.state) {
        if (response.state === 'prompt' || response.state === 'denied') {
          debugLog('Microphone permission needs to be granted, activating tab');
          showMicPermissionMessage(response.state);
          chrome.tabs.update(tab.id, { active: true });
        } else if (response.state === 'granted') {
          debugLog('Microphone permission granted but selector empty - page may still be loading');
          showMicPermissionMessage('loading');
        }
      } else {
        debugLog('Could not check microphone permission, activating tab as fallback');
        showMicPermissionMessage('unknown');
        chrome.tabs.update(tab.id, { active: true });
      }

      syncMicStateAndRender();
      renderGenerateNoteButton();
    });
  });
}

function pollMicStateAndRender(maxRetries, interval) {
  if (maxRetries === undefined) maxRetries = 10;
  if (interval === undefined) interval = 100;
  let attempts = 0;
  function poll() {
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
          if (response && response.success && response.micActive) {
            renderMicButton(response.micActive, response.isResume);
            updateBadgeForMicState(response.micActive, response.isResume);
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(poll, interval);
          } else {
            syncMicStateAndRender();
          }
        });
      }
    });
  }
  poll();
}

function pollForPausedState(maxRetries, interval) {
  if (maxRetries === undefined) maxRetries = 10;
  if (interval === undefined) interval = 100;
  let attempts = 0;
  function poll() {
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'GET_MICROPHONE_STATE' }, function(response) {
          debugLog('pollForPausedState attempt', attempts, 'response:', response);
          if (response && response.success && response.isResume) {
            renderMicButton(false, true);
            updateBadgeForMicState(false, true);
            return;
          } else if (attempts < maxRetries) {
            attempts++;
            setTimeout(poll, interval);
          } else {
            syncMicStateAndRender();
          }
        });
      }
    });
  }
  poll();
}

function clearNotesAndShowMicControls() {
  notesListDiv.innerHTML = '';
  ensureControlDivsExist();
}
