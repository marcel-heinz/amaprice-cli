const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/extractors/html-json');

test('html-json extractor prefers buybox display price context', () => {
  const html = `
    <script>
      {"other_group":[{"displayPrice":"3,43\\u00a0€"}],
       "desktop_buybox_group_1":[{"displayPrice":"79,99\\u00a0€"}]}
    </script>
  `;

  const candidate = __test.extractPriceFromHtml(html, 'EUR');
  assert.ok(candidate);
  assert.equal(candidate.parsed.numeric, 79.99);
  assert.equal(candidate.parsed.currency, 'EUR');
});

test('html-json blocked detector catches challenge URL and captcha text', () => {
  const blocked = __test.detectBlockedPage({
    httpStatus: 200,
    pageTitle: 'Sicherheitsprufung',
    bodyText: 'Automatisierte Zugriffe. Bitte geben Sie die Zeichen ein.',
    finalUrl: 'https://www.amazon.de/errors/validateCaptcha',
  });

  assert.equal(blocked.blockedSignal, true);
  assert.equal(blocked.blockedReason, 'challenge_page');
});

test('html-json default headers set amazon locale cookie/language', () => {
  const headers = __test.defaultHeadersForDomain('amazon.de');
  assert.equal(headers.cookie, 'i18n-prefs=EUR');
  assert.match(headers['accept-language'], /de-DE/);
});

test('html-json title extraction strips tags and whitespace', () => {
  const title = __test.extractTitleFromHtml('<title>  Example <b>Title</b>  </title>');
  assert.equal(title, 'Example Title');
});
