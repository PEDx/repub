import { NS } from './constant';

const WebCryptoSHA1 = async (str: string) => {
  const data = new TextEncoder().encode(str);
  const buffer = await globalThis.crypto.subtle.digest('SHA-1', data);
  return new Uint8Array(buffer);
};

const isUUIDReg = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/;

const getUUID = (opf: Document) => {
  for (const el of opf.getElementsByTagNameNS(NS.DC, 'identifier')) {
    const [id] = getElementText(el).split(':').slice(-1);
    if (isUUIDReg.test(id ?? '')) return id;
  }
  return '';
};

// strip and collapse ASCII whitespace
// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
const normalizeWhitespace = (str: string | null) => {
  if (!str) return '';
  return str
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^[\t\n\f\r ]+/, '')
    .replace(/[\t\n\f\r ]+$/, '');
};

const getElementText = (el: Element | null) => {
  if (!el) {
    console.warn('Element is null');
    return '';
  }
  return normalizeWhitespace(el.textContent);
};

// https://www.w3.org/publishing/epub32/epub-ocf.html#sec-resource-obfuscation
const deobfuscate = async (key: Uint8Array, length: number, blob: Blob) => {
  const array = new Uint8Array(await blob.slice(0, length).arrayBuffer());
  length = Math.min(length, array.length);

  for (var i = 0; i < length; i++) {
    array[i] = array[i]! ^ key[i % key.length]!;
  }
  return new Blob([array, blob.slice(length)], { type: blob.type });
};

const getIdentifier = (opf: Document) => {
  const uid = opf.getElementById(opf.documentElement.getAttribute('unique-identifier') ?? '');
  const id = opf.getElementsByTagNameNS(NS.DC, 'identifier')[0] as HTMLElement | null;
  return getElementText(uid || id);
};

const deobfuscators = (sha1 = WebCryptoSHA1) => ({
  'http://www.idpf.org/2008/embedding': {
    key: (opf: Document) =>
      sha1(
        getIdentifier(opf)
          // eslint-disable-next-line no-control-regex
          .replaceAll(/[\u0020\u0009\u000d\u000a]/g, ''),
      ),
    decode: (key: Uint8Array, blob: Blob) => deobfuscate(key, 1040, blob),
  },

  'http://ns.adobe.com/pdf/enc#RC': {
    key: (opf: Document) => {
      const uuid = getUUID(opf)?.replaceAll('-', '');
      return Uint8Array.from({ length: 16 }, (_, i) => parseInt(uuid?.slice(i * 2, i * 2 + 2) ?? '0', 16));
    },
    decode: (key: Uint8Array, blob: Blob) => deobfuscate(key, 1024, blob),
  },
});

interface IDeobfuscators {
  key: (opf: Document) => Promise<Uint8Array<ArrayBuffer>>;
  decode: (key: Uint8Array, blob: Blob) => Promise<Blob>;
}

export class Encryption {
  private uris = new Map();
  private decoders = new Map();
  private algorithms;
  constructor(algorithms: Record<string, IDeobfuscators>) {
    this.algorithms = algorithms;
  }
  async init(encryption: Document, opf: Document) {
    if (!encryption) return;
    const data = Array.from(encryption.getElementsByTagNameNS(NS.ENC, 'EncryptedData'), (el) => ({
      algorithm: el.getElementsByTagNameNS(NS.ENC, 'EncryptionMethod')[0]?.getAttribute('Algorithm'),
      uri: el.getElementsByTagNameNS(NS.ENC, 'CipherReference')[0]?.getAttribute('URI'),
    }));
    for (const { algorithm, uri } of data) {
      if (!this.decoders.has(algorithm)) {
        const algo = this.algorithms[algorithm as string];
        if (!algo) {
          console.warn('Unknown encryption algorithm');
          continue;
        }
        const key = await algo.key(opf);
        this.decoders.set(algorithm, (blob: Blob) => algo.decode(key, blob));
      }
      this.uris.set(uri, algorithm);
    }
  }
  getDecoder(uri: string) {
    return this.decoders.get(this.uris.get(uri)) ?? ((x: Blob) => x);
  }
}
