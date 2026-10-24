# Automat Faceless Hosted Picker Proof

This standalone static page checks whether a separately authorized web app can
select one existing Google Vids document, read its Drive metadata, and (only
after a second explicit acknowledged action) prepare and receive a whole-document
MP4. An additional explicit, nonce-armed action can hand the already prepared
URI to the installed extension for one browser-managed download. It does not
modify a Vids document or interact with its scenes.

## Configuration in this helper

- Hosted origin: `https://navaneetsharma22.github.io`
- Web Application OAuth client:
  `512586348088-scbsk1l4mfuvr524n0g88h9n1ovj6apg.apps.googleusercontent.com`
- Picker App ID / Cloud project number: `512586348088`
- Requested scope: `https://www.googleapis.com/auth/drive.file`
- Google Identity Services uses the browser popup token flow with
  `prompt: 'select_account consent'` and `include_granted_scopes: false`. No
  redirect URI or client secret is used.
- The default Picker view is limited to one selectable
  `application/vnd.google-apps.vid` file. The explicitly labeled **Browse all
  file types (diagnostic)** option omits both Picker MIME filters to compare
  inventory visibility. It still allows one selection and never passes unless
  Drive metadata confirms the selected file is a Vids document.
- Metadata request: Drive API `files.get`, requesting
  `id,mimeType,capabilities(canDownload),resourceKey`.
- **Prepare MP4 Download** is enabled only after verified Vids MIME metadata,
  `canDownload=true`, a supplied matching expected ID, and explicit
  acknowledgement that the whole document contains only the intended clip.
  This is user attestation; scene isolation is not verified by this page.
- MP4 preparation uses Drive `files.download` with `mimeType=video/mp4`, then
  polls the returned operation with `operations.get`. A timeout can continue
  only polling that operation. The final URI is validated and fetched without
  forwarding the bearer token. Browser CORS or transport restrictions may
  prevent receiving bytes; the page does not bypass them.
- Results distinguish operation ready, bytes received, browser save initiated,
  and saved-file completion. A webpage cannot verify browser save completion.

The API key is intentionally absent from these files. Enter the user's
restricted key into the page at run time. It is used only in memory as the
Google Picker developer key. The access token is held in page memory and sent
only to Google Picker and the Google Drive API over HTTPS. It is retained after
metadata verification only for explicit MP4 preparation and operation polling,
then cleared on completion or reset. The returned URI and bytes remain in page
memory; the URI is never displayed or logged. Drive requests use the OAuth
bearer header and do not send the API key. The page does not persist either
value, place the token in a URL, or log it. The only extension handoff sends
the validated prepared URI and bounded metadata/attestation fields after the
dashboard explicitly arms the exact expected document. The token, API key, and
resource-key value are never sent.

## Explicit extension download handoff

The extension manifest allows external messaging from the hosted site's
origin. Its worker additionally accepts only the exact helper HTTPS pathname,
top frame, and tab that was selected when the dashboard arm was created. The
dashboard must explicitly arm one canonical document ID; the in-memory nonce
expires after 120 seconds and can be consumed only once. Extension restart,
expiry, malformed input, or an uncertain send does not retry a download.

The helper's **Send Prepared MP4 to Extension** button is enabled only for the
already verified expected Vids file, `canDownload=true`, a validated prepared
URI with no resource key, and the existing whole-document attestation. The
worker checks the same conditions again, calls `chrome.downloads.download`
once, uses a stable filename with collision uniquification, and reports the
returned download's status by its exact ID. Browser completion does not verify
resolution or clip content. One v1 handoff has user-reported live status
`LIVE_VERIFIED`; repeatability for another document remains unverified.
Chrome's Downloads API itself records its normal browser-managed source URL
metadata; the extension does not separately log, display, or persist the URI.

## Confirmed pending review continuation

For the explicitly supported single-scene recovery, the dashboard action is
run-bound to an existing confirmed Vids review and asks the user to attest that
Vids visibly shows saved. That readiness is recorded as `user_attested`, not
machine verified. The worker rechecks the exact document, result fingerprint,
candidate scene, sole-scene inventory, and durations before it returns a fresh
nonce challenge. Use the helper's **Prepare MP4 for confirmed review and send
once** button; it obtains that challenge before starting a new `files.download`
operation, then sends the freshly prepared URI once. A URI from the earlier
standalone preparation or a previous independent download cannot settle the
review. If status is unresolved, do not retry. Only Chrome's exact linked
download ID reaching `complete` records `completed_via_hosted_transport` and
releases the active review. This does not verify resolution or media content.
The continuation does not insert/replace/delete scenes or automate Vids File
menus.

## Publish manually to the existing GitHub Pages repository

The repository was not present as a local directory in the Automat Faceless
workspace. The prepared files are in this workspace at
`hosted-picker-proof/`.

1. Open the supplied repository:
   <https://github.com/navaneetsharma22/automat-faceless-picker>.
2. Use the repository's configured GitHub Pages publishing branch and source
   directory. Re-upload the changed helper files from this workspace,
   preserving names and placing `index.html` at its root: `index.html`,
   `app.js`, `logic.js`, and `README.md`. `styles.css` is unchanged.
