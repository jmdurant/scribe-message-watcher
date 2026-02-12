// openemr_content.js - Content script for OpenEMR patient pages

let name = null;
let date = null;
let visit_start = null;
let visit_end = null;
let provider = null;
let MRN = null;
let DOB = null;
let age = null;
let sex = null;
let referring_provider = null;

function extractClientData() {
  // 1. Patient Name: <span data-bind="text: pname()">
  const nameEl = document.querySelector('span[data-bind="text: pname()"]');
  name = nameEl ? nameEl.textContent.trim() : null;

  // 2. DOB and Age: <span data-bind="text:patient().str_dob()"> DOB: 1991-01-25 Age: 34</span>
  const dobAgeEl = document.querySelector('span[data-bind="text:patient().str_dob()"]');
  if (dobAgeEl) {
    const dobAgeText = dobAgeEl.textContent;
    const dobMatch = dobAgeText.match(/DOB:\s*([0-9-]+)/);
    DOB = dobMatch ? dobMatch[1] : null;
    const ageMatch = dobAgeText.match(/Age:\s*(\d+)/);
    age = ageMatch ? ageMatch[1] : null;
  } else {
    DOB = null;
    age = null;
  }

  // 3. Encounter Date: <span data-bind="text:selectedEncounter().date()">
  const encounterDateEl = document.querySelector('span[data-bind="text:selectedEncounter().date()"]');
  date = encounterDateEl ? encounterDateEl.textContent.trim() : null;

  // 4. Sex: <span data-bind="text: patient().sex()">
  const sexEl = document.querySelector('span[data-bind="text: patient().sex()"]') ||
                document.querySelector('span[data-bind="text:patient().sex()"]');
  sex = sexEl ? sexEl.textContent.trim() : null;

  // 5. MRN / Patient ID: <span data-bind="text: patient().pubpid()"> or <span data-bind="text: pid()">
  const mrnEl = document.querySelector('span[data-bind="text: patient().pubpid()"]') ||
                document.querySelector('span[data-bind="text:patient().pubpid()"]') ||
                document.querySelector('span[data-bind="text: pid()"]') ||
                document.querySelector('span[data-bind="text:pid()"]');
  MRN = mrnEl ? mrnEl.textContent.trim() : null;

  // 6. Provider: <span data-bind="text:selectedEncounter().provider()"> or similar
  const providerEl = document.querySelector('span[data-bind="text:selectedEncounter().provider()"]') ||
                     document.querySelector('span[data-bind="text: selectedEncounter().provider()"]');
  provider = providerEl ? providerEl.textContent.trim() : null;

  // 7. Referring Provider: <span data-bind="text: patient().ref_providerID()"> or label-based
  const refEl = document.querySelector('span[data-bind="text: patient().ref_providerID()"]') ||
                document.querySelector('span[data-bind="text:patient().ref_providerID()"]');
  referring_provider = refEl ? refEl.textContent.trim() : null;

  // 8. Visit start/end times (if available in encounter data)
  const startEl = document.querySelector('span[data-bind="text:selectedEncounter().onset_date()"]');
  visit_start = startEl ? startEl.textContent.trim() : null;

  const endEl = document.querySelector('span[data-bind="text:selectedEncounter().end_date()"]');
  visit_end = endEl ? endEl.textContent.trim() : null;

  debugLog('OpenEMR extracted:', { name, DOB, age, date, MRN, sex, provider, referring_provider });
}

function clearClientData() {
  name = null;
  date = null;
  visit_start = null;
  visit_end = null;
  provider = null;
  MRN = null;
  DOB = null;
  age = null;
  sex = null;
  referring_provider = null;
}

function checkAndExtract() {
  // OpenEMR patient pages typically have patient data bindings present
  const hasPatientData = document.querySelector('span[data-bind="text: pname()"]');
  if (hasPatientData) {
    extractClientData();
  } else {
    clearClientData();
  }
}

// Initial extraction
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  checkAndExtract();
} else {
  document.addEventListener('DOMContentLoaded', checkAndExtract);
}

// Re-extract on SPA navigation
window.addEventListener('hashchange', checkAndExtract);
window.addEventListener('popstate', checkAndExtract);

// Re-extract on DOM changes (debounced)
let extractTimeout = null;
const observer = new MutationObserver(() => {
  if (extractTimeout) clearTimeout(extractTimeout);
  extractTimeout = setTimeout(checkAndExtract, 200);
});
observer.observe(document.body, { childList: true, subtree: true });

// Respond to popup requests — same interface as intakeq_content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CLIENT_DATA') {
    sendResponse({ name, date, visit_start, visit_end, provider, MRN, DOB, sex, referring_provider });
  }
});
