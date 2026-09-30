/**
 * How a master lesson's slug is made and recognised. Its own module so
 * that code which only needs to know "is this a master" (the lessons
 * list, the editor) does not load the preparation queue with it.
 */
const SLUG_PREFIX = 'lib-';
const segment = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `lib-<template>-<skill>-<time>`: a legal path segment that says what it is. */
export function masterSlug(templateId: string, skillKey: string, now: number = Date.now()): string {
  return `${SLUG_PREFIX}${segment(templateId)}-${segment(skillKey)}-${now.toString(36)}`;
}

export const isLibrarySlug = (slug: string): boolean => slug.startsWith(SLUG_PREFIX);
