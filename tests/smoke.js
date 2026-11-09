// End-to-end smoke test. Runs index.html in jsdom with mocked Hacker News and AI
// provider responses, then clicks through the main features. Run with `npm test`.
const fs = require('fs');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];
const calls = [];
const now = Math.floor(Date.now() / 1000);
const story = id => ({ id, type: 'story', title: `Story ${id} about Rust`, url: `https://www.example${id}.com/post`, by: 'alice', time: now - 3600, score: 120, descendants: 12, kids: [9002, 9001] });
const tree = { id: 1, children: [
  { id: 9001, author: 'bob', created_at_i: now - 1000, text: 'I love this. <a href="https://news.ycombinator.com/item?id=777">ref</a><script>alert(1)</script><p>Second <i>para</i>', children: [
    { id: 9003, author: 'alice', created_at_i: now - 900, text: 'Thanks!', children: [] } ] },
  { id: 9002, author: 'carol', created_at_i: now - 800, text: '<p>Not convinced <img src=x onerror=alert(2)>', children: [
    { id: 9004, author: null, created_at_i: now - 700, text: null, children: [] } ] },
] };
const llmJson = JSON.stringify({ verdict: 'mixed', score: 12, heat: 'lively', headline: 'People like the idea but doubt the numbers', summary: 'Two camps.', split: { positive: 50, neutral: 20, negative: 30 }, themes: [{ label: 'Speed', sentiment: 'positive', detail: 'Fast.' }], standouts: [{ id: 'c9002', why: 'Best critique' }] });

async function fakeFetch(url, opts = {}) {
  calls.push(url);
  const ok = b => ({ ok: true, status: 200, json: async () => b });
  if (url.endsWith('topstories.json')) return ok(Array.from({ length: 45 }, (_, i) => i + 1));
  let m = url.match(/item\/(\d+)\.json/);
  if (m) { const id = +m[1]; return ok(id >= 9000 ? { id, type: 'comment', parent: 1, by: 'x', time: now } : story(id)); }
  if (url.includes('/api/v1/items/')) return ok(tree);
  if (url.includes('api.anthropic.com')) {
    const h = opts.headers; if (!h['anthropic-dangerous-direct-browser-access'] || h['x-api-key'] !== 'sk-ant-test1234') throw new Error('bad headers');
    const body = JSON.parse(opts.body);
    if (Array.isArray(body.system)) {
      if (!body.system[1].cache_control || !body.system[1].text.includes('[9001] bob')) throw new Error('ask transcript not cached');
      return ok({ content: [{ type: 'text', text: '- Critics doubt the numbers [9002]\n- Fans like it [9001]' }], usage: { input_tokens: 50, output_tokens: 40, cache_read_input_tokens: 9000 } });
    }
    if (!body.messages[0].content.includes('[9001] bob')) throw new Error('transcript missing');
    return ok({ content: [{ type: 'text', text: llmJson }], usage: { input_tokens: 10000, output_tokens: 500 } });
  }
  if (url.includes('generativelanguage')) {
    const body = JSON.parse(opts.body); globalThis.lastGeminiContents = body.contents.length; globalThis.geminiCalls = (globalThis.geminiCalls || 0) + 1;
    const isAsk = !body.generationConfig.responseMimeType;
    return ok({ candidates: [{ content: { parts: [{ text: isAsk ? '- Critics doubt the numbers [9002]\n- Supporters like the speed [9001, 9003]' : llmJson }] } }], usageMetadata: { promptTokenCount: 10000, candidatesTokenCount: 400 } });
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

const dom = new JSDOM(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), {
  url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = fakeFetch; w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream;
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { globalThis.copied = t; } } }); w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.structuredClone = structuredClone; w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange;
    Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto });
    Object.defineProperty(w, 'isSecureContext', { value: true });
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    const { createCanvas } = require('@napi-rs/canvas');
    w.HTMLCanvasElement.prototype.getContext = function () { this._c = createCanvas(this.width, this.height); return this._c.getContext('2d'); };
    w.HTMLCanvasElement.prototype.toDataURL = function (t) { return this._c.toDataURL(t); };
    w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
    w.addEventListener('error', e => errors.push(e.error || e.message));
    w.addEventListener('unhandledrejection', e => errors.push(e.reason));
  },
});
const w = dom.window, d = w.document;
w.console.error = (...a) => errors.push(a.join(' '));
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (c, msg) => { if (!c) { errors.push('FAIL: ' + msg); } else console.log('ok -', msg); };

