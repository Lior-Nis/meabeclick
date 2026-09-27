// Appending to a reactive chat list, and why the obvious version is wrong.
//
// The student question box showed a "⋯" bubble forever while /api/ask was
// answering 200 with a real answer. `chat` is $state([]), which is a PROXY:
// objects pushed into it are wrapped, and the array holds the wrapper. The
// code kept the literal it pushed and wrote the answer through that, which
// bypasses the proxy's set trap — the value changed and nothing re-rendered.
// Nothing server-side was wrong, and nothing in the app logged a thing; it
// was found in Caddy's access log, in the gap between "status 200" and "the
// user says it doesn't work".
//
// A real $state array is not available here (that needs the Svelte
// compiler), so these use a stand-in with the one property that matters: it
// hands back a wrapper, never the object that was pushed. Verified
// separately against the real compiler — mutating the literal leaves a
// $derived over the list rendering the OLD value, mutating the element
// renders the new one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendMessage, removeMessage } from '../../src/lib/chat-log.js';

/** An array that wraps its elements on read, as $state does. The wrapper is
 *  stable per object, which is what makes indexOf work for callers that hold
 *  one — and fail for callers that hold the raw literal. */
function reactiveList() {
  const raw = [];
  const wrappers = new WeakMap();
  const wrap = (o) => {
    if (!wrappers.has(o)) wrappers.set(o, new Proxy(o, {}));
    return wrappers.get(o);
  };
  return new Proxy(raw, {
    get(t, k) {
      if (typeof k === 'string' && /^\d+$/.test(k)) return t[k] === undefined ? undefined : wrap(t[k]);
      if (k === 'indexOf') return (needle) => t.findIndex(o => wrap(o) === needle);
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

test('appendMessage hands back the list element, never the object passed in', () => {
  // THE bug. Returning the literal is what froze the chat on "⋯": writes to
  // it never reach the proxy, so the template never updates.
  const list = reactiveList();
  const literal = { cls: 'bot', text: '⋯' };
  const returned = appendMessage(list, literal);

  assert.notEqual(returned, literal, 'returning the literal is the bug');
  assert.equal(returned, list[0], 'callers must get the element the list holds');
});

test('the returned element is the one the list renders', () => {
  const list = reactiveList();
  const msg = appendMessage(list, { cls: 'bot', text: '⋯' });
  msg.text = 'ANSWER';
  assert.equal(list[0].text, 'ANSWER', 'the answer must reach the rendered list');
});

test('removeMessage removes the element the caller holds', () => {
  const list = reactiveList();
  const first = appendMessage(list, { cls: 'me', text: 'שאלה' });
  const thinking = appendMessage(list, { cls: 'bot', text: '⋯' });

  assert.equal(removeMessage(list, thinking), true);
  assert.equal(list.length, 1);
  assert.equal(list[0].text, 'שאלה', 'the wrong message was removed');
  assert.equal(list[0], first);
});

test('removing something absent removes NOTHING, rather than the last element', () => {
  // The second half of the same bug: indexOf of a literal the list does not
  // hold is -1, and a bare splice(-1, 1) deletes the last element. That was
  // masked only because the thinking bubble happened to be last.
  const list = reactiveList();
  appendMessage(list, { cls: 'me', text: 'ראשון' });
  appendMessage(list, { cls: 'bot', text: 'אחרון' });

  assert.equal(removeMessage(list, { cls: 'bot', text: '⋯' }), false);
  assert.equal(list.length, 2, 'an unfound message must not delete anything');
  assert.equal(list[1].text, 'אחרון');
});
