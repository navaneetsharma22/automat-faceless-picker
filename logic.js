/* global URL */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const VIDS_MIME_TYPE = 'application/vnd.google-apps.vid';

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const VIDS_URL_HOSTS = new Set(['docs.google.com', 'vids.google.com']);
const PICKER_CALLBACK_CATEGORIES = new Set([
  'picked',
  'cancel',
  'error',
  'nonterminal',
  'missing_action',
]);

/**
 * Owns the Picker callback lifecycle. Once PICKED arrives, metadata verification
 * owns cleanup and later Picker callbacks cannot interrupt that operation.
 */
export function createPickerCallbackLifecycle({
  actions,
  onCategory,
  onCancel,
  onError,
  onPicked,
}) {
  let state = 'open';

  return (action, eventData) => {
    let category = 'nonterminal';
    if (action === undefined || action === null) {
      category = 'missing_action';
    } else if (actions?.cancel !== undefined && action === actions.cancel) {
      category = 'cancel';
    } else if (actions?.error !== undefined && action === actions.error) {
      category = 'error';
    } else if (actions?.picked !== undefined && action === actions.picked) {
      category = 'picked';
    }

    if (PICKER_CALLBACK_CATEGORIES.has(category)) onCategory?.(category);
    if (state !== 'open') return;

    if (category === 'cancel') {
      state = 'terminal';
      onCancel?.();
    } else if (category === 'error') {
      state = 'terminal';
      onError?.();
    } else if (category === 'picked') {
      state = 'picked';
      onPicked?.(eventData);
    }
  };
}

export function parseExpectedDocumentId(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return { supplied: false, valid: true, fileId: undefined };

  if (FILE_ID_PATTERN.test(value)) {
    return { supplied: true, valid: true, fileId: value };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !VIDS_URL_HOSTS.has(url.hostname)) {
      return { supplied: true, valid: false, fileId: undefined };
    }
    const pattern =
      url.hostname === 'docs.google.com'
        ? /^\/videos\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/i
        : /^\/(?:videos\/(?:u\/\d+\/)?d\/|d\/)([A-Za-z0-9_-]{1,200})(?:\/|$)/i;
    const match = url.pathname.match(pattern);
    return match
      ? { supplied: true, valid: true, fileId: match[1] }
      : { supplied: true, valid: false, fileId: undefined };
  } catch {
    return { supplied: true, valid: false, fileId: undefined };
  }
}

export function hasRequestedScope(tokenResponse, oauthApi) {
  return Boolean(
    tokenResponse?.access_token &&
    tokenResponse.scope &&
    oauthApi?.hasGrantedAllScopes?.(tokenResponse, DRIVE_FILE_SCOPE) &&
    tokenResponse.scope.split(/\s+/).includes(DRIVE_FILE_SCOPE),
  );
}

export function classifyDriveApiFailure(status) {
  if (status === 401) return 'authorization_expired';
  if (status === 403) return 'api_or_file_access_denied';
  if (status === 404) return 'selected_file_unavailable';
  if (status === 400) return 'api_request_rejected';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'google_api_unavailable';
  return 'metadata_request_failed';
}
