// options.js
// Handles integration settings for PracticeQ, DotExpander, and Debug Mode

document.addEventListener('DOMContentLoaded', function() {
  const practiceQCheckbox = document.getElementById('practiceq-integration-checkbox');
  const practiceQSaveStatus = document.getElementById('practiceq-save-status');
  const dotExpanderCheckbox = document.getElementById('dotexpander-integration-checkbox');
  const dotExpanderSaveStatus = document.getElementById('dotexpander-save-status');
  const dotExpanderDetectStatus = document.getElementById('dotexpander-detect-status');
  const openEmrCheckbox = document.getElementById('openemr-integration-checkbox');
  const openEmrSaveStatus = document.getElementById('openemr-save-status');
  const openEmrDomainContainer = document.getElementById('openemr-domain-container');
  const openEmrDomainInput = document.getElementById('openemr-domain-input');
  const debugCheckbox = document.getElementById('debug-mode-checkbox');
  const debugSaveStatus = document.getElementById('debug-save-status');

  // Load all settings in a single call
  chrome.storage.sync.get([
    'practiceQIntegrationEnabled',
    'dotExpanderIntegrationEnabled',
    'dotExpanderExtensionId',
    'openEmrIntegrationEnabled',
    'openEmrDomain',
    'debugModeEnabled'
  ], function(result) {
    practiceQCheckbox.checked = !!result.practiceQIntegrationEnabled;
    dotExpanderCheckbox.checked = !!result.dotExpanderIntegrationEnabled;
    openEmrCheckbox.checked = !!result.openEmrIntegrationEnabled;
    openEmrDomainInput.value = result.openEmrDomain || 'demo.openemr.io';
    if (openEmrCheckbox.checked) {
      openEmrDomainContainer.style.display = 'block';
    }
    debugCheckbox.checked = !!result.debugModeEnabled;
    if (dotExpanderCheckbox.checked) {
      detectDotExpander();
    }
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

  // DotExpander checkbox — auto-detect on enable
  dotExpanderCheckbox.addEventListener('change', function() {
    if (dotExpanderCheckbox.checked) {
      detectDotExpander(function(found) {
        chrome.storage.sync.set({ dotExpanderIntegrationEnabled: found }, function() {
          if (found) {
            flashSaved(dotExpanderSaveStatus);
          } else {
            dotExpanderCheckbox.checked = false;
          }
        });
      });
    } else {
      chrome.storage.sync.set({ dotExpanderIntegrationEnabled: false }, function() {
        dotExpanderDetectStatus.innerHTML = '';
        flashSaved(dotExpanderSaveStatus);
      });
    }
  });

  function detectDotExpander(callback) {
    dotExpanderDetectStatus.innerHTML = '<span style="color:#888;">Scanning for DotExpander...</span>';
    chrome.management.getAll(function(extensions) {
      var match = extensions.find(function(ext) {
        var name = ext.name.toLowerCase();
        return name.includes('dotexpander') || name.includes('dot expander');
      });
      if (match && match.enabled) {
        chrome.storage.sync.set({ dotExpanderExtensionId: match.id });
        dotExpanderDetectStatus.innerHTML =
          '<span style="color:#4CAF50;">&#10003; Detected: <strong>' + match.name + '</strong></span>';
        if (callback) callback(true);
      } else if (match && !match.enabled) {
        dotExpanderDetectStatus.innerHTML =
          '<span style="color:#ff9800;">DotExpander found but disabled. Please enable it in chrome://extensions.</span>';
        if (callback) callback(false);
      } else {
        dotExpanderDetectStatus.innerHTML =
          '<span style="color:#d32f2f;">DotExpander extension not detected. Please install it first.</span>';
        if (callback) callback(false);
      }
    });
  }

  // OpenEMR
  openEmrCheckbox.addEventListener('change', function() {
    if (openEmrCheckbox.checked) {
      openEmrDomainContainer.style.display = 'block';
      var domain = openEmrDomainInput.value.trim() || 'demo.openemr.io';
      chrome.storage.sync.set({ openEmrIntegrationEnabled: true, openEmrDomain: domain }, function() {
        flashSaved(openEmrSaveStatus);
        // Notify background to register content script for custom domain
        chrome.runtime.sendMessage({ type: 'REGISTER_OPENEMR_DOMAIN', domain: domain });
      });
    } else {
      openEmrDomainContainer.style.display = 'none';
      chrome.storage.sync.set({ openEmrIntegrationEnabled: false }, function() {
        flashSaved(openEmrSaveStatus);
        chrome.runtime.sendMessage({ type: 'UNREGISTER_OPENEMR_DOMAIN' });
      });
    }
  });

  // Save domain when changed
  openEmrDomainInput.addEventListener('change', function() {
    var domain = openEmrDomainInput.value.trim() || 'demo.openemr.io';
    chrome.storage.sync.set({ openEmrDomain: domain }, function() {
      flashSaved(openEmrSaveStatus);
      if (openEmrCheckbox.checked) {
        chrome.runtime.sendMessage({ type: 'REGISTER_OPENEMR_DOMAIN', domain: domain });
      }
    });
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
        // _execute_action is Chrome's internal name for the extension icon/popup shortcut
        if (cmd.name === '_execute_action') {
          name = 'Open extension popup';
          if (!cmd.shortcut) shortcut = 'Alt+Comma';
        }
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
