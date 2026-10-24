/* global AbortController, console, document, fetch, URL, window */

import {
  classifyDriveApiFailure,
  createPickerCallbackLifecycle,
  DRIVE_FILE_SCOPE,
  evaluateVidsMetadata,
  getPickerViewConfiguration,
  hasRequestedScope,
  PICKER_MODE_ALL_TYPES_DIAGNOSTIC,
  PICKER_MODE_VIDS_ONLY,
  parseExpectedDocumentId,
} from './logic.js';

const WEB_OAUTH_CLIENT_ID =
  '512586348088-scbsk1l4mfuvr524n0g88h9n1ovj6apg.apps.googleusercontent.com';
const CLOUD_PROJECT_NUMBER = '512586348088';
const PICKER_LOAD_TIMEOUT_MS = 15000;
const METADATA_TIMEOUT_MS = 20000;
const METADATA_FIELDS = 'id,mimeType,capabilities(canDownload)';
const MAX_PICKER_CALLBACK_DIAGNOSTICS = 16;
const PICKER_CALLBACK_CATEGORIES = new Set([
  'picked',
  'cancel',
  'error',
  'nonterminal',
  'missing_action',
]);

const form = document.querySelector('#proof-form');
const apiKeyInput = document.querySelector('#api-key');
const expectedInput = document.querySelector('#expected-document');
const startButton = document.querySelector('#start-proof');
let accessTokenInMemory = '';
let apiKeyInMemory = '';
let pickerApiReady = false;
let gisReady = false;
let pickerInstance;
let busy = false;
let pickerApiLoadPromise;
let pickerCallbackDiagnosticCount = 0;

const fixedSelectionLabels = {
  idle: 'Not started',
  waiting: 'Waiting for Google Picker',
  cancelled: 'Selection cancelled',
  popup_failed: 'Authorization popup could not open',
  popup_closed: 'Authorization popup was closed',
  authorization_failed: 'Authorization denied or failed',
  scope_missing: 'Requested drive.file scope was not verified',
  picked: 'One file selected; checking metadata',
  verified: 'Verified Google Vids metadata',
  wrong_type: 'Selected file is not a Google Vids document',
  mismatch: 'Selected file does not match the expected document',
  multiple: 'Picker returned an unexpected selection count',
  picker_error: 'Google Picker could not complete the selection',
  picker_unavailable: 'Google Picker service did not load',
  api_denied: 'Drive API or file access was denied',
  auth_expired: 'Authorization expired; reconnect and select again',
  file_unavailable: 'Selected file is unavailable to this account',
  request_rejected: 'Drive API rejected the metadata request',
  rate_limited: 'Drive API rate limit reached',
  api_unavailable: 'Google Drive API is temporarily unavailable',
  network_error: 'Metadata request failed; check the network and API setup',
  metadata_timeout: 'Drive metadata request timed out',
  metadata_failed: 'File metadata could not be verified',
  invalid_expected: 'Expected Vids URL or document ID is invalid',
};

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setAuthorizationStatus(value) {
  setText('#authorization-status', value);
}

function setSelectionStatus(key) {
  setText('#selection-status', fixedSelectionLabels[key] || fixedSelectionLabels.metadata_failed);
}

function resetResults(expectedWasSupplied) {
  setAuthorizationStatus('Authorizing selected account');
  setSelectionStatus('waiting');
  setText('#selected-file-id', '—');
  setText('#mime-type', '—');
  setText('#can-download', '—');
  setText('#expected-match', expectedWasSupplied ? 'Not checked' : 'Not supplied');
}

function setBusy(value) {
  busy = value;
  startButton.disabled = value || !gisReady || !pickerApiReady;
  startButton.textContent = value
    ? 'Authorization and selection in progress…'
    : 'Connect / Select Vids Document';
}

function loadPickerApi() {
  if (pickerApiLoadPromise) return pickerApiLoadPromise;
  pickerApiLoadPromise = new Promise((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error('picker_unavailable'));
      return;
    }
    const timeout = window.setTimeout(
      () => reject(new Error('picker_unavailable')),
      PICKER_LOAD_TIMEOUT_MS,
    );
    try {
      window.gapi.load('picker', {
        callback: () => {
          window.clearTimeout(timeout);
          if (window.google?.picker?.PickerBuilder) resolve();
          else reject(new Error('picker_unavailable'));
        },
        onerror: () => {
          window.clearTimeout(timeout);
          reject(new Error('picker_unavailable'));
        },
        ontimeout: () => {
          window.clearTimeout(timeout);
          reject(new Error('picker_unavailable'));
        },
        timeout: PICKER_LOAD_TIMEOUT_MS,
      });
    } catch {
      window.clearTimeout(timeout);
      reject(new Error('picker_unavailable'));
    }
  });
  return pickerApiLoadPromise;
}

