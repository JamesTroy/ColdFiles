/**
 * The Cold File — design tokens.
 *
 * Source of truth: docs/04_DESIGN_SYSTEM.md.
 * Every component imports `tokens` from here. Do not hard-code hex anywhere
 * in the app — if a value isn't in the token table, the design hasn't sanctioned it.
 *
 * Dark mode IS the design. There is no light variant. If accessibility audits
 * post-launch force a light mode, it inverts surfaces + text only and keeps
 * accents/pins untouched (see "Light mode" in the design doc).
 */

export const tokens = {
  color: {
    bg: {
      // Warm-ash dark — barely off-true-black, but warm enough to read as
      // ash/paper rather than void. Spec: pure black eats OLED detail.
      base: '#0c0a08',
      // Map / sheet body surface — warm "ash" replacing neutral charcoal.
      elev1: '#15120f',
      // Elevated cards / chip inactive fill.
      elev2: '#241f1a',
      // Pressed states + sheet handle slot.
      elev3: '#2e2823',
      /** Selected radio cards — border carries selection, this bg reinforces. */
      amberTintCard: '#161208',
      /** Small amber affordances (UNSOLVED pill, active filter chip) — bg carries the affordance alone. */
      amberTintPill: '#2a2520',
      /** Trust-disclosure callout background — barely-blue tint behind the you.here left edge. */
      infoTint: '#0e1418',
      /** Recently-resolved pill background. */
      resolvedTint: '#1a201b',
    },
    border: {
      subtle: '#1f1a14',
      strong: '#2a2520',
      /** 1dp dividers, chip outlines — slightly warmer than border.strong. */
      hairline: '#3a322b',
    },
    text: {
      primary: '#f5f1ea',
      // Bumped from #8a8580 → #a09b95 to clear WCAG AA 4.5:1 against bg.base
      // (#0a0a0a). The old value was 3.8:1 and got flagged in the
      // accessibility audit. Use this for body-weight secondary copy; for
      // small labels (<14px) prefer text.primary or evidence.chrome on a
      // dark elevated surface.
      secondary: '#a09b95',
      disabled: '#5a5550',
      /**
       * Desaturated light blue for prose-length user-trust copy at 11–13px on near-black.
       * NOT interchangeable with you.here — edge accents go saturated, body goes light.
       */
      info: '#b5d4f4',
    },
    accent: {
      amber: '#c5a572',
      /** Recently-updated case ring (only). */
      amberHot: '#e3c485',
    },
    pin: {
      homicide: '#9a8569',
      missing: '#c5a572',
      doe: '#d5cdb8',
    },
    cluster: {
      // Translucent amber haze instead of cool gray — reads as "indexed
      // archive" rather than generic data point. Ring carries the brand
      // amber; fill is the amber at low alpha so map tiles show through.
      fill: 'rgba(197,165,114,0.20)',
      ring: '#c5a572',
      text: '#f5f1ea',
      /** Soft outer halo, 8dp shadow blur. */
      halo: 'rgba(197,165,114,0.10)',
    },
    /**
     * Saturated mid blue for edge accents and dot fills — never used as body
     * text. This is THE brand-signature mid-blue: the trust-disclosure left
     * edge, the brand-mark dot, the YouAreHere map marker. Do NOT replace
     * with cream/amber on the user-location dot — the blue dot IS the brand
     * mark per components/cf/brand-mark.tsx. Map-redesign spec claimed a
     * "no-cold-blue rule"; that rule applies to PINS (homicide/missing/doe
     * shape-first encoding), not to the user-location dot.
     */
    you: {
      here: '#5b8fb0',
      /** Soft halo around the user-location dot — pulses on the map. */
      halo: 'rgba(91,143,176,0.18)',
    },
    /**
     * Map basemap tint overrides. Consumed by leaflet-map.tsx (CSS filters on
     * the tile pane) and the future MapLibre style JSON. All values rendered
     * at low opacity; this is "warm-dark editorial chart" not "navigation
     * basemap" — labels look-at-when-needed only.
     */
    map: {
      water: '#0a0908',
      land: '#15120f',
      park: '#181410',
      roadMinor: 'rgba(232,220,196,0.10)',
      roadMajor: 'rgba(232,220,196,0.22)',
      roadMotorway: 'rgba(232,220,196,0.32)',
      boundary: 'rgba(232,220,196,0.18)',
      label: 'rgba(232,220,196,0.70)',
      labelLo: 'rgba(232,220,196,0.45)',
    },
    /** The only sanctioned use of red in the entire app. */
    tip: { success: '#b04545' },
    /** The only sanctioned use of green in the entire app. */
    status: { resolved: '#6a8b6e' },
    /** Filing-system furniture: photo brackets, caption strips, source-chip borders. */
    evidence: { chrome: '#5a5550' },
    /** Reading off-white for the narrative body — sits between text.primary and text.secondary. */
    body: { reading: '#d5cdbe' },
    /** List-thumbnail silhouette (placeholder when no photo URL). */
    silhouette: {
      bg: '#1f1a10',
      figure: '#3a3325',
    },
    /** Photo frame interior bg — slightly cooler than bg.elev1 to read as "behind glass". */
    photoFrame: { bg: '#0e0e0e' },
  },

  /**
   * Font families. Loaded via expo-font in app/_layout.tsx — see app/_layout.tsx
   * for the exact source paths. Keys here must match the `Font.loadAsync` keys.
   */
  font: {
    /** 18px+ only — case detail header + peek-sheet selected-case title. */
    serif: 'Newsreader_500Medium',
    sans: 'Inter_400Regular',
    sansMedium: 'Inter_500Medium',
    sansSemibold: 'Inter_600SemiBold',
    /** Mono runs Medium, not Regular, at small sizes — see typography hard rules. */
    mono: 'JetBrainsMono_500Medium',
    monoSemibold: 'JetBrainsMono_600SemiBold',
  },

  size: {
    serifH1: 28,
    serifH2: 20,
    h3: 18,
    body: 14,
    meta: 12,
    narrative: 13,
    rowName: 16,
    monoLabel: 10,
    monoData: 12,
    monoChip: 11,
    monoCaption: 9,
  },

  tracking: {
    label: 0.10,
    chip: 0.05,
    heading: -0.01,
  },

  radius: {
    chip: 14,
    card: 8,
    sheet: 16,
    pill: 12,
  },

  /**
   * Layout constants shared across screens. The "card gap" is the de-facto
   * vertical spacing between stacked cards on settings-style screens (Me,
   * Diagnostics, Notifications, Tip history). 12px lets two card edges sit
   * close enough to read as the same surface family while preserving a
   * legible hairline gutter.
   */
  layout: {
    cardGap: 12,
  },

  pin: {
    /** stroke = max(1.5, round(diameter / 8)) */
    strokeForDiameter: (d: number): number => Math.max(1.5, Math.round(d / 8)),
    /** inner dot is 40% of outer diameter for ring-plus-dot pins (Missing) */
    innerDotRatio: 0.4,
    selected: { haloScale: 1.6, haloAlpha: 0.5 },
    recent: {
      ringScale: 1.4,
      /** Decay: full opacity day 0–3, half day 4–10, gone after 10. Stepwise. */
      alphaByAge: (days: number): number => (days <= 3 ? 1 : days <= 10 ? 0.5 : 0),
    },
  },

  cluster: {
    /**
     * Square-root scale per redesign spec — `28 + sqrt(count) * 3.5`, clamped
     * to [28, 64]. Linear scaling makes large clusters dominate; the
     * sqrt curve gives the sense of "more here" without runaway growth.
     */
    diameterFor: (count: number): number =>
      Math.max(28, Math.min(64, Math.round(28 + Math.sqrt(Math.max(0, count)) * 3.5))),
    /** Per-metro override; default 11. Below this zoom, cluster instead of pins. */
    zoomThreshold: { default: 11, 'la-county': 11, 'nv-rural': 14 } as Record<string, number>,
    expandStaggerMs: 200,
  },

  /**
   * Map runtime tokens. Consumed by components/cf/maps-view.tsx (MapLibre GL
   * Native + OpenFreeMap public tiles — no API key, no signup, no Google
   * Cloud account).
   */
  map: {
    /**
     * MapLibre style URL. OpenFreeMap is community-funded OSM-derived tile
     * hosting; their `dark` style is a clean Carto-derived dark basemap
     * that fits the case-file aesthetic out of the box.
     *
     * Other free options on the same host: liberty, positron, bright, 3d.
     * To go fully custom, host a MapLibre style JSON anywhere (S3, GitHub
     * Pages, Supabase Storage) and swap this URL.
     *
     * Tile usage: OpenFreeMap doesn't enforce per-key quotas — it's a
     * public service. MapLibre handles tile caching client-side
     * automatically.
     */
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',

    /**
     * Debounce window between viewport pan/zoom events and the cases_in_bbox
     * refetch. 200ms balances liveness against thrashing the RPC; tune on a
     * real device with a real LA-County dataset before locking.
     */
    viewportDebounceMs: 200,

    /**
     * Default starting camera. First-launch users see the launch metro
     * centered before they grant location permission.
     */
    defaultCenter: { lat: 34.275, lng: -119.229, zoomLevel: 9 },
  },

  caseDetail: {
    /** Cold-pill computation. Returns the rendered string or null (don't render). */
    coldPill: (
      incidentDate: Date | null,
      quality: 'exact' | 'approximate' | 'year_only' | 'suspect' | 'unknown',
      now: Date = new Date(),
    ): string | null => {
      if (!incidentDate || quality === 'suspect' || quality === 'unknown') return null;
      const days = Math.floor((now.getTime() - incidentDate.getTime()) / 86_400_000);
      if (days < 365) return null;
      const years = Math.floor(days / 365.25);
      return quality === 'exact' ? `${years}y cold` : `~${years}y cold`;
    },
    /** Recently-resolved pill: shown when status flipped to identified/cleared within this window. */
    resolvedWindowDays: 30,
    /** Narrative truncation target on the case-detail entry screen. */
    narrativeWords: 40,
    /** Source-chip ordering — sort by trust_weight DESC, last_ingested_at DESC as tiebreaker. */
    sourceSortOrder: ['trust_weight desc', 'last_ingested_at desc'] as const,
  },

  tipFlow: {
    /**
     * CTA copy precedence: agency.short_name (≤18 chars) → leading acronym → "the agency" fallback.
     * The full agency.name always appears in the disclosure callout right above the button —
     * the user never taps a button without seeing the receiver's full name on the same screen.
     */
    ctaCopy: (agency: { name: string; short_name?: string | null }): string => {
      const short = agency.short_name;
      if (short && short.length <= 18) return `Send to ${short}`;
      const acronym = agency.name.match(/^[A-Z]{2,5}\b/);
      if (acronym && acronym[0].length <= 18) return `Send to ${acronym[0]}`;
      return 'Send to the agency';
    },
    /** Per-case override beats agency default beats federal fallback. */
    routeResolutionOrder: ['case', 'agency', 'fbi'] as const,
    /**
     * Trust-disclosure surfaces — required, not optional. The redundancy is
     * the point. The "what you share with them" clause is load-bearing: it
     * keeps our promise scoped honestly to what we control (routing) rather
     * than implying we control the agency's intake form. Agencies collect
     * what they collect — that's between the user and the agency, not us.
     */
    disclosureSurfaces: {
      caseDetailCaption: 'Tips route to the agency · The Cold File never stores them',
      modal: (agencyName: string): string =>
        `Routes directly to ${agencyName}. The Cold File never reads, holds, or stores your tip. What you share with them is between you and the agency.`,
      success: (agencyName: string): string =>
        `Routes directly to ${agencyName}. The Cold File never reads, holds, or stores your tip.`,
    },
    /** Tip-success animation: 600ms total, ease-out — only sanctioned use of tip.success in-app. */
    successFlashMs: { in: 200, hold: 100, out: 300 },
    /**
     * Anticipation pause between tap and deep-link attempt.
     *
     * Gives the optimistic insert time to register and prevents the success
     * flash from colliding with the modal-dismiss animation. Tune on a real
     * device — 200ms is the starting estimate, not a final number. A value
     * that controls product feel lives in tokens, never as a screen-local
     * constant.
     */
    anticipationMs: 200,
  },
} as const;

export type Tokens = typeof tokens;

/**
 * Convenience map for pin shape selection by case kind.
 * Geometry: filled circle (homicide), ring + inner dot (missing), open ring (unidentified/doe).
 * See components/pin.tsx for the renderer.
 */
export const PIN_SHAPE_BY_KIND = {
  homicide: 'filled' as const,
  missing: 'ring_dot' as const,
  unidentified: 'open_ring' as const,
  unclaimed: 'open_ring' as const,
  suspicious_death: 'filled' as const,
};

/** Convenience map for pin color selection by case kind. */
export const PIN_COLOR_BY_KIND: Record<keyof typeof PIN_SHAPE_BY_KIND, string> = {
  homicide: tokens.color.pin.homicide,
  missing: tokens.color.pin.missing,
  unidentified: tokens.color.pin.doe,
  unclaimed: tokens.color.pin.doe,
  suspicious_death: tokens.color.pin.homicide,
};
