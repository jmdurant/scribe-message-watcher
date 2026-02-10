// options.js
// Handles integration settings for PracticeQ, DotExpander, and Debug Mode

document.addEventListener('DOMContentLoaded', function() {
  const practiceQCheckbox = document.getElementById('practiceq-integration-checkbox');
  const practiceQSaveStatus = document.getElementById('practiceq-save-status');
  const dotExpanderCheckbox = document.getElementById('dotexpander-integration-checkbox');
  const dotExpanderSaveStatus = document.getElementById('dotexpander-save-status');
  const dotExpanderIdInput = document.getElementById('dotexpander-extension-id');
  const debugCheckbox = document.getElementById('debug-mode-checkbox');
  const debugSaveStatus = document.getElementById('debug-save-status');

  // Load all settings in a single call
  chrome.storage.sync.get([
    'practiceQIntegrationEnabled',
    'dotExpanderIntegrationEnabled',
    'dotExpanderExtensionId',
    'debugModeEnabled'
  ], function(result) {
    practiceQCheckbox.checked = !!result.practiceQIntegrationEnabled;
    dotExpanderCheckbox.checked = !!result.dotExpanderIntegrationEnabled;
    dotExpanderIdInput.value = result.dotExpanderExtensionId || 'ljlmfclhdpcppglkaiieomhmpnfilagd';
    debugCheckbox.checked = !!result.debugModeEnabled;
  });

  function flashSaved(statusEl) {
    statusEl.style.display = 'inline';
    setTimeout(function() { statusEl.style.display = 'none'; }, 1200);
  }

  // PracticeQ
  practiceQCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ practiceQIntegrationEnabled: practiceQCheckbox.checked }, function() {
      flashSaved(practiceQSaveStatus);
    });
  });

  // DotExpander checkbox
  dotExpanderCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ dotExpanderIntegrationEnabled: dotExpanderCheckbox.checked }, function() {
      flashSaved(dotExpanderSaveStatus);
    });
  });

  // DotExpander extension ID
  dotExpanderIdInput.addEventListener('change', function() {
    var id = dotExpanderIdInput.value.trim();
    if (id) {
      chrome.storage.sync.set({ dotExpanderExtensionId: id }, function() {
        flashSaved(dotExpanderSaveStatus);
      });
    }
  });

  // Debug mode
  debugCheckbox.addEventListener('change', function() {
    chrome.storage.sync.set({ debugModeEnabled: debugCheckbox.checked }, function() {
      flashSaved(debugSaveStatus);
    });
  });

  // Add handler to open Chrome keyboard shortcuts page
  var shortcutBtn = document.getElementById('open-shortcuts-settings');
  if (shortcutBtn) {
    shortcutBtn.addEventListener('click', function() {
      window.open('chrome://extensions/shortcuts', '_blank');
    });
  }
});
