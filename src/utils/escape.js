// Shared HTML / attribute / URL escaping helpers for the NedhubSMS frontend.
// Every dynamic value inserted into the DOM must pass through one of these.
// Load this script before any page script that builds HTML from data.
(function () {
  'use strict';

  var ESCAPE_CHARS = /[&<>"'`]/g;
  var HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '`': '&#x60;'
  };

  // Escape text for safe insertion into the HTML body (text within innerHTML).
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(ESCAPE_CHARS, function (ch) {
      return HTML_ENTITIES[ch];
    });
  }

  // Escape text for safe insertion into a double-quoted HTML attribute value.
  function escapeAttr(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(ESCAPE_CHARS, function (ch) {
      return HTML_ENTITIES[ch];
    });
  }

  // Only return http, https or mailto URLs, or relative paths. Anything else
  // (javascript:, data:, vbscript:, file:, etc.) becomes an empty string.
  function safeUrl(url) {
    if (url === null || url === undefined) return '';
    var s = String(url);
    if (s === '') return '';
    // Reject any URL with a scheme before resolving relative paths.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
      try {
        var u = new URL(s, window.location.href);
        var protocol = u.protocol;
        if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
          return s;
        }
      } catch (e) {
        // fall through to empty
      }
      return '';
    }
    // Relative path / protocol-relative without a scheme: keep as-is.
    return s;
  }

  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.safeUrl = safeUrl;
})();
