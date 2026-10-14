/**
 * How a crop is pictured: an emoji on a solid category tint.
 *
 * Not photographs. The catalogue has no images yet (`Product.imageKey` is empty), a stock photo
 * of "a tomato" says nothing about THIS farmer's tomatoes, and an image per card is the heaviest
 * thing a market page could make a farmer on 2G download. An emoji is a few bytes, renders in
 * colour on every phone, and is recognised without reading — which matters for a buyer scanning
 * a grid, and more for a reader less at home with text.
 *
 * When real listing photos arrive they replace this, card by card; nothing else changes.
 */

const MARKS: Record<string, string> = {
  tomato: '🍅',
  potato: '🥔',
  onion: '🧅',
  brinjal: '🍆',
  'bottle-gourd': '🥒',
  mango: '🥭',
  banana: '🍌',
  'rice-paddy': '🌾',
}

/** Category → tint token suffix (ui.css `.lg-produce--*`). */
const TONES: Record<string, string> = {
  vegetables: 'veg',
  fruit: 'fruit',
  grain: 'grain',
}

export function produceMark(slug: string): string {
  return MARKS[slug] ?? '🌱'
}

export function produceTone(categorySlug: string | null | undefined): string {
  return TONES[categorySlug ?? ''] ?? 'veg'
}
