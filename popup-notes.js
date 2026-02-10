// popup-notes.js — Note fetching, caching, and template logic

function fetchNotesViaContentScript(cb) {
  findDoximityTab(function(tab) {
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, function(response) {
        cb(response);
      });
    } else {
      cb({ success: false, error: 'No Doximity tab found.' });
    }
  });
}

function debugCacheKeyMismatch(notes, cacheBodies) {
  debugLog("====== CACHE KEY DIAGNOSTIC ======");
  debugLog("Notes UUIDs:", notes.map(n => n.uuid || n.label));
  debugLog("Cache keys:", Object.keys(cacheBodies));

  notes.forEach((note, idx) => {
    const noteKey = note.uuid || note.label;
    debugLog("Note " + idx + " (" + noteKey + "):");
    debugLog("  - Direct match: " + !!cacheBodies[noteKey]);
    const partialMatches = Object.keys(cacheBodies).filter(key =>
      key.includes(noteKey) || noteKey.includes(key)
    );
    debugLog("  - Partial matches: " + JSON.stringify(partialMatches));
  });
  debugLog("=================================");
}

function fetchNotesAndShow() {
  debugLog('fetchNotesAndShow called.');
  showLoading();

  chrome.storage.sync.get(['practiceQIntegrationEnabled', 'dotExpanderIntegrationEnabled', 'dotExpanderExtensionId'], function(result) {
    practiceQIntegrationEnabled = !!result.practiceQIntegrationEnabled;
    dotExpanderIntegrationEnabled = !!result.dotExpanderIntegrationEnabled;
    dotExpanderExtensionId = result.dotExpanderExtensionId || 'ljlmfclhdpcppglkaiieomhmpnfilagd';

    findDoximityTab(function(tab) {
      if (tab) {
        doximityTabId = tab.id;
        if (tab.url && tab.url.match(/\/scribe\/visits\//)) {
          debugLog('On /scribe/visits/*, showing controls only.');
          notesListDiv.innerHTML = '';
          hideLoading();
          showInstructions(false);
          fetchMicSelector();
          return;
        }
        debugLog('Sending FETCH_NOTES message to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'FETCH_NOTES' }, function(response) {
          if (!response || !response.success || !response.data) {
            debugLog('FETCH_NOTES failed or empty response:', response);
            hideLoading();
            showInstructions(true, 'Please log in to Doximity and open Scribe.');
            notesListDiv.innerHTML = '';
            return;
          }
          debugLog('FETCH_NOTES success, source:', response.source);
          let notes = (response.data.props && response.data.props.visit_notes) || [];
          debugLog('Notes received count:', notes.length);

          debugLog('Sending GET_CACHED_NOTE_BODIES message to tab:', tab.id);
          chrome.tabs.sendMessage(tab.id, { type: 'GET_CACHED_NOTE_BODIES' }, function(cacheResp) {
            let cacheBodies = (cacheResp && cacheResp.success && cacheResp.data) ? cacheResp.data : {};
            debugLog('Cached note bodies received, keys:', Object.keys(cacheBodies).length);

            debugCacheKeyMismatch(notes, cacheBodies);

            const updatedCacheBodies = {...cacheBodies};
            notes.forEach(note => {
              const noteKey = note.uuid || note.label;
              if (updatedCacheBodies[noteKey]) return;
              const partialMatches = Object.keys(cacheBodies).filter(key =>
                key.includes(noteKey) || noteKey.includes(key)
              );
              if (partialMatches.length > 0) {
                debugLog('Found partial match for ' + noteKey + ':', partialMatches[0]);
                updatedCacheBodies[noteKey] = cacheBodies[partialMatches[0]];
              }
            });

            allNoteBodies = updatedCacheBodies;

            if (notes.length === 0 && Object.keys(cacheBodies).length > 0) {
              debugLog('No notes found but cache has bodies. Using cache to construct notes.');
              notes = Object.keys(cacheBodies).map(uuid => ({
                uuid: uuid,
                note_label: 'Note ' + uuid.substring(0, 8) + '...',
                created_at: new Date().toISOString(),
                body_from_cache: true
              }));
            }

            window.lastNotes = notes;

            const missing = notes.some(n => {
              const key = n.uuid || n.label;
              return !updatedCacheBodies[key];
            });

            hideLoading();

            if (notes.length > 0) {
              showInstructions(false);
              debugLog('Calling showNotes immediately with cached bodies');
              showNotes(notes, response.source);
            } else {
              renderNoNotesFound();
            }

            if (missing) {
              debugLog('Missing bodies detected, sending SCRAPE_ALL_NOTE_BODIES for', notes.length, 'notes');
              chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_ALL_NOTE_BODIES', notes }, function(resp) {
                if (chrome.runtime.lastError) {
                  debugLog('Error sending SCRAPE_ALL_NOTE_BODIES:', chrome.runtime.lastError);
                  pendingScrapeNotes = notes;
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
                  debugLog('SCRAPE_ALL_NOTE_BODIES sent successfully');
                  showStatus('Scraping all note bodies...', '#2C90ED');
                }
              });
            }
          });
        });
      } else {
        hideLoading();
        instructionsDiv.innerHTML =
          '<p>No Doximity Scribe tab found.</p>' +
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
    });
  });
}

function retryScrapeBodies() {
  if (!pendingScrapeNotes || !pendingScrapeNotes.length) return;

  debugLog('Retrying body scraping for', pendingScrapeNotes.length, 'notes');

  findDoximityTab(function(tab) {
    if (!tab) return;
    chrome.tabs.update(tab.id, { active: true }, () => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SCRAPE_ALL_NOTE_BODIES',
          notes: pendingScrapeNotes
        }, function(resp) {
          if (chrome.runtime.lastError) {
            debugLog('Retry still failed:', chrome.runtime.lastError);
            setTimeout(retryScrapeBodies, 5000);
          } else {
            debugLog('Retry successful');
            pendingScrapeNotes = null;
          }
        });
      }, 1000);
    });
  });
}

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
  let dt = new Date(dateStr + ' ' + timeStr);
  if (!isNaN(dt)) return dt;
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [_, m, d, y] = match;
    return new Date(y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0') + 'T' + timeStr.replace(/ /, ''));
  }
  return new Date();
}

function isNoteInVisitWindow(noteTitle, clientData) {
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
