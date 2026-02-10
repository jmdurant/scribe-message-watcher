// popup-ui.js — Rendering and UI functions for popup

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

function showStatus(msg, color) {
  if (!statusDiv) return;
  statusDiv.textContent = msg;
  statusDiv.style.color = color;
}

function renderNoNotesFound() {
  instructionsDiv.innerHTML = [
    '<p>No notes found.<br>Click below to begin dictation.</p>',
    '<img id="activate-dox-icon" src="icon-128.png" alt="Activate Doximity Tab" ',
    'style="display: block; margin: 10px auto 0 auto; cursor: pointer; width: 64px; height: 64px;" ',
    'title="Activate Doximity Tab">'
  ].join('');
  instructionsDiv.style.display = 'block';
  notesListDiv.innerHTML = '';
  notesListDiv.style.display = 'none';

  const icon = document.getElementById('activate-dox-icon');
  if (icon) {
    icon.onclick = () => {
      chrome.tabs.query({ url: ['*://www.doximity.com/scribe/*', '*://*.doximity.com/session/new*'] }, (tabs) => {
        let scribeTab = tabs.find(tab => tab.url && tab.url.includes('/scribe/'));
        if (!scribeTab) {
          scribeTab = tabs.find(tab => tab.url && tab.url.includes('/session/new'));
        }
        if (scribeTab) {
          chrome.tabs.update(scribeTab.id, { active: true });
          window.close();
        } else {
          chrome.tabs.create({ url: 'https://www.doximity.com/scribe/home', pinned: true, active: true });
        }
      });
    };
  }
}

