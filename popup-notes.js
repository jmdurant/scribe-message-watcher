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
          let freshNotes = [];
          if (response && response.success && response.data) {
            freshNotes = (response.data.props && response.data.props.visit_notes) || [];
            debugLog('FETCH_NOTES success, source:', response.source, 'count:', freshNotes.length);
          } else {
            debugLog('FETCH_NOTES failed or empty response:', response);
          }

          // If we got notes from the page, cache the list as the source of truth
          if (freshNotes.length > 0) {
            chrome.storage.session.set({ cachedNotesList: freshNotes });
          }

          // Use fresh notes if available, otherwise load from cached list
          function proceed(notes) {
            debugLog('Proceeding with notes count:', notes.length);

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

              // Merge: if cacheBodies has UUIDs not in the notes list,
              // add them (e.g. new notes detected via DOM but not yet in API response)
              const noteUuids = new Set(notes.map(n => n.uuid || n.label));
              Object.keys(updatedCacheBodies).forEach(cacheKey => {
                if (!noteUuids.has(cacheKey)) {
                  // Check partial matches too — skip if this key partially matches an existing note
                  const hasPartial = notes.some(n => {
                    const nk = n.uuid || n.label;
                    return nk.includes(cacheKey) || cacheKey.includes(nk);
                  });
                  if (!hasPartial) {
                    debugLog('Merging cached note not in list:', cacheKey);
                    const now = new Date();
                    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const day = days[now.getDay()];
                    let hours = now.getHours();
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12 || 12;
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const label = day + ', ' + hours + ':' + minutes + ampm;
                    notes.unshift({
                      uuid: cacheKey,
                      note_label: label,
                      created_at: now.toISOString(),
                      _from_cache: true
                    });
                  }
                }
              });

              allNoteBodies = updatedCacheBodies;
              window.lastNotes = notes;

              // Update cachedNotesList with any merged notes
              if (notes.length > 0) {
                chrome.storage.session.set({ cachedNotesList: notes });
              }

              hideLoading();

              if (notes.length > 0) {
                showInstructions(false);
                debugLog('Calling showNotes with', notes.length, 'notes');
                showNotes(notes, response ? response.source : 'cached');
                scrapeVisibleIfMissing(notes);
              } else {
                renderNoNotesFound();
              }
            });
          }

          if (freshNotes.length > 0) {
            proceed(freshNotes);
          } else {
            // Page didn't return notes (tab may be on wrong page) — use cached list
            chrome.storage.session.get('cachedNotesList', function(result) {
              const cached = result.cachedNotesList || [];
              debugLog('Using cached notes list, count:', cached.length);
              if (cached.length > 0) {
                proceed(cached);
              } else {
                hideLoading();
                showInstructions(true, 'Please log in to Doximity and open Scribe.');
                notesListDiv.innerHTML = '';
              }
            });
          }
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

// Only scrape bodies for notes currently visible in the popup
function scrapeVisibleIfMissing(notes) {
  const visibleNotes = notes.slice(0, displayedCount);
  const missingNotes = visibleNotes.filter(n => {
    const key = n.uuid || n.label;
    return !allNoteBodies[key] || allNoteBodies[key].length < 10;
  });

  if (missingNotes.length === 0) {
    debugLog('All visible note bodies are cached, no scraping needed');
    return;
  }

  debugLog('Scraping bodies for', missingNotes.length, 'visible notes');
  findDoximityTab(function(tab) {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_ALL_NOTE_BODIES', notes: missingNotes }, function(resp) {
      if (chrome.runtime.lastError) {
        debugLog('Error sending SCRAPE_ALL_NOTE_BODIES:', chrome.runtime.lastError);
        pendingScrapeNotes = missingNotes;
      } else {
        debugLog('SCRAPE_ALL_NOTE_BODIES sent for visible notes');
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