(async () => {
  await wait(400);
  check(d.querySelectorAll('#list .row[data-id]').length === 30, 'feed renders 30 rows');
  check(d.querySelector('.r-dom').textContent === 'example1.com', 'domain strips www');
  check(d.querySelector('.hd-title').textContent === 'Top Stories', 'header title');
  // PWA
  const ml = d.querySelector('link[rel=manifest]');
  check(ml && ml.href.startsWith('data:application/manifest+json'), 'manifest link injected');
  const man = JSON.parse(decodeURIComponent(ml.href.split(',')[1]));
  check(man.icons.length === 3 && man.icons.every(i => i.src.startsWith('data:image/png;base64,')), 'manifest has 3 PNG icons');
  check(man.start_url === 'https://example.test/#/top' && man.display === 'standalone' && man.icons.some(i => i.purpose === 'maskable'), 'manifest start_url/display/maskable');
  check(d.querySelector('link[rel=apple-touch-icon]') && d.querySelector('link[rel=icon]'), 'apple-touch-icon and favicon');
  // text size from menu
  d.querySelector('.hdr .icon-btn[aria-label=More]').click(); await wait(50);
  [...d.querySelectorAll('.sheet-item')].find(b => b.textContent === 'Larger text').click(); await wait(50);
  check(d.documentElement.style.getPropertyValue('--ts') === '1.1', 'larger text sets --ts 1.1');
  check(JSON.parse(w.localStorage.getItem('uc.prefs')).textScale === 1.1, 'text size persisted');
  // install prompt
  let prompted = false;
  const ev = new w.Event('beforeinstallprompt', { cancelable: true }); ev.prompt = () => { prompted = true; }; ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  w.dispatchEvent(ev);
  d.querySelector('.hdr .icon-btn').click(); await wait(100);
  const ib = [...d.querySelectorAll('.nav button')].find(b => b.textContent.includes('Install app'));
  check(ib, 'drawer offers Install app');
  ib.click(); await wait(100);
  check(prompted, 'install prompt fired');
  // no key thread
  w.location.hash = '#/item/1'; await wait(400);
  check(d.querySelectorAll('.cm').length === 3, 'thread drops deleted comments with no replies, got ' + d.querySelectorAll('.cm').length);
  check(d.querySelector('#c-9002').compareDocumentPosition(d.querySelector('#c-9001')) & 4, 'top-level order follows HN kids');
  check(!d.querySelector('#thread script') && !d.querySelector('#thread img'), 'sanitizer strips script/img');
  check(d.querySelector('#c-9001 a[href="#/hn/777"]'), 'HN links rewritten in-app');
  check(d.querySelector('.ai').dataset.state === 'prompt', 'no-key prompt shown');
  const strayZero = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent === '0');
  check(![...d.querySelectorAll('.cm-toggle')].some(strayZero), 'no stray 0 after comment times on a first visit');
  // settings: save claude key
  d.querySelector('.ai .btn').click(); await wait(300);
  const inp = d.querySelector('#key-claude'); inp.value = 'sk-ant-test1234';
  inp.closest('.field').querySelector('.btn').click(); await wait(400);
  check(d.querySelector('.status')?.textContent.includes('1234'), 'claude key saved with hint');
  const rec = await new Promise(r => { const q = indexedDB.open('undercurrent'); q.onsuccess = () => { const t = q.result.transaction('secrets').objectStore('secrets').get('claude'); t.onsuccess = () => { r(t.result); q.result.close(); }; }; });
  check(rec && !Buffer.from(new Uint8Array(rec.ct)).toString().includes('sk-ant'), 'key stored encrypted');
  // close settings -> analysis runs (autorun)
  d.querySelector('.panel-hd .icon-btn').click(); await wait(600);
  check(d.querySelector('.ai').dataset.state === 'done', 'analysis rendered: ' + d.querySelector('.ai').dataset.state + ' ' + d.querySelector('.ai').textContent.slice(0, 200));
  check(d.querySelector('.read-link[href="#/item/1/9002"]'), 'standout links to comment');
  check(d.querySelector('.pill.v-mixed'), 'verdict pill');
  check(!/object HTML|false/.test(d.querySelector('.ai').textContent), 'no stringified nodes in mood card');
  // add gemini -> must nominate
  w.location.hash = '#/item/2'; await wait(400);
  check(d.querySelector('.ai').dataset.state === 'done', 'second thread auto-analyzed');
  // open settings via header more is a sheet; call directly through drawer
  w.location.hash = '#/top'; await wait(300);
  d.querySelector('.hdr .icon-btn').click(); await wait(100); // menu drawer
  [...d.querySelectorAll('.nav button')].find(b => b.textContent.includes('Settings')).click(); await wait(300);
  const g = d.querySelector('#key-gemini'); g.value = 'AIzaTestKey9876';
  g.closest('.field').querySelector('.btn').click(); await wait(400);
  check(d.querySelector('.notice[role=alert]'), 'nomination notice after second key');
  check(d.querySelectorAll('input[name=provider]').length === 2, 'two provider radios');
  const rg = d.querySelector('#textScale'); rg.value = '130'; rg.dispatchEvent(new w.Event('input'));
  check(d.documentElement.style.getPropertyValue('--ts') === '1.3' && d.querySelector('.ts-val').textContent === '130%', 'slider scales text live');
  check(d.querySelector('#set-install').textContent.includes('browser’s menu'), 'install section shows browser instructions');
  d.querySelector('.panel-hd .icon-btn').click(); await wait(200);
  w.location.hash = '#/item/3'; await wait(500);
  check(d.querySelector('.ai').textContent.includes('Choose which provider'), 'thread asks to pick provider');
  [...d.querySelectorAll('.ai .btn')].find(b => b.textContent.includes('Gemini')).click(); await wait(500);
  check(d.querySelector('.ai').dataset.state === 'done' && d.querySelector('.ai-foot').textContent.includes('Gemini'), 'gemini analysis after picking');
  // save comment + saved view
  d.querySelector('#c-9001 .cm-more').click(); await wait(50);
  [...d.querySelectorAll('.sheet-item')].find(b => b.textContent.includes('Save comment')).click(); await wait(200);
  w.location.hash = '#/saved/comments'; await wait(200);
  check(d.querySelectorAll('.scard').length === 1, 'saved comment listed');
  // deep link to comment
  w.location.hash = '#/item/1/9003'; await wait(500);
  check(d.querySelector('#c-9003'), 'deep link thread loaded');
  // collapse
  d.querySelector('#c-9001 .cm-toggle').click();
  check(d.querySelector('#c-9001').classList.contains('collapsed'), 'collapse works');
  // search
  w.location.hash = '#/saved'; await wait(100);
  check(d.querySelectorAll('.row').length === 0, 'no saved stories yet');
  const kvGet = k => new Promise(r => { const q = indexedDB.open('undercurrent'); q.onsuccess = () => { const t = q.result.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => { r(t.result); q.result.close(); }; }; });
  const led = await kvGet('ledger');
  check(led && led.calls === 3 && led.total > 0.05 && led.total < 0.1, 'spend recorded for 3 analyses: ' + JSON.stringify(led));
  w.location.hash = '#/item/2'; await wait(400);
  check(/\$0\.0\d/.test(d.querySelector('.ai-foot').textContent), 'cost shown in mood card footer: ' + d.querySelector('.ai-foot').textContent);
  // ask (gemini is active)
  w.location.hash = '#/item/1'; await wait(500);
  const askSec = d.querySelector('.ask');
  check(askSec && !askSec.hidden && askSec.querySelectorAll('.sugg .chip').length === 3, 'ask section with suggestions');
  check(!strayZero(askSec.querySelector('.ask-hd')), 'no stray 0 in an empty Ask header');
  askSec.querySelector('.sugg .chip').click(); await wait(500);
  check(d.querySelector('.ask .cite[href="#/item/1/9002"]')?.textContent === 'carol', 'answer cites comment as author link');
  check(d.querySelectorAll('.ask .a li').length === 2 && d.querySelectorAll('.ask .cite').length === 3, 'list answer with multi-id citation');
  d.querySelector('#askInput').value = 'And the supporters?';
  d.querySelector('.ask-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(500);
  check(d.querySelectorAll('.ask .qa').length === 2 && globalThis.lastGeminiContents === 3, 'follow-up sends prior Q&A: ' + globalThis.lastGeminiContents);
  w.location.hash = '#/item/2'; await wait(300); w.location.hash = '#/item/1'; await wait(500);
  check(d.querySelectorAll('.ask .qa').length === 2, 'Q&A history persists for thread');
  // feed moods + filter
  w.location.hash = '#/top'; await wait(400);
  check(d.querySelector('.row[data-id="1"] .r-mood') && d.querySelector('.moodbar'), 'feed rows show mood and filter bar');
  const chip = t => [...d.querySelectorAll('.moodbar .chip')].find(c => c.textContent.trim() === t);
  chip('Negative').click();
  check(d.querySelectorAll('.row[data-id]:not([hidden])').length === 0, 'negative filter hides mixed rows');
  chip('Mixed').click();
  check(d.querySelectorAll('.row[data-id]:not([hidden])').length === 3, 'mixed filter shows the 3 analyzed');
  check(d.querySelector('.moodnote').textContent.includes('not analyzed'), 'filter note explains hidden rows');
  chip('All').click();
  // pre-read
  d.querySelector('.hdr .icon-btn[aria-label=More]').click(); await wait(50);
  [...d.querySelectorAll('.sheet-item')].find(b => b.textContent === 'Settings').click(); await wait(300);
  d.querySelector('#preread').click(); await wait(300);
  d.querySelector('#prcount-5').click();
  check(d.querySelector('#set-preread').textContent.includes('covers about'), 'pre-read budget estimate shown');
  const before = globalThis.geminiCalls;
  d.querySelector('.panel-hd .icon-btn').click(); await wait(1500);
  check(globalThis.geminiCalls - before === 2, 'pre-read analyzed the 2 unread top-5 stories: ' + (globalThis.geminiCalls - before));
  check(d.querySelector('.row[data-id="5"] .r-mood') && !d.querySelector('.row[data-id="6"] .r-mood'), 'pre-read moods appear on rows 4-5 only');
  const led2 = await kvGet('ledger');
  check(led2.dayPreread > 0, 'pre-read spend tracked separately');
  // monthly cap blocks automatic analysis
  d.querySelector('.hdr .icon-btn[aria-label=More]').click(); await wait(50);
  [...d.querySelectorAll('.sheet-item')].find(b => b.textContent === 'Settings').click(); await wait(300);
  const capIn = d.querySelector('#monthlyCap'); capIn.value = '0.01'; capIn.dispatchEvent(new w.Event('change'));
  d.querySelector('.panel-hd .icon-btn').click(); await wait(200);
  w.location.hash = '#/item/9'; await wait(500);
  check(d.querySelector('.ai').textContent.includes('Analyze anyway') && d.querySelector('.ai').textContent.includes('monthly limit'), 'cap switches thread to manual');
  const c0 = globalThis.geminiCalls;
  [...d.querySelectorAll('.ai .btn')].find(b => b.textContent.includes('Analyze anyway')).click(); await wait(500);
  check(globalThis.geminiCalls === c0 + 1 && d.querySelector('.ai').dataset.state === 'done', 'Analyze anyway still runs');
  w.location.hash = '#/top'; await wait(300);
  d.querySelector('.hdr .icon-btn').click(); await wait(100);
  [...d.querySelectorAll('.nav button')].find(b => b.textContent.includes('Settings')).click(); await wait(300);
  d.querySelector('#use-claude').click(); await wait(300);
  d.querySelector('.panel-hd .icon-btn').click(); await wait(200);
  w.location.hash = '#/item/2'; await wait(500);
  d.querySelector('.ask .sugg .chip').click(); await wait(500);
  check(d.querySelector('.ask .cite')?.textContent === 'carol' && d.querySelector('.ask .qa-foot').textContent.startsWith('Claude'), 'Claude Q&A with cached transcript block');
  check(d.querySelector('.ask-note').textContent.includes('less for follow-ups'), 'Claude note mentions cheaper follow-ups');
  // analyze from the story menu (cap is $0.01 here, so this also proves user-started runs bypass it)
  w.location.hash = '#/top'; await wait(300);
  const led3 = await kvGet('ledger');
  check(!d.querySelector('.row[data-id="7"] .r-mood'), 'row 7 starts without a mood');
  d.querySelector('.row[data-id="7"] .r-more').click(); await wait(50);
  const item = [...d.querySelectorAll('.sheet-item')].find(b => b.textContent === 'Analyze mood');
  check(item, 'menu offers Analyze mood');
  let sawPending = false;
  const mo = new w.MutationObserver(() => { if (d.querySelector('.row[data-id="7"] .r-mood.pending')) sawPending = true; });
  mo.observe(d.querySelector('#list'), { childList: true, subtree: true });
  item.click(); await wait(500); mo.disconnect();
  check(sawPending, 'row shows Reading… while working');
  check(d.querySelector('.row[data-id="7"] .r-mood.v-mixed') && !d.querySelector('.row[data-id="7"] .pending'), 'row gets mood chip');
  check(d.querySelector('#toast').textContent.startsWith('Mood: Mixed +12 · $'), 'toast reports mood and cost: ' + d.querySelector('#toast').textContent);
  check((await kvGet('ledger')).calls === led3.calls + 1, 'manual analysis recorded in spend');
  d.querySelector('.row[data-id="7"] .r-more').click(); await wait(50);
  check([...d.querySelectorAll('.sheet-item')].some(b => b.textContent === 'Re-analyze mood'), 'menu now offers Re-analyze mood');
  d.querySelector('.scrim').close(); await wait(250);
  d.querySelector('.row[data-id="4"] .r-more').click(); await wait(50);
  check([...d.querySelectorAll('.sheet-item')].some(b => b.textContent === 'Re-analyze mood in full'), 'pre-read rows offer full re-analysis');
  d.querySelector('.scrim').close(); await wait(250);
  w.location.hash = '#/item/7'; await wait(500);
  check(d.querySelector('.ai').dataset.state === 'done', 'thread opens with the menu-made analysis, no new call');
  w.location.hash = '#/top'; await wait(300);
  d.querySelector('.hdr .icon-btn').click(); await wait(100);
  [...d.querySelectorAll('.nav button')].find(b => b.textContent.includes('Settings')).click(); await wait(300);
  d.querySelector('#theme-bright').click(); await wait(50);
  check(d.documentElement.dataset.theme === 'bright' && JSON.parse(w.localStorage.getItem('uc.prefs')).theme === 'bright', 'Bright theme applies and persists');
  d.querySelector('#theme-system').click(); await wait(50);
  check(!d.documentElement.dataset.theme, 'System clears the explicit theme');
  // ---- sharing summaries ----
  const callsNow = () => calls.filter(u => /anthropic|generativelanguage|openai/.test(u)).length;
  w.location.hash = '#/item/1'; await wait(500);
  [...d.querySelectorAll('.ai-actions .btn-text')].find(b => b.textContent === 'Share').click(); await wait(300);
  const prev = () => d.querySelector('.share-preview').textContent;
  check(prev().includes('Hacker News mood: Mixed, +12 (lively)') && prev().includes('Discussion: https://news.ycombinator.com/item?id=1'), 'share text has mood and HN link');
  check(prev().includes('https://www.example1.com/post'), 'share text has article link');
  check(!prev().includes('Q: '), 'Q&A left out by default');
  d.querySelector('#shareQA').click(); await wait(300);
  check(prev().includes('Q: What are the main objections?') && prev().includes('(carol)') && !/\[\d+\]/.test(prev()), 'Q&A included with citations as author names');
  check(/Open it in Undercurrent: https:\/\/example\.test\/#\/item\/1\/s\/1[\w-]{7}…$/.test(prev()), 'preview shortens the long app link');
  [...d.querySelectorAll('.share-actions .btn')].find(b => b.textContent.includes('Copy')).click(); await wait(250);
  const shared1 = globalThis.copied;
  const linkHash = shared1.match(/#\/item\/1\/s\/[\w-]+/)[0];
  check(shared1.includes('Q: ') && linkHash.length > 100, 'copied text carries full link, length ' + linkHash.length);
  // open the shared link while also having our own analysis
  const c1 = callsNow();
  w.location.hash = '#/top'; await wait(200);
  w.location.hash = linkHash; await wait(600);
  const ai = () => d.querySelector('.ai');
  check(ai().querySelector('.shared-note')?.textContent.includes('Shared with you. Made with Claude (claude-sonnet-5-5)'), 'shared view labelled');
  check(ai().querySelectorAll('.shared-qa .qa').length === 2 && ai().querySelector('.shared-qa .cite[href="#/item/1/9002"]'), 'shared Q&A rendered with live citations');
  const own = [...ai().querySelectorAll('.ai-actions .btn-text')].find(b => b.textContent === 'Show your analysis');
  check(own, 'offers to show own analysis');
  own.click(); await wait(300);
  check(!ai().querySelector('.shared-note') && [...ai().querySelectorAll('.ai-actions .btn-text')].some(b => b.textContent === 'Shared summary'), 'switches to own analysis with a way back');
  check(callsNow() === c1, 'opening a shared link makes no API call');
  // recipient with no analysis of their own: re-target the payload at story 8 (node zlib == deflate-raw)
  const zlib = require('zlib');
  const payload = JSON.parse(zlib.inflateRawSync(Buffer.from(linkHash.split('/s/')[1].slice(1), 'base64url')).toString());
  const enc = o => '1' + zlib.deflateRawSync(Buffer.from(JSON.stringify(o))).toString('base64url');
  w.location.hash = '#/item/8/s/' + enc({ ...payload, id: 8 }); await wait(700);
  check(ai().querySelector('.shared-note') && [...ai().querySelectorAll('.ai-actions .btn-text')].some(b => b.textContent === 'Analyze it yourself'), 'no own analysis: offers Analyze it yourself');
  check(callsNow() === c1, 'autorun is held back while a shared summary shows');
  check(!(await new Promise(r => { const q = indexedDB.open('undercurrent'); q.onsuccess = () => { const t = q.result.transaction('analysis').objectStore('analysis').get(8); t.onsuccess = () => { r(t.result); q.result.close(); }; }; })), 'shared summary not saved as own analysis');
  check(!d.querySelector('.row[data-id="8"] .r-mood'), 'shared summary does not tag the feed row');
  [...ai().querySelectorAll('.ai-actions .btn-text')].find(b => b.textContent === 'Analyze it yourself').click(); await wait(600);
  check(callsNow() === c1 + 1 && ai().dataset.state === 'done' && !ai().querySelector('.shared-note'), 'Analyze it yourself runs a real analysis');
  // hostile and broken links
  w.location.hash = '#/item/2/s/' + enc({ ...payload, id: 1 }); await wait(500);
  check(d.querySelector('#toast').textContent.includes("doesn't match the thread") && !ai().querySelector('.shared-note'), 'id mismatch rejected');
  w.location.hash = '#/item/2/s/1AAAA'; await wait(500);
  check(d.querySelector('#toast').textContent.includes('damaged'), 'garbage payload rejected');
  const evil = { ...payload, id: 5, m: 'x<img src=x onerror=alert(1)>', r: { ...payload.r, headline: '<script>alert(1)</script>', score: 9999, verdict: 'ecstatic' }, qa: [{ q: '<b>hi</b>', a: 'see [9001]' }] };
  w.location.hash = '#/item/5/s/' + enc(evil); await wait(600);
  check(!ai().querySelector('script, img') && ai().querySelector('.ai-headline').textContent === '<script>alert(1)</script>'
    && ai().querySelector('.shared-qa .q').textContent === '<b>hi</b>' && !ai().querySelector('.shared-qa .q b'), 'hostile payload rendered as inert text');
  check(ai().querySelector('.ai-score').textContent === '+100' && ai().querySelector('.pill.v-mixed') && !/[<>="]/.test(ai().querySelector('.shared-note').textContent), 'hostile values clamped and model name reduced to safe characters');
  const big = '1' + zlib.deflateRawSync(Buffer.from(JSON.stringify({ ...payload, id: 6, pad: 'a'.repeat(500000) }))).toString('base64url');
  w.location.hash = '#/item/6/s/' + big; await wait(600);
  check(d.querySelector('#toast').textContent.includes('damaged') && !ai().querySelector('.shared-note'), 'oversized (zip bomb) payload rejected: ' + big.length);
  // header menu entry
  w.location.hash = '#/item/1'; await wait(400);
  d.querySelector('.hdr .icon-btn[aria-label=More]').click(); await wait(50);
  check([...d.querySelectorAll('.sheet-item')].some(b => b.textContent === 'Share summary'), 'thread menu offers Share summary');
  console.log('\nerrors:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})();
