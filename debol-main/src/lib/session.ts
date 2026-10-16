const KEY_PREFIX = 'kidsstore.';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(KEY_PREFIX + key);
    else window.localStorage.setItem(KEY_PREFIX + key, value);
  } catch {
    /* private mode: the cart still works for this page view */
  }
}

/** The cart key is not a secret but it is the only handle a guest has on their cart. */
export function cartKey(): string | null {
  return read('cartKey');
}

export function rememberCartKey(key: string | null) {
  if (key) write('cartKey', key);
}

export function customerToken(): string | null {
  return read('customerToken');
}

export function rememberCustomerToken(token: string | null) {
  write('customerToken', token);
}

export function adminToken(): string | null {
  return read('adminToken');
}

export function rememberAdminToken(token: string | null) {
  write('adminToken', token);
}


