// options.js
// Handles integration settings for PracticeQ and DotExpander

document.addEventListener('DOMContentLoaded', function() {
  // PracticeQ Integration
  const practiceQCheckbox = document.getElementById('practiceq-integration-checkbox');
  const practiceQSaveStatus = document.getElementById('practiceq-save-status');

  // Load saved PracticeQ setting, default to false
  chrome.storage.sync.get(['practiceQIntegrationEnabled'], function(result) {
    practiceQCheckbox.checked = result.practiceQIntegrationEnabled === undefined ? false : !!result.practiceQIntegrationEnabled;
  });

  // Save PracticeQ on change
  practiceQCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ practiceQIntegrationEnabled: practiceQCheckbox.checked }, function() {
      practiceQSaveStatus.style.display = 'inline';
      setTimeout(() => { practiceQSaveStatus.style.display = 'none'; }, 1200);
    });
  });

  // DotExpander Integration
  const dotExpanderCheckbox = document.getElementById('dotexpander-integration-checkbox');
  const dotExpanderSaveStatus = document.getElementById('dotexpander-save-status');

  // Load saved DotExpander setting, default to false
  chrome.storage.sync.get(['dotExpanderIntegrationEnabled'], function(result) {
    dotExpanderCheckbox.checked = result.dotExpanderIntegrationEnabled === undefined ? false : !!result.dotExpanderIntegrationEnabled;
  });

  // Save DotExpander on change
  dotExpanderCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ dotExpanderIntegrationEnabled: dotExpanderCheckbox.checked }, function() {
      dotExpanderSaveStatus.style.display = 'inline';
      setTimeout(() => { dotExpanderSaveStatus.style.display = 'none'; }, 1200);
    });
  });

  // Add handler to open Chrome keyboard shortcuts page
  const shortcutBtn = document.getElementById('open-shortcuts-settings');
  if (shortcutBtn) {
    shortcutBtn.addEventListener('click', function() {
      window.open('chrome://extensions/shortcuts', '_blank');
    });
  }
});
