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

  // Load and display actual keyboard shortcuts from manifest
  var shortcutsList = document.getElementById('shortcuts-list');
  if (shortcutsList) {
    chrome.commands.getAll(function(commands) {
      var html = '<table style="width:100%;border-collapse:collapse;">';
      commands.forEach(function(cmd) {
        var shortcut = cmd.shortcut || '<em style="color:#999;">Not set</em>';
        var name = cmd.description || cmd.name;
        html += '<tr style="border-bottom:1px solid #eee;">';
        html += '<td style="padding:4px 8px 4px 0;"><code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;">' + shortcut + '</code></td>';
        html += '<td style="padding:4px 0;">' + name + '</td>';
        html += '</tr>';
      });
      html += '</table>';
      shortcutsList.innerHTML = html;
    });
  }
});
