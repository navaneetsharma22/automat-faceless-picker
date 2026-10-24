/* global AbortController, console, document, fetch, URL, window */

import {
  classifyDriveApiFailure,
  classifyDownloadHttpFailure,
  classifyDriveDownloadFailure,
  createMp4PreparationFlow,
  createPickerCallbackLifecycle,
  DRIVE_FILE_SCOPE,
  buildFilesDownloadUrl,
  buildOperationGetUrl,
  evaluateMp4BytesResponse,
  evaluateVidsMetadata,
  getPickerViewConfiguration,
  hasRequestedScope,
  PICKER_MODE_ALL_TYPES_DIAGNOSTIC,
  PICKER_MODE_VIDS_ONLY,
  parseExpectedDocumentId,
  validateGoogleDownloadUri,
} from './logic.js';

const WEB_OAUTH_CLIENT_ID =
  '512586348088-scbsk1l4mfuvr524n0g88h9n1ovj6apg.apps.googleusercontent.com';
const CLOUD_PROJECT_NUMBER = '512586348088';
const PICKER_LOAD_TIMEOUT_MS = 15000;
const METADATA_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const METADATA_FIELDS = 'id,mimeType,capabilities(canDownload),resourceKey';
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
let selectedProof;
let preparationFlow;
let downloadUriInMemory;
let downloadBlobInMemory;
let preparationBusy = false;
let preparationAttempted = false;
let saveAttempted = false;
let objectUrlInMemory;
let proofEpoch = 0;
const activeRequestControllers = new Set();

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

const mp4Messages = {
  starting: 'MP4 preparation requested once',
  polling: 'Waiting for Drive rendering',
  ready: 'MP4 ready',
  timeout: 'Polling timed out; continue checking the same operation',
  already_started: 'Preparation was already requested; no second request was sent',
  authorization_expired: 'Authorization expired; reset and reconnect before a new proof',
  rate_limited: 'Drive rate limit reached; continue checking later',
  access_denied: 'Drive denied the MP4 operation',
  operation_failed: 'Drive MP4 operation failed',
  transport_uncertain: 'Preparation transport failed; outcome is uncertain; reset before retrying',
  transport_unavailable: 'Operation check transport failed',
  api_unavailable: 'Drive API unavailable',
  api_request_rejected: 'Drive rejected the MP4 request',
  selected_file_unavailable: 'Selected document unavailable',
  invalid_operation: 'Drive returned an invalid operation',
  invalid_download_uri: 'Drive returned an unusable download destination',
  no_operation: 'No operation is available',
  already_polling: 'Operation check already in progress',
  preparing: 'Preparing MP4',
  bytes_received: 'MP4 bytes received',
  cors_transport: 'Bytes not received; browser CORS or transport blocked access',
  unexpected_content_type: 'Received content was not video/mp4',
  empty_response: 'No MP4 bytes received',
  save_initiated: 'Browser save initiated; completion is not observable here',
};

function setMp4Status(state, category) {
  setText(
    '#mp4-operation-status',
    mp4Messages[category] || mp4Messages[state] || 'MP4 proof unavailable',
  );
}

