# Local-Only History And Privacy Defaults

## Goal

Generated image history should be private by default. The application should not write prompts, model names, provider names, generated counts, or upstream error details to the server during normal image generation.

## Design

- The browser owns generation history through localStorage.
- The backend image proxy returns generation results and diagnostics, but does not persist usage logs unless a future explicit opt-in is added.
- The Usage view reads local browser records and supports single-record deletion and clearing all local records without requiring login.
- Existing backend usage endpoints remain for compatibility and old-data cleanup, but the frontend no longer depends on them.
- Default generation settings favor speed: one image by default and automatic quality unless the user chooses a heavier setting.

## Data Flow

1. User submits a generation request.
2. Frontend sends the request to `/api/images/generate`.
3. Backend validates the provider and forwards the request upstream without writing usage metadata.
4. Frontend stores a success or failure record locally.
5. User can delete local records from the Usage view.

## Error Handling

- Upstream diagnostics are still returned to the active browser session.
- Failed generations create local-only error records so users can debug the current browser history.
- If browser storage is full, records remain in memory for the current session and the UI shows a notice.

## Performance

- Default image count becomes 1.
- Default quality becomes `auto`.
- The frontend stops refreshing server usage after generation.
- A speed preset applies conservative request parameters for faster responses.

