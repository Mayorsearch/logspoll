import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCatalogCategories, screenshotCategories } from '../src/lib/category-navigation.ts'

test('includes all 28 screenshot shop category labels without invented counts', () => {
  assert.equal(screenshotCategories.length, 28)
  const categories = mergeCatalogCategories([])
  for (const name of ['Google', 'Tools/AI Subscriptions', 'Firstmail.ltd', 'Apple iTunes Gift Card', 'Twitch']) assert.ok(categories.some(category => category.name === name))
  assert.ok(categories.every(category => category.product_count === undefined))
})
test('uses connected slugs and real counts, retaining additional database categories', () => {
  const categories = mergeCatalogCategories([{ slug: 'x-social', name: 'X', product_count: 0 }, { slug: 'business', name: 'Business Tools', product_count: 7 }, { slug: 'social-tools', name: 'Social Media Services', product_count: 4 }])
  assert.equal(categories.find(category => category.name === 'Twitter')?.slug, 'x-social')
  assert.equal(categories.find(category => category.name === 'Twitter')?.product_count, 0)
  assert.equal(categories.find(category => category.name === 'Social Media Tools')?.slug, 'social-tools')
  assert.equal(categories.find(category => category.name === 'Business Tools')?.product_count, 7)
  assert.equal(new Set(categories.map(category => category.slug)).size, categories.length)
})
