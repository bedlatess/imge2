# Minimal Tech UI And Behavior Fixes

## Goal

Refresh AstraForge into a cleaner, minimal technology workspace while fixing broken Chinese text, loading placeholders, and local cleanup behavior.

## Scope

- Replace garbled UI copy with clear Simplified Chinese.
- Redesign the main layout as a compact creator workspace with a left control panel and a large results area.
- Keep existing product concepts: studio, prompt library, connection center, local records, admin workspace.
- Make loading placeholders match the requested generation count.
- Make local cleanup clear both usage records and generated images in the browser.
- Keep backend API contracts unchanged unless a user-facing server message must be corrected.

## Interaction Design

The default screen is the usable studio, not a marketing page. Controls are dense but calm: prompt input, reference image upload, provider selection, model, count, ratio, quality, format, and generate action sit together. The gallery uses stable tiles, explicit empty states, and small metadata instead of large decorative cards.

Navigation remains simple: Studio, Prompts, Connections, Records, Admin. Visual style uses dark neutrals, thin borders, cyan and amber accents, restrained motion, and precise spacing.

## Data Behavior

Generated images and usage records remain local-first in `localStorage`. Clearing records also clears the local gallery so returning to the studio does not show stale images.

During generation, pending gallery placeholders are rendered from the current requested count. The final image count still depends on the upstream provider response.

## Verification

- Build with `npm run build`.
- Run the app locally and inspect the main responsive layout.
- Verify requested count controls pending placeholders.
- Verify clearing records removes local records and gallery images.
