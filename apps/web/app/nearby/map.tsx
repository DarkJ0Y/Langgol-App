'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'

/*
 * Marker sizes, in screen pixels. Named so they read as what they are — drawing dimensions —
 * and not as the business "radius" (a delivery distance) the lint rule guards against.
 */
const FARM_MARKER_PX = 9
const ORIGIN_MARKER_PX = 8

/**
 * The map: OpenStreetMap tiles drawn by Leaflet, with you and the nearest farms on it.
 *
 * The one piece of the market that needs JavaScript, so it stays small: Leaflet is loaded only
 * here, only in the browser, and only after the page has rendered (the list beside the map works
 * without it). Markers are circles, not images, so there is nothing else to download.
 *
 * Swappable: when a Google Maps key is configured this component is replaced by a Google
 * implementation taking the same props; the page and its data do not change.
 *
 * Farm names are user-entered, so popups are built from DOM text nodes, never from an HTML
 * string.
 */

export interface MapFarm {
  readonly id: string
  readonly name: string
  readonly lat: number
  readonly lng: number
  readonly caption: string
  readonly href: string
  readonly linkLabel: string
}

export function NearbyMap({
  origin,
  originLabel,
  farms,
}: {
  origin: { lat: number; lng: number }
  originLabel: string
  farms: readonly MapFarm[]
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let map: LeafletMap | null = null

    void import('leaflet').then(({ default: L }) => {
      if (disposed || container.current === null) return

      map = L.map(container.current, { scrollWheelZoom: false })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        // The OpenStreetMap licence requires this credit to stay visible.
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      const popup = (farm: MapFarm) => {
        const box = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = farm.name
        const caption = document.createElement('div')
        caption.textContent = farm.caption
        const link = document.createElement('a')
        link.href = farm.href
        link.textContent = farm.linkLabel
        box.append(title, caption, link)
        return box
      }

      const style = getComputedStyle(document.documentElement)
      const green = style.getPropertyValue('--lg-viz-brand').trim() || '#16a34a'
      const ink = style.getPropertyValue('--lg-text-primary').trim() || '#000000'

      const points: [number, number][] = [[origin.lat, origin.lng]]
      for (const farm of farms) {
        points.push([farm.lat, farm.lng])
        L.circleMarker([farm.lat, farm.lng], {
          radius: FARM_MARKER_PX,
          color: '#ffffff',
          weight: 2,
          fillColor: green,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(popup(farm))
      }

      L.circleMarker([origin.lat, origin.lng], {
        radius: ORIGIN_MARKER_PX,
        color: '#ffffff',
        weight: 3,
        fillColor: ink,
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(originLabel, { permanent: false })

      if (points.length > 1) {
        map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 11 })
      } else {
        map.setView([origin.lat, origin.lng], 9)
      }
    })

    return () => {
      disposed = true
      map?.remove()
    }
  }, [origin.lat, origin.lng, originLabel, farms])

  return <div ref={container} className="lg-map" role="region" aria-label={originLabel} />
}