function showNotes(notes, source) {
  debugLog("showNotes - Starting with notes:", notes.length);
  debugLog("showNotes - Current allNoteBodies keys:", Object.keys(allNoteBodies).length);

  hideLoading();
  notesListDiv.style.display = 'block';

  notes.sort((a, b) => {
    let dateA = a.created_at ? new Date(a.created_at) : new Date(0);
    let dateB = b.created_at ? new Date(b.created_at) : new Date(0);
    if (isNaN(dateA.getTime())) dateA = new Date(0);
    if (isNaN(dateB.getTime())) dateB = new Date(0);
    return dateB - dateA;
  });

  notesListDiv.innerHTML = '';

  const anyMissingBodies = notes.some(note => {
    const noteKey = note.uuid || note.label;
    return !allNoteBodies[noteKey] || allNoteBodies[noteKey].length < 10;
  });

  if (anyMissingBodies && pendingScrapeNotes) {
    addRetryButton();
  }

  if (notes.length === 0) {
    renderNoNotesFound();
    return;
  }

  if (notes.length > 0) {
    debugLog('First note object UUID:', notes[0].uuid);
  }

  // If PracticeQ integration is enabled, try to move a matched note to the top
  let matchedIdx = -1;
  if (practiceQIntegrationEnabled && typeof isNoteInVisitWindow === 'function') {
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      let title = note.note_label || note.label || '';
      if (window.practiceQClientData && isNoteInVisitWindow(title, window.practiceQClientData)) {
        matchedIdx = i;
        break;
      }
    }
    if (matchedIdx > 0) {
      const [matchedNote] = notes.splice(matchedIdx, 1);
      notes.unshift(matchedNote);
    }
  }

  let openIdx = notes.findIndex(note => note.body_from_dom);
  if (openIdx === -1) openIdx = 0;

  if (practiceQIntegrationEnabled) {
    const renderedNotes = new Array(notes.length);
    let completed = 0;
    notes.forEach((note, idx) => {
      const noteKey = note.uuid || note.label;
      const hasBody = !!note.body_from_dom || !!allNoteBodies[noteKey];
      let body = note.body_from_dom || allNoteBodies[noteKey] || '';

      let title = note.note_label || note.label || '';
      if (note.body_from_cache && title.includes('Note') && title.includes('...')) {
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
    notes.forEach((note, idx) => {
      const noteKey = note.uuid || note.label;
      const hasBody = !!note.body_from_dom || !!allNoteBodies[noteKey];
      let body = note.body_from_dom || allNoteBodies[noteKey] || '';

      let title = note.note_label || note.label || '';
      if (note.body_from_cache && title.includes('Note') && title.includes('...')) {
        const firstLine = body.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 5 && firstLine.length < 100) {
          title = firstLine;
        }
      }

      const el = renderNoteDivElement(idx, body, note, hasBody, title);
      notesListDiv.appendChild(el);
    });
  }

  const srcDiv = document.createElement('div');
  srcDiv.style.fontSize = '0.85em';
  srcDiv.style.color = '#888';
  srcDiv.style.marginTop = '6px';
  srcDiv.textContent = 'Source: ' + (source === 'api' ? 'API' : 'DOM') + (notes.some(n => n.body_from_cache) ? ' (with cache fallback)' : '');
  notesListDiv.appendChild(srcDiv);
  setPopupHeightToFirstNote();
}

function renderNoteDivElement(idx, body, note, hasBody, title) {
  const div = document.createElement('div');
  div.style.marginBottom = '10px';
  div.style.padding = '8px';
  div.style.background = hasBody ? '#f2f2f2' : '#fafafa';
  div.style.borderRadius = '4px';
  div.style.border = hasBody ? '2px solid #2C90ED' : '1px solid #ddd';
  div.style.cursor = 'pointer';

  div.innerHTML = '<b>' + title + '</b><br><small>' + (note.created_at ? new Date(note.created_at).toLocaleString() : '') + '</small>';

  if (hasBody) {
    div.innerHTML += '<br><pre style="white-space:pre-wrap;font-size:0.95em;margin:4px 0 0 0;">' + body.substring(0, 200) + (body.length > 200 ? '...' : '') + '</pre>';
  }

  if (hasBody) {
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '5px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '3px';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
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

    const saveSnippetBtn = document.createElement('button');
    saveSnippetBtn.textContent = 'Save Snippet';
    saveSnippetBtn.style.padding = '1px 8px';
    saveSnippetBtn.style.lineHeight = '1.2';
    saveSnippetBtn.style.fontSize = '0.9em';
    saveSnippetBtn.style.height = 'auto';

    saveSnippetBtn.onclick = function(e) {
      e.stopPropagation();
      const noteTimestampMs = note.created_at ? Date.parse(note.created_at) : Date.now();
      const defaultSnippetName = 'Snippet-' + formatTimestampForSnippetName(noteTimestampMs);
      const noteBody = body || '';

      saveSnippetBtn.textContent = 'Loading...';
      saveSnippetBtn.disabled = true;

      chrome.runtime.sendMessage(
        dotExpanderExtensionId,
        { type: 'GET_FOLDERS' },
        function(response) {
          saveSnippetBtn.textContent = 'Save Snippet';
          saveSnippetBtn.disabled = false;

          let folders = [];
          if (response?.success && response.folders) {
            folders = Array.isArray(response.folders) ? response.folders : [response.folders];
          } else {
            folders = [{ id: 'snippets', name: 'Snippets', path: 'Snippets' }];
          }

          showSnippetDialog(defaultSnippetName, folders, function(snippetName, folderId, folderName, createNewFolder) {
            debugLog('Saving snippet with name: ' + snippetName + ', folder: ' + folderName);

            chrome.runtime.sendMessage(
              dotExpanderExtensionId,
              { type: 'ping' },
              function(pingResponse) {
                debugLog('Simple ping response:', pingResponse);
                trySendingSnippet(snippetName, folderId, folderName, createNewFolder);
              }
            );
          });
        }
      );

      function trySendingSnippet(snippetName, folderId, folderName, createNewFolder) {
        try {
          let messagePayload;

          if (createNewFolder) {
            messagePayload = {
              type: 'updateStorage',
              data: {
                key: 'UserSnippets',
                value: {
                  snippets: {
                    type: 'folder',
                    name: 'Snippets',
                    timestamp: Date.now(),
                    list: [
                      {
                        type: 'folder',
                        name: folderName,
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
            messagePayload = {
              type: 'updateStorage',
              data: {
                key: 'UserSnippets',
                targetFolderId: folderId,
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

          debugLog('Sending Snippet to ' + dotExpanderExtensionId);
          saveSnippetBtn.textContent = 'Saving...';
          saveSnippetBtn.disabled = true;

          chrome.runtime.sendMessage(dotExpanderExtensionId, messagePayload, function(resp) {
            if (chrome.runtime.lastError) {
              handleExtensionError(chrome.runtime.lastError, dotExpanderExtensionId, noteBody);
            } else if (resp?.success) {
              debugLog('Snippet saved successfully');
              saveSnippetBtn.textContent = 'Saved!';
              setTimeout(function() {
                saveSnippetBtn.textContent = 'Save Snippet';
                saveSnippetBtn.disabled = false;
              }, 1000);
            } else {
              console.error('Snippet save failed:', resp?.error);
              saveSnippetBtn.textContent = 'Failed!';
              setTimeout(function() {
                saveSnippetBtn.textContent = 'Save Snippet';
                saveSnippetBtn.disabled = false;
              }, 1500);
            }
          });
        } catch (err) {
          handleExtensionError(err, dotExpanderExtensionId, noteBody);
        }
      }

      function handleExtensionError(error, extensionId, noteBody) {
        console.error('Communication with ' + extensionId + ' failed:', error);
        navigator.clipboard.writeText(noteBody).then(function() {
          saveSnippetBtn.textContent = 'Copied to clipboard!';
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

    buttonContainer.appendChild(copyBtn);
    if (dotExpanderIntegrationEnabled) {
      buttonContainer.appendChild(saveSnippetBtn);
    }

    div.appendChild(document.createElement('br'));
    div.appendChild(buttonContainer);
  } else {
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '5px';

    const extractBtn = document.createElement('button');
    extractBtn.textContent = 'View Note';
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
      findDoximityTab(function(tab) {
        if (tab) {
          if (note.uuid) {
            const url = 'https://www.doximity.com/scribe/visit_notes/' + note.uuid;
            chrome.tabs.update(tab.id, { url: url, active: true });
            extractBtn.textContent = 'Loading...';
            extractBtn.disabled = true;

            setTimeout(function() {
              chrome.tabs.sendMessage(tab.id, {
                type: 'EXTRACT_VISIBLE_NOTE',
                uuid: note.uuid
              }, function(response) {
                if (response && response.success && response.body) {
                  debugLog('Successfully extracted body for', note.uuid);
                  const bodyText = response.body;
                  div.innerHTML += '<br><pre style="white-space:pre-wrap;font-size:0.95em;margin:4px 0 0 0;">' + bodyText.substring(0, 200) + (bodyText.length > 200 ? '...' : '') + '</pre>';
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

  div.onclick = function() {
    findDoximityTab(function(tab) {
      if (tab) {
        if (note.uuid) {
          const url = 'https://www.doximity.com/scribe/visit_notes/' + note.uuid;
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
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'SET_MICROPHONE', value: select.value });
      }
    });
  };
  micDiv.appendChild(label);
  micDiv.appendChild(select);
}

function renderNoteTypeSelector(options, selected) {
  let noteTypeDiv = document.getElementById('note-type-selector-div');
  if (!noteTypeDiv) {
    noteTypeDiv = document.createElement('div');
    noteTypeDiv.id = 'note-type-selector-div';
    noteTypeDiv.style.margin = '12px 0';
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
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'SET_NOTE_TYPE', value: select.value });
      }
    });
  };
  noteTypeDiv.appendChild(label);
  noteTypeDiv.appendChild(select);
}

function renderMicButton(micActive, isResume) {
  if (micActive === undefined) micActive = false;
  if (isResume === undefined) isResume = false;

  let micBtnDiv = document.getElementById('mic-btn-div');
  if (!micBtnDiv) {
    micBtnDiv = document.createElement('div');
    micBtnDiv.id = 'mic-btn-div';
    micBtnDiv.style.textAlign = 'center';
    micBtnDiv.style.margin = '12px 0';
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
    findDoximityTab(function(tab) {
      if (tab) {
        debugLog('MicButton micActive before click:', micActive, 'isResume:', isResume);
        if (!micActive) {
          safeSendMessage(tab.id, { type: 'CLICK_MICROPHONE_BUTTON' }, function() {
            pollMicStateAndRender();
          });
        } else {
          safeSendMessage(tab.id, { type: 'CLICK_PAUSE_MICROPHONE_BUTTON' }, function() {
            pollForPausedState();
          });
        }
      }
    });
  };
  micBtnDiv.appendChild(btn);
}

function renderGenerateNoteButton() {
  let genDiv = document.getElementById('generate-note-div');
  if (!genDiv) {
    genDiv = document.createElement('div');
    genDiv.id = 'generate-note-div';
    genDiv.style.textAlign = 'center';
    genDiv.style.margin = '12px 0';
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
    btn.disabled = true;
    btn.textContent = 'Generating...';
    btn.style.background = '#90CAF9';
    btn.style.cursor = 'default';
    findDoximityTab(function(tab) {
      if (tab) {
        safeSendMessage(tab.id, { type: 'CLICK_GENERATE_NOTE_BUTTON' }, function(response) {
          debugLog("Generate Note clicked, response:", response);
          btn.textContent = 'Sent!';
          btn.style.background = '#4CAF50';
          setTimeout(function() { window.close(); }, 600);
        });
      }
    });
  };
  genDiv.appendChild(btn);
}

function showSnippetDialog(defaultName, folders, callback) {
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

  const dialog = document.createElement('div');
  dialog.style.backgroundColor = 'white';
  dialog.style.borderRadius = '8px';
  dialog.style.padding = '16px';
  dialog.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
  dialog.style.width = '80%';
  dialog.style.maxWidth = '300px';

  const title = document.createElement('h3');
  title.textContent = 'Save Snippet';
  title.style.margin = '0 0 12px 0';
  title.style.fontSize = '1.1em';

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

  const defaultOption = document.createElement('option');
  defaultOption.value = 'snippets';
  defaultOption.textContent = 'Snippets (Default)';
  defaultOption.dataset.name = 'Snippets';
  folderSelect.appendChild(defaultOption);

  function addFolderOptions(folderList, level) {
    if (!level) level = 0;
    if (!folderList || folderList.length === 0) return;
    folderList.forEach(folder => {
      if (!folder || !folder.id) return;
      if (folder.id === 'snippets' && folder.name === 'Snippets') return;
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = '  '.repeat(level) + (level > 0 ? '\u2514 ' : '') + folder.name;
      option.dataset.name = folder.name;
      folderSelect.appendChild(option);
      if (folder.subfolders && Array.isArray(folder.subfolders) && folder.subfolders.length > 0) {
        addFolderOptions(folder.subfolders, level + 1);
      }
    });
  }

  addFolderOptions(folders);

  const dialogBtnContainer = document.createElement('div');
  dialogBtnContainer.style.display = 'flex';
  dialogBtnContainer.style.justifyContent = 'flex-end';
  dialogBtnContainer.style.gap = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '6px 12px';
  cancelBtn.style.border = '1px solid #ccc';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.backgroundColor = '#f8f8f8';
  cancelBtn.style.cursor = 'pointer';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.padding = '6px 12px';
  saveBtn.style.border = 'none';
  saveBtn.style.borderRadius = '4px';
  saveBtn.style.backgroundColor = '#1976d2';
  saveBtn.style.color = 'white';
  saveBtn.style.cursor = 'pointer';

  dialog.appendChild(title);
  dialog.appendChild(nameLabel);
  dialog.appendChild(nameInput);
  dialog.appendChild(newFolderContainer);
  dialog.appendChild(newFolderNameContainer);
  dialog.appendChild(existingFolderContainer);
  dialog.appendChild(dialogBtnContainer);
  dialogBtnContainer.appendChild(cancelBtn);
  dialogBtnContainer.appendChild(saveBtn);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  setTimeout(() => nameInput.focus(), 50);

  cancelBtn.onclick = function() {
    document.body.removeChild(backdrop);
  };

  saveBtn.onclick = function() {
    const name = nameInput.value.trim() || defaultName;
    let folderId, folderName, createNewFolder;
    if (newFolderCheckbox.checked) {
      createNewFolder = true;
      folderName = newFolderNameInput.value.trim() || 'New Folder';
      folderId = 'snippets';
    } else {
      createNewFolder = false;
      folderId = folderSelect.value;
      folderName = folderSelect.options[folderSelect.selectedIndex].dataset.name ||
                  folderSelect.options[folderSelect.selectedIndex].textContent.trim().replace(/^[\u2514 ]+/, '');
    }
    document.body.removeChild(backdrop);
    callback(name, folderId, folderName, createNewFolder);
  };

  nameInput.onkeydown = folderSelect.onkeydown = function(e) {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  };
}

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

function addRetryButton() {
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
    retryScrapeBodies();
    setTimeout(() => {
      retryBtn.textContent = 'Activated Doximity Tab';
      setTimeout(() => {
        retryBtn.textContent = 'Load Full Note Content';
        retryBtn.disabled = false;
      }, 2000);
    }, 1000);
  };

  if (notesListDiv.firstChild) {
    notesListDiv.insertBefore(retryBtn, notesListDiv.firstChild);
  } else {
    notesListDiv.appendChild(retryBtn);
  }
}

function setPopupHeightToFirstNote() {
  setTimeout(() => {
    document.body.style.height = 'auto';
    document.body.style.overflowY = 'hidden';
    notesListDiv.style.maxHeight = 'none';
    notesListDiv.style.overflowY = 'visible';
  }, 50);
}

function formatTimestampForSnippetName(timestampMs) {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
}
