# Automat Faceless Hosted Picker Proof

This standalone static page checks whether a separately authorized web app can
select one existing Google Vids document and read its Drive metadata. It does
not download content, connect to the extension, or modify a Vids document.

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
- Metadata request: Drive API `files.get`, requesting only
  `id,mimeType,capabilities(canDownload)`.

The API key is intentionally absent from these files. Enter the user's
restricted key into the page at run time. It is used only in memory as the
Google Picker developer key. The access token is held in page memory and sent
only to Google Picker and the Google Drive API over HTTPS. The Drive
`files.get` request uses the OAuth bearer header and does not send the API key.
The page does not persist either value, place the token in a URL, log it, or
send anything to the extension.

## Publish manually to the existing GitHub Pages repository

The repository was not present as a local directory in the Automat Faceless
workspace. The prepared files are in this workspace at
`hosted-picker-proof/`.

1. Open the supplied repository:
   <https://github.com/navaneetsharma22/automat-faceless-picker>.
2. Use the repository's configured GitHub Pages publishing branch and source
   directory. Upload these five files from this helper directory into that
   source directory, preserving these names and placing `index.html` at its
   root: `index.html`, `styles.css`, `app.js`, `logic.js`, and `README.md`.
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

The next live test is authorization, one Vids selection, and this metadata
check only. A successful result proves selected-file metadata access for this
web OAuth client and account. It does not prove extension-client grant
continuity or MP4 download feasibility.

## Official API references

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [GIS JavaScript API reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Google Picker web integration](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Picker `setMaxItems`](https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder.setmaxitems)
- [Picker MIME filtering](https://developers.google.com/workspace/drive/picker/reference/picker.view.setmimetypes)
- [Drive `files.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)
- [Google Vids MIME type](https://developers.google.com/workspace/drive/api/guides/mime-types)
- [Using API keys in REST requests](https://docs.cloud.google.com/docs/authentication/api-keys-use)
