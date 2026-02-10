// intakeq_content.js - Content script for IntakeQ client pages

let name = null;
let date = null;
let visit_start = null;
let visit_end = null;
let provider = null;
let MRN = null;
let DOB = null;
let gender = null;
let sex = null;
let referring_provider = null;

// Helper: extract value by label (targeted selectors instead of body *)
function getClientLabelValue(labelText) {
  const labels = Array.from(document.querySelectorAll('span, label, div, td, th, .client-label')).filter(el =>
    Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().toLowerCase().includes(labelText.toLowerCase()))
  );
  for (const label of labels) {
    const span = label.parentElement.querySelector('span.client-label');
    if (span && span.textContent.trim()) {
      return span.textContent.trim();
    }
    let next = label.nextElementSibling;
    while (next) {
      if (next.classList.contains('client-label') && next.textContent.trim()) {
        return next.textContent.trim();
      }
      next = next.nextElementSibling;
    }
  }
  return null;
}

function extractClientData() {
  // 1. Name
  const clientAnchor = document.querySelector('a[ng-click="unselect()"][style*="color: #999;"]');
  name = clientAnchor ? clientAnchor.textContent.trim() : null;

  // 2. Date
  const dateDiv = Array.from(document.querySelectorAll('div'))
    .find(div => div.textContent && div.textContent.trim().match(/^[A-Za-z]{3} \d{1,2}, \d{4}$/));
  date = dateDiv ? dateDiv.textContent.trim() : null;

  // 3. Visit Start Time
  const timeDiv = document.querySelector('div.png-time.form-control[model="vm.appointment.StartTime"]');
  if (timeDiv) {
    const hour = timeDiv.querySelector('input[name="hour"]')?.value || '';
    const minute = timeDiv.querySelector('input[name="minute"]')?.value || '';
    const mode = timeDiv.querySelector('input[name="mode"]')?.value || '';
    visit_start = (hour + ':' + minute + ' ' + mode).trim();
  } else {
    visit_start = null;
  }

  // 4. Visit End Time
  const endDiv = document.querySelector('div.png-time.form-control[model="vm.appointment.EndTime"]');
  if (endDiv) {
    const hour = endDiv.querySelector('input[name="hour"]')?.value || '';
    const minute = endDiv.querySelector('input[name="minute"]')?.value || '';
    const mode = endDiv.querySelector('input[name="mode"]')?.value || '';
    visit_end = (hour + ':' + minute + ' ' + mode).trim();
  } else {
    visit_end = null;
  }

  // 5. Provider — tightened heuristic: max 100 chars, leaf node only
  const providerDiv = Array.from(document.querySelectorAll('div'))
    .find(div => {
      const txt = div.textContent && div.textContent.trim();
      return txt &&
        txt.length > 2 &&
        txt.length <= 100 &&
        div.children.length === 0 &&
        txt !== name &&
        !txt.match(/^[A-Za-z]{3} \d{1,2}, \d{4}$/) &&
        !txt.match(/\d{1,2}:\d{2}/);
    });
  provider = providerDiv ? providerDiv.textContent.trim() : null;

  // 6. MRN
  MRN = getClientLabelValue('Client ID');

  // 7. DOB
  DOB = getClientLabelValue('Date of Birth');

  // 8. Sex
  sex = getClientLabelValue('Sex') || getClientLabelValue('Gender');

  // 9. Referring Provider
  referring_provider = getClientLabelValue('Referring Provider');
}

function clearClientData() {
  name = null;
  date = null;
  visit_start = null;
  visit_end = null;
  provider = null;
  MRN = null;
  DOB = null;
  gender = null;
  sex = null;
  referring_provider = null;
}

function checkAndExtract() {
  if (window.location.hash.startsWith('#/client/')) {
    extractClientData();
  } else {
    clearClientData();
  }
}

// Initial extraction
checkAndExtract();
window.addEventListener('hashchange', checkAndExtract);
window.addEventListener('popstate', checkAndExtract);

// Expose for popup/background via messaging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CLIENT_DATA') {
    sendResponse({ name, date, visit_start, visit_end, provider, MRN, DOB, sex, referring_provider });
  }
});
