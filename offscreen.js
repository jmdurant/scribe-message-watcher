// offscreen.js — Handles clipboard writes from the service worker
// navigator.clipboard.writeText() doesn't work in offscreen docs (no focus),
// so we use the deprecated document.execCommand('copy') approach.

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen-clipboard') return;
  if (message.type !== 'copy-to-clipboard') return;

  const textarea = document.getElementById('text');
  textarea.value = message.data;
  textarea.select();
  document.execCommand('copy');
});
