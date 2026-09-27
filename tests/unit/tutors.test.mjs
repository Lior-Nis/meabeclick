import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUTORS, contactTutor, tutorNames } from '../../src/lib/tutors.ts';

test('exactly one tutor is the contact tutor', () => {
  const contacts = TUTORS.filter(t => t.contact);
  assert.equal(contacts.length, 1);
});

test('the contact tutor is ניקול', () => {
  assert.equal(contactTutor().name, 'ניקול');
});

test('tutor names are unique', () => {
  const names = TUTORS.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('tutor ids are unique', () => {
  const ids = TUTORS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every tutor carries a photo, alt text, heading and non-empty bio', () => {
  for (const t of TUTORS) {
    assert.ok(t.photo.startsWith('/images/'), `${t.id} has a photo path`);
    assert.ok(t.alt.length > 0, `${t.id} has alt text`);
    assert.ok(t.heading.includes(t.name), `${t.id}'s heading names the tutor`);
    assert.ok(Array.isArray(t.bio) && t.bio.length > 0, `${t.id} has bio lines`);
  }
});

test('tutorNames joins the real roster the way the dashboard subtitle always has', () => {
  assert.equal(tutorNames(), 'ניקול וליאור');
});

const mkTutor = (name) => ({ id: name, name, photo: '/images/x.png', alt: name, heading: name, bio: ['x'] });

test('tutorNames: a single tutor is just their name', () => {
  assert.equal(tutorNames([mkTutor('א')]), 'א');
});

test('tutorNames: two tutors join with the Hebrew conjunction, no comma', () => {
  assert.equal(tutorNames([mkTutor('א'), mkTutor('ב')]), 'א וב');
});

test('tutorNames: three or more tutors comma-separate all but the last pair', () => {
  assert.equal(tutorNames([mkTutor('א'), mkTutor('ב'), mkTutor('ג')]), 'א, ב וג');
});
