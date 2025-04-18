import { MIME, NS } from './constant';
import { epubCFI, type TParsed, type TPart } from './epubCFI';

const childGetter = (doc: Document, ns: string) => {
  // ignore the namespace if it doesn't appear in document at all
  const useNS = doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns);
  const f = useNS
    ? (el: Element, name: string) => (el: Element) => el.namespaceURI === ns && el.localName === name
    : (el: Element, name: string) => (el: Element) => el.localName === name;
  return {
    $: (el: Element, name: string) => [...el.children].find(f(el, name)),
    $$: (el: Element, name: string) => [...el.children].filter(f(el, name)),
    $$$: useNS
      ? (el: Element, name: string) => [...el.getElementsByTagNameNS(ns, name)]
      : (el: Element, name: string) => [...el.getElementsByTagName(name)],
  };
};

// convert to camel case
const camel = (x: string) => x.toLowerCase().replace(/[-:](.)/g, (_, g) => g.toUpperCase());

const getAttributes = (...xs: string[]) => {
  return (el: Element) => Object.fromEntries(xs.map((x) => [camel(x), el.getAttribute(x)]));
};

const filterAttribute = (attr: string, value: string | ((attr: string) => boolean), isList?: boolean) => {
  if (isList) {
    return (el: Element) =>
      el
        .getAttribute(attr)
        ?.split(/\s/)
        ?.includes(value as string);
  }
  if (typeof value === 'function') {
    return (el: Element) => value(el.getAttribute(attr) as string);
  }
  return (el: Element) => el.getAttribute(attr) === value;
};

type TManifest = {
  [k: string]: string | string[] | null | undefined;
};

export class Resources {
  opf: Document;
  manifest: TManifest[];
  spine: TManifest[];
  pageProgressionDirection?: string | null;
  navPath?: string | null;
  ncxPath?: string | null;
  guide?: TManifest[];
  cover?: TManifest | null;
  cfis?: string[];
  constructor({ opf, resolveHref }: { opf: Document; resolveHref: (href: string) => string }) {
    this.opf = opf;

    const { $, $$, $$$ } = childGetter(opf, NS.OPF);

    const $manifest = $(opf.documentElement, 'manifest');
    const $spine = $(opf.documentElement, 'spine');
    const $$itemref = $$($spine!, 'itemref');

    this.manifest = $$($manifest!, 'item')
      .map(getAttributes('href', 'id', 'media-type', 'properties', 'media-overlay'))
      .map((item) => {
        item.href = resolveHref(item.href!);
        (item.properties as unknown) = item.properties?.split(/\s/);
        return item;
      });

    this.spine = $$itemref.map(getAttributes('idref', 'id', 'linear', 'properties')).map((item) => {
      (item.properties as unknown) = item.properties?.split(/\s/);
      return item;
    });

    this.pageProgressionDirection = $spine?.getAttribute('page-progression-direction');

    this.navPath = this.getItemByProperty('nav')?.href as string | null;

    this.ncxPath = (
      this.getItemByID($spine?.getAttribute('toc') || '') ?? this.manifest.find((item) => item.mediaType === MIME.NCX)
    )?.href as string | null;

    const $guide = $(opf.documentElement, 'guide');

    if ($guide) {
      this.guide = $$($guide, 'reference')
        .map(getAttributes('type', 'title', 'href'))
        .map(({ type, title, href }) => ({
          label: title,
          type: type?.split(/\s/),
          href: resolveHref(href || ''),
        }));
    }

    this.cover =
      this.getItemByProperty('cover-image') ??
      // EPUB 2 compat
      this.getItemByID(
        $$$(opf as unknown as Element, 'meta')
          .find(filterAttribute('name', 'cover'))
          ?.getAttribute('content') as string,
      ) ??
      this.getItemByHref(this.guide?.find((ref) => ref.type?.includes('cover'))?.href as string);

    this.cfis = epubCFI.fromElements($$itemref);
  }
  getItemByID(id: string) {
    return this.manifest.find((item) => item.id === id);
  }
  getItemByHref(href: string) {
    return this.manifest.find((item) => item.href === href);
  }
  getItemByProperty(prop: string) {
    return this.manifest.find((item) => item.properties?.includes(prop));
  }
  resolveCFI(cfi: string) {
    const parts = epubCFI.parse(cfi);

    const top = ((parts as TParsed).parent ?? parts).shift();

    let $itemref = epubCFI.toElement(this.opf, top);
    // make sure it's an idref; if not, try again without the ID assertion
    // mainly because Epub.js used to generate wrong ID assertions
    // https://github.com/futurepress/epub.js/issues/1236b

    if ($itemref && $itemref.nodeName !== 'idref') {
      const last = top?.at(-1);
      if (last) last.id = null;
      $itemref = epubCFI.toElement(this.opf, top);
    }
    const idref = $itemref?.getAttribute('idref');
    const index = this.spine.findIndex((item) => item.idref === idref);
    const anchor = (doc: Document) => epubCFI.toRange(doc, parts);
    return { index, anchor };
  }
}