3. Review the file list in GitHub, then create a commit on that repository's
   configured Pages source branch. Do not upload any extension build output or
   credentials. The API key is not among these files.
4. After GitHub Pages finishes publishing, open
   <https://navaneetsharma22.github.io/automat-faceless-picker/> and verify the
   page loads over HTTPS. No publish or deployment was performed as part of
   this patch.

The configured OAuth authorized JavaScript origin is the site origin
`https://navaneetsharma22.github.io` (no repository path). Keep the API key's
website restrictions at `https://navaneetsharma22.github.io/*` and
`https://docs.google.com/*` for the Picker iframe, with its API restriction set
to Google Picker API. Do not alter the existing Chrome Extension OAuth client
or extension CSP.

## Manual proof procedure

1. Open the hosted page in a normal browser tab. Enter the locally held API
   key and, optionally, the expected Vids URL or document ID.
2. Select **Browse all file types (diagnostic)** for the controlled inventory
   comparison, then click **Connect / Select Vids Document** once. In Google's
   account chooser, select the account intended to open the document; do not
   assume it is the account used by Chrome Identity in the extension.
3. Grant only the requested `drive.file` permission. The page verifies that GIS
   reports this scope before opening Picker.
4. Look for the expected Vids document. If it is present, select only that
   document. The page calls Drive `files.get` using the same in-memory token
   returned to this page by GIS. It reports the MIME type, `canDownload`, and
   expected-ID agreement; a non-Vids file cannot produce a successful Vids
   proof. The page does not list or log other files or raw Picker payloads.
5. Record only the bounded result rows: authorization, selection/metadata
   status, selected file ID, MIME type, `canDownload`, and expected-document
   match. Do not copy or share the API key or token.
6. For the separate MP4 proof, require `canDownload: Yes` and expected-document
   `Match`. Acknowledge that the entire selected document contains only the
   intended clip, then click **Prepare MP4 Download** once. If polling times
   out, use **Continue checking operation**; it polls the same operation and
   never starts a second download request. When ready, click **Receive MP4
   bytes**. If CORS or transport blocks access, record that outcome without a
   proxy or token forwarding. If bytes arrive, **Save MP4** initiates a browser
   save; this page cannot verify that the saved file completed.
7. For a second independent-file handoff, use a second dedicated Vids document
   whose canonical ID differs from v1 and whose contents are only the second
   intended clip. Keep exactly one hosted helper tab open. In the helper,
   perform its normal account authorization, Vids selection, metadata check,
   whole-document attestation, and one MP4 preparation until the page reports
   `MP4 ready` with `resource_key_present: No`. In the dashboard enter that
   exact second document ID and click **Arm one hosted MP4 download** once.
   Then click **Send Prepared MP4 to Extension** once. Record the helper's
   fixed status and Chrome's exact download item. Confirm the new item is
   distinct and does not replace v1; if the result is `unresolved`, do not
   retry. Inspect the second saved file separately if playback or fidelity is
   being evaluated. This is a whole-document download only; it does not
   insert, delete, export through Vids UI, settle old pending operations, or
   prove scene isolation. A second dedicated document does not test automatic
   scene replacement or consecutive exports within one document.

The user has supplied live metadata evidence for v1 from diagnostic mode:
same-token metadata reported MIME `application/vnd.google-apps.vid`,
`canDownload: true`, and expected-ID `Match`. Vids-only mode previously showed
no documents; the root cause is unknown. The hosted navigation download and
one hosted-to-extension handoff for v1 are user-reported `LIVE_VERIFIED`.
Chrome reported the extension item `Done` at 7.5 MB. Playback and properties
have not been checked for that extension-downloaded file.

Authorization, one-item selection, metadata, Drive preparation, hosted
navigation save, and one explicit extension handoff are user-reported live
evidence for v1. The next independent-file test requires a second dedicated
Vids document with a different canonical ID and only the second intended clip;
run the same one-shot hosted handoff for that exact ID and confirm Chrome
creates a distinct item without replacing v1. This does not test automatic
scene replacement or consecutive exports in one document. Those remain
separate Phase 4 criteria and Vids UI export experiments are paused. The hosted
OAuth account and prepared URI remain separate from Chrome Identity; no account
or file-grant continuity is assumed.

## Official API references

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [GIS JavaScript API reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Google Picker web integration](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Picker `setMaxItems`](https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder.setmaxitems)
- [Picker MIME filtering](https://developers.google.com/workspace/drive/picker/reference/picker.view.setmimetypes)
- [Drive `files.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)
- [Drive download and export guide](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive long-running operations](https://developers.google.com/workspace/drive/api/guides/long-running-operations)
- [Drive `files.download`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/download)
- [Google Vids MIME type](https://developers.google.com/workspace/drive/api/guides/mime-types)
- [Using API keys in REST requests](https://docs.cloud.google.com/docs/authentication/api-keys-use)
- [Chrome external messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#external)
- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
