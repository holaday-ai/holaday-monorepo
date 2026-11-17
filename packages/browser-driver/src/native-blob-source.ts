export interface NativeBlobSources {
  restore(): Promise<void>;
  describe(url: string): Promise<{ sizeBytes: number; mimeType: string }>;
  read(url: string, offset: number, length: number): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

type Options = {
  owner: object;
  frameId: string;
  nodeObjectId: string;
  origin: string;
  cdp: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  current: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
};
const owners = new WeakMap<object, Set<string>>();
const MAX_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

// Capture references first; the host then verifies their actual CDP function
// descriptors, without trusting the website's Function#toString. No Blob or
// website API is changed while this snapshot is being checked.
function snapshotPlatform() {
  const descriptor = Object.getOwnPropertyDescriptor;
  return {
    api: window.URL,
    create: window.URL.createObjectURL,
    map: Map,
    mapGet: Map.prototype.get,
    mapSet: Map.prototype.set,
    mapClear: Map.prototype.clear,
    mapSize: descriptor(Map.prototype, 'size')!.get!,
    size: descriptor(Blob.prototype, 'size')!.get!,
    type: descriptor(Blob.prototype, 'type')!.get!,
    slice: Blob.prototype.slice,
    arrayBuffer: Blob.prototype.arrayBuffer,
    apply: Reflect.apply,
    descriptor,
    define: Object.defineProperty,
    now: Date.now,
    timer: setTimeout,
    clearTimer: clearTimeout,
    arrayFrom: Array.from,
    uint8: Uint8Array,
    ownerDocument: descriptor(Node.prototype, 'ownerDocument')!.get!,
    defaultView: descriptor(Document.prototype, 'defaultView')!.get!,
  };
}
type Platform = ReturnType<typeof snapshotPlatform>;

function makeStore(native: Platform, config: { maxBytes: number; captureMs: number }) {
  const apply = native.apply;
  const sources = new native.map<string, Blob>();
  const expires = native.now() + config.captureMs;
  let active = true;
  let bytes = 0;
  let installation:
    | { api: typeof URL; wrapper: unknown; descriptor: PropertyDescriptor; restored: boolean }
    | undefined;
  const clear = () => {
    active = false;
    apply(native.mapClear, sources, []);
    bytes = 0;
  };
  const lifetime = apply(native.timer, undefined, [clear, 120_000]);
  const get = (url: string) => {
    const blob = apply(native.mapGet, sources, [url]) as Blob | undefined;
    if (!blob) throw new Error('blob_source_unavailable');
    return blob;
  };
  return {
    create(blob: Blob): string {
      // Only an actual native call mints the URL associated with this object.
      const url = apply(native.create, native.api, [blob]) as string;
      try {
        if (active && native.now() <= expires && apply(native.mapSize, sources, []) < 2) {
          const count = apply(native.size, blob, []) as number;
          if (count % 1 === 0 && count >= 0 && bytes + count <= config.maxBytes) {
            apply(native.mapSet, sources, [url, blob]);
            bytes += count;
          }
        }
      } catch {
        // The native API also accepts MediaSource. Tracking must not change a
        // successful platform call or grant non-Blob sources file authority.
      }
      return url;
    },
    dispose() {
      clear();
      apply(native.clearTimer, undefined, [lifetime]);
    },
    apiForNode(node: Element) {
      const doc = apply(native.ownerDocument, node, []);
      const win = apply(native.defaultView, doc, []) as Window & typeof globalThis;
      if (win.URL !== native.api) throw new Error('blob_api_unavailable');
      return native.api;
    },
    descriptor(api: typeof URL) {
      return native.descriptor(api, 'createObjectURL');
    },
    native(fn: unknown) {
      return fn === native.create;
    },
    replace(api: typeof URL, value: unknown, descriptor: PropertyDescriptor) {
      // Store recovery data before mutating the page, so losing the installation
      // receipt cannot strand a hook whose remote result handle is unknown.
      installation = { api, wrapper: value, descriptor, restored: false };
      native.define(api, 'createObjectURL', { ...descriptor, value });
    },
    restoreInstalled(): boolean {
      active = false;
      if (!installation || installation.restored) return true;
      const { api, wrapper, descriptor } = installation;
      const current = native.descriptor(api, 'createObjectURL');
      if (
        current &&
        current.value === descriptor.value &&
        current.configurable === descriptor.configurable &&
        current.enumerable === descriptor.enumerable &&
        current.writable === descriptor.writable
      ) {
        installation.restored = true;
        return true;
      }
      if (
        !current ||
        current.value !== wrapper ||
        current.configurable !== descriptor.configurable ||
        current.enumerable !== descriptor.enumerable ||
        current.writable !== descriptor.writable
      )
        return false;
      native.define(api, 'createObjectURL', descriptor);
      installation.restored = native.descriptor(api, 'createObjectURL')?.value === descriptor.value;
      return installation.restored;
    },
    describe(url: string) {
      const blob = get(url);
      return {
        sizeBytes: apply(native.size, blob, []) as number,
        mimeType: apply(native.type, blob, []) as string,
      };
    },
    read(url: string, offset: number, length: number) {
      const blob = get(url);
      const part = apply(native.slice, blob, [offset, offset + length]) as Blob;
      // Return the original platform Promise to CDP. A JS await/then in this
      // world would let a website Promise hook substitute a different buffer.
      return apply(native.arrayBuffer, part, []) as Promise<ArrayBuffer>;
    },
    bytes(buffer: ArrayBuffer) {
      return native.arrayFrom(new native.uint8(buffer));
    },
  };
}
type Store = ReturnType<typeof makeStore>;

function install(this: Element, store: Store) {
  const api = store.apiForNode(this);
  const descriptor = store.descriptor(api);
  if (
    !descriptor ||
    !descriptor.configurable ||
    !descriptor.writable ||
    !store.native(descriptor.value)
  )
    throw new Error('blob_api_unavailable');
  const wrapper = function createObjectURL(blob: Blob) {
    return store.create(blob);
  };
  store.replace(api, wrapper, descriptor);
  return true;
}

type Remote = {
  result?: { objectId?: string; subtype?: string; value?: unknown };
  exceptionDetails?: unknown;
};
const platformNames: Record<keyof Platform, string> = {
  api: 'URL',
  create: 'createObjectURL',
  map: 'Map',
  mapGet: 'get',
  mapSet: 'set',
  mapClear: 'clear',
  mapSize: 'size',
  size: 'size',
  type: 'type',
  slice: 'slice',
  arrayBuffer: 'arrayBuffer',
  apply: 'apply',
  descriptor: 'getOwnPropertyDescriptor',
  define: 'defineProperty',
  now: 'now',
  timer: 'setTimeout',
  clearTimer: 'clearTimeout',
  arrayFrom: 'from',
  uint8: 'Uint8Array',
  ownerDocument: 'ownerDocument',
  defaultView: 'defaultView',
};
/** A temporary native-Blob reference source, not a file or task permission.
 * The caller supplies an already verified native node/frame and must bind a read
 * to the actual native download URL, owner and document. No URL is fetched. */
export async function captureNativeBlobSources(options: Options): Promise<NativeBlobSources> {
  const timeout = options.timeoutMs ?? 2000;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (
    !Number.isInteger(timeout) ||
    timeout < 50 ||
    timeout > 5000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES
  )
    throw new Error('invalid_blob_capture_budget');
  const current = () => {
    try {
      return !options.signal?.aborted && options.current() && !options.signal?.aborted;
    } catch {
      return false;
    }
  };
  if (!current()) throw new Error('scope_unavailable');
  const objectGroup = `holaday-native-blob-${crypto.randomUUID()}`;
  let frames = owners.get(options.owner);
  if (!frames) {
    frames = new Set();
    owners.set(options.owner, frames);
  }
  if (frames.has(options.frameId)) throw new Error('blob_capture_busy');
  frames.add(options.frameId);
  const unlock = () => frames!.delete(options.frameId);
  const handles: string[] = [];
  let storeId: string | undefined;
  const evaluate = async (params: Record<string, unknown>, fallback: string) => {
    const result = (await options.cdp('Runtime.callFunctionOn', {
      ...params,
      objectGroup,
    })) as Remote;
    if (result.exceptionDetails) throw new Error(fallback);
    if (!result.result) throw new Error('blob_capture_unavailable');
    return result.result;
  };
  const object = (remote: { objectId?: string }) => {
    if (!remote.objectId) throw new Error('blob_capture_unavailable');
    handles.push(remote.objectId);
    return remote.objectId;
  };
  const releaseHandles = async () => {
    for (const objectId of handles.splice(0).reverse())
      await options.cdp('Runtime.releaseObject', { objectId }).catch(() => {});
    // getProperties also creates nested prototype/scope references. They inherit
    // this private group and must not accumulate across repeated task actions.
    await options.cdp('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  };
  try {
    const { executionContextId } = (await options.cdp('Page.createIsolatedWorld', {
      frameId: options.frameId,
      worldName: 'holaday-native-blob-v1',
    })) as { executionContextId: number };
    const { node } = (await options.cdp('DOM.describeNode', {
      objectId: options.nodeObjectId,
    })) as { node: { backendNodeId: number } };
    const resolved = (await options.cdp('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
      executionContextId,
      objectGroup,
    })) as { object: { objectId?: string } };
    const adopted = object(resolved.object);
    const owned = await evaluate(
      {
        objectId: adopted,
        functionDeclaration: 'function(){return this.ownerDocument === document && window.origin;}',
        returnByValue: true,
      },
      'blob_capture_unavailable',
    );
    if (owned.value !== options.origin || !/^https?:\/\//.test(options.origin))
      throw new Error('origin_grant_required');
    const platformId = object(
      await evaluate(
        {
          objectId: options.nodeObjectId,
          functionDeclaration: snapshotPlatform.toString(),
          returnByValue: false,
        },
        'blob_api_unavailable',
      ),
    );
    type FunctionRemote = {
      type?: string;
      subtype?: string;
      objectId?: string;
      description?: string;
    };
    const properties = (await options.cdp('Runtime.getProperties', {
      objectId: platformId,
      ownProperties: true,
    })) as { result: Array<{ name: string; value?: FunctionRemote }> };
    for (const [name, expected] of Object.entries(platformNames)) {
      const value = properties.result.find((property) => property.name === name)?.value;
      if (
        !value?.objectId ||
        value.type !== 'function' ||
        value.subtype === 'proxy' ||
        !value.description?.includes('[native code]') ||
        !new RegExp(`\\b${expected}\\(`).test(value.description)
      )
        throw new Error('blob_api_unavailable');
      const id = object(value);
      const details = (await options.cdp('Runtime.getProperties', {
        objectId: id,
        ownProperties: true,
      })) as { internalProperties?: Array<{ name: string }> };
      if (
        details.internalProperties?.some((property) =>
          [
            '[[FunctionLocation]]',
            '[[TargetFunction]]',
            '[[BoundArgs]]',
            '[[Handler]]',
            '[[Target]]',
          ].includes(property.name),
        )
      )
        throw new Error('blob_api_unavailable');
    }
    const stillOwned = await evaluate(
      {
        objectId: adopted,
        functionDeclaration: 'function(){return this.ownerDocument === document && window.origin;}',
        returnByValue: true,
      },
      'blob_capture_unavailable',
    );
    if (stillOwned.value !== options.origin || !current()) throw new Error('scope_unavailable');
    storeId = object(
      await evaluate(
        {
          objectId: options.nodeObjectId,
          functionDeclaration: `function(native,config){return (${makeStore.toString()})(native,config);}`,
          arguments: [{ objectId: platformId }, { value: { maxBytes, captureMs: timeout } }],
          returnByValue: false,
        },
        'blob_capture_unavailable',
      ),
    );
    if (!current()) throw new Error('scope_unavailable');
    const installed = await evaluate(
      {
        objectId: options.nodeObjectId,
        functionDeclaration: install.toString(),
        arguments: [{ objectId: storeId }],
        returnByValue: true,
      },
      'blob_api_unavailable',
    );
    if (installed.value !== true) throw new Error('blob_capture_unavailable');
  } catch (error) {
    let recovered = !storeId;
    if (storeId) {
      try {
        recovered =
          (
            await evaluate(
              {
                objectId: storeId,
                functionDeclaration: 'function(){return this.restoreInstalled();}',
                returnByValue: true,
              },
              'blob_capture_restore_unconfirmed',
            )
          ).value === true;
      } catch {
        recovered = false;
      }
      await evaluate(
        {
          objectId: storeId,
          functionDeclaration: 'function(){this.dispose();}',
          returnByValue: true,
        },
        'blob_capture_unavailable',
      ).catch(() => {});
    }
    await releaseHandles();
    if (!recovered) throw new Error('blob_capture_restore_unconfirmed');
    unlock();
    throw error;
  }

  let restored = false;
  let restoreFailed = false;
  let disposed = false;
  let restoration: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  const restore = () => {
    restoration ??= (async () => {
      clearTimeout(timer);
      try {
        const result = await evaluate(
          {
            objectId: storeId,
            functionDeclaration: 'function(){return this.restoreInstalled();}',
            returnByValue: true,
          },
          'blob_capture_restore_unconfirmed',
        );
        if (result.value !== true) throw new Error();
        restored = true;
        unlock();
      } catch {
        restoreFailed = true;
        throw new Error('blob_capture_restore_unconfirmed');
      }
    })();
    return restoration;
  };
  const aborted = () => {
    void restore().catch(() => {});
  };
  const admitted = () => {
    if (disposed || restoreFailed || !current()) throw new Error('scope_unavailable');
    if (!restored) throw new Error('blob_capture_active');
  };
  const describe = async (url: string) => {
    admitted();
    if (typeof url !== 'string' || !url.startsWith(`blob:${options.origin}/`) || url.length > 2048)
      throw new Error('blob_source_unavailable');
    const result = await evaluate(
      {
        objectId: storeId,
        functionDeclaration: 'function(url){return this.describe(url);}',
        arguments: [{ value: url }],
        returnByValue: true,
      },
      'blob_source_unavailable',
    );
    admitted();
    const value = result.value as { sizeBytes?: unknown; mimeType?: unknown } | undefined;
    if (
      !value ||
      !Number.isSafeInteger(value.sizeBytes) ||
      (value.sizeBytes as number) < 0 ||
      (value.sizeBytes as number) > maxBytes ||
      typeof value.mimeType !== 'string'
    )
      throw new Error('blob_source_unavailable');
    return { sizeBytes: value.sizeBytes as number, mimeType: value.mimeType };
  };
  const dispose = () => {
    disposal ??= (async () => {
      disposed = true;
      clearTimeout(lifetime);
      options.signal?.removeEventListener('abort', aborted);
      try {
        await restore();
      } finally {
        await evaluate(
          {
            objectId: storeId,
            functionDeclaration: 'function(){this.dispose();}',
            returnByValue: true,
          },
          'blob_capture_unavailable',
        ).catch(() => {});
        await releaseHandles();
      }
    })();
    return disposal;
  };
  const timer = setTimeout(aborted, timeout);
  const lifetime = setTimeout(() => {
    void dispose().catch(() => {});
  }, 120_000);
  options.signal?.addEventListener('abort', aborted, { once: true });
  if (!current()) {
    await dispose();
    throw new Error('scope_unavailable');
  }
  return {
    restore,
    describe,
    dispose,
    async read(url, offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > CHUNK_BYTES
      )
        throw new Error('invalid_blob_chunk');
      const info = await describe(url);
      if (offset > info.sizeBytes) throw new Error('invalid_blob_chunk');
      const buffer = await evaluate(
        {
          objectId: storeId,
          functionDeclaration: 'function(url,offset,length){return this.read(url,offset,length);}',
          arguments: [{ value: url }, { value: offset }, { value: length }],
          awaitPromise: true,
          returnByValue: false,
        },
        'blob_source_unavailable',
      );
      if (!buffer.objectId || buffer.subtype !== 'arraybuffer')
        throw new Error('blob_source_unavailable');
      let bytes: Uint8Array;
      try {
        admitted();
        const result = await evaluate(
          {
            objectId: storeId,
            functionDeclaration: 'function(buffer){return this.bytes(buffer);}',
            arguments: [{ objectId: buffer.objectId }],
            returnByValue: true,
          },
          'blob_source_unavailable',
        );
        admitted();
        if (
          !Array.isArray(result.value) ||
          result.value.length !== Math.min(length, info.sizeBytes - offset) ||
          result.value.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
        )
          throw new Error('blob_source_unavailable');
        bytes = new Uint8Array(result.value);
      } finally {
        await options.cdp('Runtime.releaseObject', { objectId: buffer.objectId }).catch(() => {
          handles.push(buffer.objectId!);
        });
      }
      admitted();
      return bytes;
    },
  };
}