function updatePrepareEligibility() {
  const ack = document.querySelector('#ack-only-intended-clip')?.checked === true;
  const expected = parseExpectedDocumentId(expectedInput.value);
  const eligible = Boolean(
    !busy &&
    !preparationBusy &&
    !preparationAttempted &&
    accessTokenInMemory &&
    selectedProof?.status === 'verified' &&
    selectedProof.canDownload === true &&
    selectedProof.expectedMatch === true &&
    expected.supplied &&
    expected.valid &&
    expected.fileId === selectedProof.fileId &&
    ack,
  );
  document.querySelector('#prepare-mp4').disabled = !eligible;
}

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
    const result = await verifySelectedFile(fileId, expectedFileId);
    if (result?.status === 'verified' && result.canDownload && result.expectedMatch === true) {
      selectedProof = { ...result, fileId };
      setAuthorizationStatus(
        'Authorized selected account for drive.file; token held in page memory for the explicit MP4 action',
      );
    } else {
      accessTokenInMemory = '';
      selectedProof = undefined;
    }
  } catch {
    setSelectionStatus('picker_error');
  } finally {
    closePickerAfterSelection();
    updatePrepareEligibility();
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
        ...(selectedProof?.resourceKey
          ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${selectedProof.resourceKey}` }
          : {}),
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
      return undefined;
    }

    const metadata = await response.json();
    const result = evaluateVidsMetadata(metadata, fileId, expectedFileId);
    if (!result.valid) {
      setSelectionStatus('metadata_failed');
      return undefined;
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
    return result;
  } catch (error) {
    setSelectionStatus(error?.name === 'AbortError' ? 'metadata_timeout' : 'network_error');
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function driveJsonRequest(url, method, token, resourceKey) {
  if (url.origin !== 'https://www.googleapis.com')
    return { ok: false, category: 'api_request_rejected' };
  const controller = new AbortController();
  activeRequestControllers.add(controller);
  const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(resourceKey && method === 'POST'
          ? { 'X-Goog-Drive-Resource-Keys': `${selectedProof.fileId}/${resourceKey}` }
          : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      let errorBody;
      if (response.status === 403) {
        try {
          errorBody = await response.json();
        } catch {
          /* fixed status category below */
        }
      }
      return { ok: false, category: classifyDriveDownloadFailure(response.status, errorBody) };
    }
    return { ok: true, operation: await response.json() };
  } catch (error) {
    return {
      ok: false,
      category: error?.name === 'AbortError' ? 'transport_unavailable' : 'transport_unavailable',
    };
  } finally {
    window.clearTimeout(timeout);
    activeRequestControllers.delete(controller);
  }
}

function createPreparationFlow() {
  return createMp4PreparationFlow({
    startDownload: (fileId) =>
      driveJsonRequest(
        buildFilesDownloadUrl(fileId),
        'POST',
        accessTokenInMemory,
        selectedProof?.resourceKey,
      ),
    pollOperation: (operationName) =>
      driveJsonRequest(
        buildOperationGetUrl(operationName),
        'GET',
        accessTokenInMemory,
        selectedProof?.resourceKey,
      ),
    onState: (state, category) => setMp4Status(state, category),
  });
}

async function prepareMp4() {
  updatePrepareEligibility();
  if (document.querySelector('#prepare-mp4').disabled || preparationBusy) return;
  preparationBusy = true;
  preparationAttempted = true;
  preparationFlow = createPreparationFlow();
  const requestEpoch = proofEpoch;
  document.querySelector('#prepare-mp4').disabled = true;
  try {
    const outcome = await preparationFlow.prepare(selectedProof.fileId);
    if (requestEpoch === proofEpoch) handlePreparationOutcome(outcome);
  } finally {
    preparationBusy = false;
    updatePrepareEligibility();
  }
}

function handlePreparationOutcome(outcome) {
  if (outcome.state === 'ready') {
    downloadUriInMemory = outcome.downloadUri;
    accessTokenInMemory = '';
    setAuthorizationStatus('Operation complete; authorization token cleared');
    setMp4Status('ready');
    const button = document.querySelector('#receive-mp4-bytes');
    button.hidden = false;
    button.disabled = false;
  } else if (outcome.state === 'timeout') {
    const button = document.querySelector('#continue-operation');
    button.hidden = false;
    button.disabled = false;
    setMp4Status('timeout');
  } else if (outcome.state === 'error') {
    if (outcome.category !== 'transport_unavailable') {
      accessTokenInMemory = '';
      setAuthorizationStatus(
        outcome.category === 'authorization_expired'
          ? 'Authorization expired; token cleared'
          : 'MP4 operation ended; authorization token cleared',
      );
    }
    if (outcome.category === 'transport_unavailable' && preparationFlow?.operationName) {
      const button = document.querySelector('#continue-operation');
      button.hidden = false;
      button.disabled = false;
    }
    setMp4Status('failed', outcome.category);
  } else {
    setMp4Status(outcome.state, outcome.category);
  }
}

async function continueOperationCheck() {
  if (!preparationFlow || preparationBusy) return;
  preparationBusy = true;
  const requestEpoch = proofEpoch;
  document.querySelector('#continue-operation').disabled = true;
  try {
    const outcome = await preparationFlow.continuePolling();
    if (requestEpoch === proofEpoch) handlePreparationOutcome(outcome);
  } finally {
    preparationBusy = false;
    document.querySelector('#continue-operation').disabled = false;
  }
}

async function receiveMp4Bytes() {
  const uri = downloadUriInMemory;
  const destination = uri ? validateGoogleDownloadUri(uri.href) : undefined;
  if (!destination || destination.protocol !== 'https:' || !downloadUriInMemory) return;
  const controller = new AbortController();
  activeRequestControllers.add(controller);
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  const button = document.querySelector('#receive-mp4-bytes');
  button.disabled = true;
  try {
    const response = await fetch(destination, {
      method: 'GET',
      headers: selectedProof?.resourceKey
        ? { 'X-Goog-Drive-Resource-Keys': `${selectedProof.fileId}/${selectedProof.resourceKey}` }
        : {},
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      setMp4Status('failed', classifyDownloadHttpFailure(response.status));
      if (response.status === 401) downloadUriInMemory = undefined;
      return;
    }
    const blob = await response.blob();
    const result = evaluateMp4BytesResponse(response, blob);
    if (result.state !== 'received') {
      setMp4Status('failed', result.category);
      return;
    }
    downloadBlobInMemory = blob;
    downloadUriInMemory = undefined;
    setText(
      '#bytes-received-status',
      `Yes (${result.byteCount} bytes; ${blob.type || 'video/mp4'})`,
    );
    setMp4Status('bytes_received');
    const saveButton = document.querySelector('#save-mp4');
    saveButton.hidden = false;
    saveButton.disabled = false;
  } catch {
    setMp4Status('failed', 'cors_transport');
  } finally {
    window.clearTimeout(timeout);
    activeRequestControllers.delete(controller);
    button.disabled = false;
  }
}

function saveMp4() {
  if (!downloadBlobInMemory || saveAttempted) return;
  saveAttempted = true;
  document.querySelector('#save-mp4').disabled = true;
  objectUrlInMemory = URL.createObjectURL(downloadBlobInMemory);
  const anchor = document.createElement('a');
  anchor.href = objectUrlInMemory;
  anchor.download = 'selected-vids.mp4';
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setText('#browser-save-status', mp4Messages.save_initiated);
  setText('#saved-file-status', 'Not verifiable by this webpage');
  window.setTimeout(() => {
    if (objectUrlInMemory) URL.revokeObjectURL(objectUrlInMemory);
    objectUrlInMemory = undefined;
  }, 60000);
}

function resetProof() {
  proofEpoch += 1;
  preparationFlow?.cancel();
  for (const controller of activeRequestControllers) controller.abort();
  activeRequestControllers.clear();
  cleanUpSecrets();
  selectedProof = undefined;
  preparationFlow = undefined;
  downloadUriInMemory = undefined;
  downloadBlobInMemory = undefined;
  preparationBusy = false;
  preparationAttempted = false;
  saveAttempted = false;
  if (objectUrlInMemory) URL.revokeObjectURL(objectUrlInMemory);
  objectUrlInMemory = undefined;
  document.querySelector('#ack-only-intended-clip').checked = false;
  for (const selector of ['#continue-operation', '#receive-mp4-bytes', '#save-mp4']) {
    const button = document.querySelector(selector);
    button.hidden = true;
    button.disabled = true;
  }
  setText('#mp4-operation-status', 'Not prepared');
  setText('#bytes-received-status', 'No');
  setText('#browser-save-status', 'Not initiated');
  setText('#saved-file-status', 'Not verifiable by this webpage');
  updatePrepareEligibility();
}

function closePickerAfterSelection() {
  apiKeyInMemory = '';
  try {
    pickerInstance?.dispose();
  } catch {
    /* already disposed */
  }
  pickerInstance = undefined;
  setBusy(false);
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
  resetProof();

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

document
  .querySelector('#ack-only-intended-clip')
  ?.addEventListener('change', updatePrepareEligibility);
expectedInput.addEventListener('input', updatePrepareEligibility);
document.querySelector('#prepare-mp4').addEventListener('click', () => {
  void prepareMp4();
});
document.querySelector('#continue-operation').addEventListener('click', () => {
  void continueOperationCheck();
});
document.querySelector('#receive-mp4-bytes').addEventListener('click', () => {
  void receiveMp4Bytes();
});
document.querySelector('#save-mp4').addEventListener('click', saveMp4);
document.querySelector('#reset-proof').addEventListener('click', resetProof);