function requestAccessTokenFromUserGesture() {
  return new Promise((resolve) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: WEB_OAUTH_CLIENT_ID,
        scope: DRIVE_FILE_SCOPE,
        include_granted_scopes: false,
        prompt: 'select_account consent',
        callback: (response) => resolve({ kind: 'response', response }),
        error_callback: (error) => {
          const errorType = error?.type;
          if (errorType === 'popup_failed_to_open') resolve({ kind: 'popup_failed' });
          else if (errorType === 'popup_closed') resolve({ kind: 'popup_closed' });
          else resolve({ kind: 'authorization_failed' });
        },
      });
      tokenClient.requestAccessToken({
        prompt: 'select_account consent',
        include_granted_scopes: false,
      });
    } catch {
      resolve({ kind: 'popup_failed' });
    }
  });
}

function recordPickerCallbackCategory(category) {
  if (
    pickerCallbackDiagnosticCount >= MAX_PICKER_CALLBACK_DIAGNOSTICS ||
    !PICKER_CALLBACK_CATEGORIES.has(category)
  ) {
    return;
  }
  pickerCallbackDiagnosticCount += 1;
  console.info('picker_callback', category);
}

async function processPickedFile(data, expectedFileId) {
  try {
    const picker = window.google?.picker;
    const documentsKey = picker?.Response?.DOCUMENTS;
    const docs = documentsKey === undefined ? undefined : data?.[documentsKey];
    if (!Array.isArray(docs) || docs.length !== 1) {
      setSelectionStatus('multiple');
      return;
    }
    const fileIdKey = picker?.Document?.ID;
    const fileId = fileIdKey === undefined ? undefined : docs[0]?.[fileIdKey];
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) {
      setSelectionStatus('picker_error');
      return;
    }

    setText('#selected-file-id', fileId);
    setSelectionStatus('picked');
    await verifySelectedFile(fileId, expectedFileId);
  } catch {
    setSelectionStatus('picker_error');
  } finally {
    cleanUpSecrets();
  }
}

function showPicker(expectedFileId, mode) {
  if (!pickerApiReady || !window.google?.picker) {
    throw new Error('picker_unavailable');
  }

  const picker = window.google.picker;
  const configuration = getPickerViewConfiguration(mode);
  const view = new picker.DocsView(picker.ViewId.DOCS);
  if (configuration.mimeTypes) view.setMimeTypes(configuration.mimeTypes);
  view.setMode(picker.DocsViewMode.LIST);
  const callbackLifecycle = createPickerCallbackLifecycle({
    actions: {
      picked: picker.Action?.PICKED,
      cancel: picker.Action?.CANCEL,
      error: picker.Action?.ERROR,
    },
    onCategory: recordPickerCallbackCategory,
    onCancel: () => {
      setSelectionStatus('cancelled');
      cleanUpSecrets();
    },
    onError: () => {
      setSelectionStatus('picker_error');
      cleanUpSecrets();
    },
    onPicked: (data) => {
      void processPickedFile(data, expectedFileId);
    },
  });
  const pickerBuilder = new picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessTokenInMemory)
    .setDeveloperKey(apiKeyInMemory)
    .setAppId(CLOUD_PROJECT_NUMBER)
    .setOrigin(window.location.origin)
    .setMaxItems(configuration.maxItems)
    .setCallback((data) => {
      const actionKey = picker.Response?.ACTION;
      const action =
        actionKey === undefined || data === null || typeof data !== 'object'
          ? undefined
          : data[actionKey];
      callbackLifecycle(action, data);
    });
  if (configuration.selectableMimeTypes) {
    pickerBuilder.setSelectableMimeTypes(configuration.selectableMimeTypes);
  }
  pickerInstance = pickerBuilder.build();
  pickerInstance.setVisible(true);
}

async function verifySelectedFile(fileId, expectedFileId) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', METADATA_FIELDS);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessTokenInMemory}`,
      },
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    });

    if (!response.ok) {
      const failure = classifyDriveApiFailure(response.status);
      if (failure === 'authorization_expired') {
        accessTokenInMemory = '';
        setAuthorizationStatus('Authorization expired or was rejected');
        setSelectionStatus('auth_expired');
      } else if (failure === 'api_or_file_access_denied') {
        setSelectionStatus('api_denied');
      } else if (failure === 'selected_file_unavailable') {
        setSelectionStatus('file_unavailable');
      } else if (failure === 'api_request_rejected') {
        setSelectionStatus('request_rejected');
      } else if (failure === 'rate_limited') {
        setSelectionStatus('rate_limited');
      } else if (failure === 'google_api_unavailable') {
        setSelectionStatus('api_unavailable');
      } else {
        setSelectionStatus('metadata_failed');
      }
      return;
    }

    const metadata = await response.json();
    const result = evaluateVidsMetadata(metadata, fileId, expectedFileId);
    if (!result.valid) {
      setSelectionStatus('metadata_failed');
      return;
    }

    setText('#mime-type', result.mimeType.slice(0, 128));
    setText('#can-download', result.canDownload ? 'Yes' : 'No');
    setText(
      '#expected-match',
      result.expectedMatch === undefined
        ? 'Not supplied'
        : result.expectedMatch
          ? 'Match'
          : 'Mismatch',
    );
    setSelectionStatus(result.status);
  } catch (error) {
    setSelectionStatus(error?.name === 'AbortError' ? 'metadata_timeout' : 'network_error');
  } finally {
    window.clearTimeout(timeout);
  }
}

