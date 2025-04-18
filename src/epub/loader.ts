import { MIME, NS } from './constant';
import type { Resources, TManifest } from './resources';

const isExternal = (uri: string) => /^(?!blob)\w+:/i.test(uri);

const resolveURL = (url: string, relativeTo: string) => {
  try {
    if (relativeTo.includes(':')) return new URL(url, relativeTo);
    // the base needs to be a valid URL, so set a base URL and then remove it
    const root = 'https://invalid.invalid/';
    const obj = new URL(url, root + relativeTo);
    obj.search = '';
    return decodeURI(obj.href.replace(root, ''));
  } catch (e) {
    console.warn(e);
    return url;
  }
};

// replace asynchronously and sequentially
// same technique as https://stackoverflow.com/a/48032528
const replaceSeries = async (str: string, regex: RegExp, f: (...args: any[]) => Promise<any>) => {
  const matches: string[] = [];
  str.replace(regex, (...args) => {
    matches.push(args as any);
    return null as any;
  });
  const results: string[] = [];
  for (const args of matches) results.push(await f(...args));
  return str.replace(regex, () => results.shift() || '');
};

export class Loader {
  private cache = new Map<string, string>();
  private children = new Map<string, string[]>();
  private refCount = new Map<string, number>();
  loadText: (href: string) => Promise<string>;
  loadBlob: (href: string) => Promise<Blob>;
  manifest: TManifest[];
  assets: TManifest[];
  allowScript = false;
  eventTarget = new EventTarget();
  constructor({
    loadText,
    loadBlob,
    resources,
  }: {
    loadText: (href: string) => Promise<string>;
    loadBlob: (href: string) => Promise<Blob>;
    resources: Resources;
  }) {
    this.loadText = loadText;
    this.loadBlob = loadBlob;
    this.manifest = resources.manifest;
    this.assets = resources.manifest;
    // needed only when replacing in (X)HTML w/o parsing (see below)
    //.filter(({ mediaType }) => ![MIME.XHTML, MIME.HTML].includes(mediaType))
  }
  async createURL(href: string, data: Promise<Blob> | string, type: string, parent?: string) {
    if (!data) return '';
    const detail = { data, type };
    Object.defineProperty(detail, 'name', { value: href }); // readonly
    const event = new CustomEvent('data', { detail });
    this.eventTarget.dispatchEvent(event);
    const newData = await event.detail.data;
    const newType = await event.detail.type;
    const url = URL.createObjectURL(new Blob([newData], { type: newType }));
    this.cache.set(href, url);
    this.refCount.set(href, 1);
    if (parent) {
      const childList = this.children.get(parent);
      if (childList) childList.push(href);
      else this.children.set(parent, [href]);
    }
    return url;
  }
  ref(href: string, parent: string) {
    const childList = this.children.get(parent);
    if (!childList?.includes(href)) {
      this.refCount.set(href, (this.refCount.get(href) ?? 0) + 1);
      //console.log(`referencing ${href}, now ${this.refCount.get(href)}`)
      if (childList) childList.push(href);
      else this.children.set(parent, [href]);
    }
    return this.cache.get(href);
  }
  unref(href: string) {
    if (!this.refCount.has(href)) return;
    const count = (this.refCount.get(href) ?? 0) - 1;
    //console.log(`unreferencing ${href}, now ${count}`)
    if (count < 1) {
      //console.log(`unloading ${href}`)
      URL.revokeObjectURL(this.cache.get(href) || '');
      this.cache.delete(href);
      this.refCount.delete(href);
      // unref children
      const childList = this.children.get(href);
      if (childList) while (childList.length) this.unref(childList?.pop() || '');
      this.children.delete(href);
    } else this.refCount.set(href, count);
  }
  // load manifest item, recursively loading all resources as needed
  async loadItem(item: TManifest, parents: string[] = []) {
    if (!item) return null;
    const { href, mediaType } = item;

    const isScript = MIME.JS.test(item.mediaType as string);
    if (isScript && !this.allowScript) return null;

    const parent = parents.at(-1);
    if (this.cache.has(href as string) && parent) return this.ref(href as string, parent);

    const shouldReplace =
      (isScript || [MIME.XHTML, MIME.HTML, MIME.CSS, MIME.SVG].includes(mediaType as string)) &&
      // prevent circular references
      parents.every((p) => p !== href);
    if (shouldReplace) return this.loadReplaced(item, parents);
    // NOTE: this can be replaced with `Promise.try()`
    const tryLoadBlob = Promise.resolve().then(() => this.loadBlob(href as string));
    return this.createURL(href as string, tryLoadBlob, mediaType as string, parent);
  }
  async loadHref(href: string, base: string, parents: string[] = []) {
    if (isExternal(href)) return href;
    const path = resolveURL(href, base);
    const item = this.manifest.find((item) => item.href === path);
    if (!item) return href;
    return this.loadItem(item, parents.concat(base));
  }
  async loadReplaced(item: TManifest, parents: string[] = []) {
    const { href, mediaType } = item;
    const parent = parents.at(-1);
    let str = '';
    try {
      str = await this.loadText(href as string);
    } catch (e) {
      return this.createURL(href as string, Promise.reject(e), mediaType as string, parent);
    }
    if (!str) return null;

    // note that one can also just use `replaceString` for everything:
    // ```
    // const replaced = await this.replaceString(str, href, parents)
    // return this.createURL(href, replaced, mediaType, parent)
    // ```
    // which is basically what Epub.js does, which is simpler, but will
    // break things like iframes (because you don't want to replace links)
    // or text that just happen to be paths

    // parse and replace in HTML
    if ([MIME.XHTML, MIME.HTML, MIME.SVG].includes(mediaType as string)) {
      let doc = new DOMParser().parseFromString(str, mediaType as DOMParserSupportedType);
      // change to HTML if it's not valid XHTML
      if (mediaType === MIME.XHTML && (doc.querySelector('parsererror') || !doc.documentElement?.namespaceURI)) {
        console.warn((doc.querySelector('parsererror') as HTMLElement)?.innerText ?? 'Invalid XHTML');
        item.mediaType = MIME.HTML;
        doc = new DOMParser().parseFromString(str, item.mediaType as DOMParserSupportedType);
      }
      // replace hrefs in XML processing instructions
      // this is mainly for SVGs that use xml-stylesheet
      if ([MIME.XHTML, MIME.SVG].includes(item.mediaType as string)) {
        let child = doc.firstChild;
        while (child instanceof ProcessingInstruction) {
          if (child.data) {
            const replacedData = await replaceSeries(
              child.data,
              /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
              (_, p1, p2, p3) => this.loadHref(p2 as string, href as string, parents).then((p2) => `${p1}${p2}${p3}`),
            );
            child.replaceWith(doc.createProcessingInstruction(child.target, replacedData));
          }
          child = child.nextSibling;
        }
      }
      // replace hrefs (excluding anchors)
      // TODO: srcset?
      const replace = async (el: Element, attr: string) => {
        const value = el.getAttribute(attr);
        if (!value || !href) return;
        return el.setAttribute(attr, await this.loadHref(value, href as string, parents) as string);
      };
      for (const el of doc.querySelectorAll('link[href]')) await replace(el, 'href');
      for (const el of doc.querySelectorAll('[src]')) await replace(el, 'src');
      for (const el of doc.querySelectorAll('[poster]')) await replace(el, 'poster');
      for (const el of doc.querySelectorAll('object[data]')) await replace(el, 'data');
      for (const el of doc.querySelectorAll('[*|href]:not([href])'))
        el.setAttributeNS(
          NS.XLINK,
          'href',
          await this.loadHref(el.getAttributeNS(NS.XLINK, 'href') as string, href as string, parents) as string,
        );
      // replace inline styles
      for (const el of doc.querySelectorAll('style'))
        if (el.textContent) el.textContent = await this.replaceCSS(el.textContent as string, href as string, parents);
      for (const el of doc.querySelectorAll('[style]'))
        el.setAttribute('style', await this.replaceCSS(el.getAttribute('style') as string, href as string, parents));
      // TODO: replace inline scripts? probably not worth the trouble
      const result = new XMLSerializer().serializeToString(doc);
      return this.createURL(href as string, result, item.mediaType as string, parent);
    }

    const result: string =
      mediaType === MIME.CSS
        ? await this.replaceCSS(str, href as string, parents)
        : await this.replaceString(str, href as string, parents);
    return this.createURL(href as string, result as string, mediaType as string, parent);
  }
  async replaceCSS(str: string, href: string, parents: string[] = []) {
    const replacedUrls = await replaceSeries(str, /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi, (_, url) =>
      this.loadHref(url, href, parents).then((url: string) => `url("${url}")`),
    );
    // apart from `url()`, strings can be used for `@import` (but why?!)
    return replaceSeries(replacedUrls, /@import\s*["']([^"'\n]*?)["']/gi, (_, url: string) =>
      this.loadHref(url, href, parents).then((url: string) => `@import "${url}"`),
    );
  }
  // find & replace all possible relative paths for all assets without parsing
  replaceString(str: string, href: string, parents: string[] = []) {
    const assetMap = new Map();
    const urls = this.assets
      .map((asset) => {
        // do not replace references to the file itself
        if (asset.href === href) return;
        // href was decoded and resolved when parsing the manifest
        const relative = pathRelative(pathDirname(href), asset.href);
        const relativeEnc = encodeURI(relative);
        const rootRelative = '/' + asset.href;
        const rootRelativeEnc = encodeURI(rootRelative);
        const set = new Set([relative, relativeEnc, rootRelative, rootRelativeEnc]);
        for (const url of set) assetMap.set(url, asset);
        return Array.from(set);
      })
      .flat()
      .filter((x) => x);
    if (!urls.length) return str;
    const regex = new RegExp(urls.map(regexEscape).join('|'), 'g');
    return replaceSeries(str, regex, async (match) =>
      this.loadItem(assetMap.get(match.replace(/^\//, '')), parents.concat(href)),
    );
  }
  unloadItem(item: TManifest) {
    this.unref(item?.href as string);
  }
  destroy() {
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
  }
}