function cleanUpSecrets() {
  accessTokenInMemory = '';
  apiKeyInMemory = '';
  try {
    pickerInstance?.dispose();
  } catch {
    // The picker may already have disposed itself after cancellation.
  }
  pickerInstance = undefined;
  setBusy(false);
}

async function startProof(event) {
  event.preventDefault();
  if (busy) return;

  const apiKey = apiKeyInput.value.trim();
  const expected = parseExpectedDocumentId(expectedInput.value);
  if (!expected.valid) {
    resetResults(expected.supplied);
    setAuthorizationStatus('Not started');
    setSelectionStatus('invalid_expected');
    return;
  }
  if (!apiKey || !gisReady || !pickerApiReady) {
    setAuthorizationStatus('Not started');
    setSelectionStatus(!pickerApiReady ? 'picker_unavailable' : 'metadata_failed');
    return;
  }

  resetResults(expected.supplied);
  const selectedMode = form.querySelector('input[name="picker-mode"]:checked')?.value;
  const mode =
    selectedMode === PICKER_MODE_ALL_TYPES_DIAGNOSTIC ? selectedMode : PICKER_MODE_VIDS_ONLY;
  apiKeyInMemory = apiKey;
  apiKeyInput.value = '';
  setBusy(true);

  // Start the GIS popup before awaiting other work so this remains tied to the user's click.
  const tokenPromise = requestAccessTokenFromUserGesture();
  const tokenResult = await tokenPromise;

  if (tokenResult.kind === 'popup_failed') {
    setAuthorizationStatus('Authorization popup could not open');
    setSelectionStatus('popup_failed');
    cleanUpSecrets();
    return;
  }
  if (tokenResult.kind === 'popup_closed') {
    setAuthorizationStatus('Authorization popup was closed');
    setSelectionStatus('popup_closed');
    cleanUpSecrets();
    return;
  }
  if (tokenResult.kind !== 'response' || tokenResult.response?.error) {
    setAuthorizationStatus('Authorization denied or failed');
    setSelectionStatus('authorization_failed');
    cleanUpSecrets();
    return;
  }

  const tokenResponse = tokenResult.response;
  const oauthApi = window.google.accounts.oauth2;
  if (!hasRequestedScope(tokenResponse, oauthApi)) {
    setAuthorizationStatus('Requested drive.file scope was not verified');
    setSelectionStatus('scope_missing');
    cleanUpSecrets();
    return;
  }

  accessTokenInMemory = tokenResponse.access_token;
  setAuthorizationStatus('Authorized selected account for drive.file');
  setSelectionStatus('waiting');

  try {
    await loadPickerApi();
    showPicker(expected.fileId, mode);
  } catch {
    setSelectionStatus('picker_unavailable');
    cleanUpSecrets();
    return;
  }
}

form.addEventListener('submit', (event) => {
  void startProof(event);
});

window.addEventListener('load', () => {
  gisReady = Boolean(window.google?.accounts?.oauth2?.initTokenClient);
  if (!gisReady) {
    setAuthorizationStatus('Google Identity Services did not load');
  }
  loadPickerApi()
    .then(() => {
      pickerApiReady = true;
      setBusy(false);
    })
    .catch(() => {
      pickerApiReady = false;
      setSelectionStatus('picker_unavailable');
    });
  startButton.disabled = !(gisReady && pickerApiReady);
  startButton.textContent = 'Connect / Select Vids Document';
});

document
  .querySelector('script[src="https://accounts.google.com/gsi/client"]')
  ?.addEventListener('error', () => {
    gisReady = false;
    startButton.disabled = true;
    setAuthorizationStatus('Google Identity Services did not load');
  });

document
  .querySelector('script[src="https://apis.google.com/js/api.js"]')
  ?.addEventListener('error', () => {
    pickerApiReady = false;
    startButton.disabled = true;
    setSelectionStatus('picker_unavailable');
  });
