export const NS = {
  CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
  XHTML: 'http://www.w3.org/1999/xhtml',
  OPF: 'http://www.idpf.org/2007/opf',
  EPUB: 'http://www.idpf.org/2007/ops',
  DC: 'http://purl.org/dc/elements/1.1/',
  DCTERMS: 'http://purl.org/dc/terms/',
  ENC: 'http://www.w3.org/2001/04/xmlenc#',
  NCX: 'http://www.daisy.org/z3986/2005/ncx/',
  XLINK: 'http://www.w3.org/1999/xlink',
  SMIL: 'http://www.w3.org/ns/SMIL',
};

export const MIME = {
  XML: 'application/xml',
  NCX: 'application/x-dtbncx+xml',
  XHTML: 'application/xhtml+xml',
  HTML: 'text/html',
  CSS: 'text/css',
  SVG: 'image/svg+xml',
  JS: /\/(x-)?(javascript|ecmascript)/,
};

// https://www.w3.org/TR/epub-33/#sec-reserved-prefixes
export const PREFIX = {
  a11y: 'http://www.idpf.org/epub/vocab/package/a11y/#',
  dcterms: 'http://purl.org/dc/terms/',
  marc: 'http://id.loc.gov/vocabulary/',
  media: 'http://www.idpf.org/epub/vocab/overlays/#',
  onix: 'http://www.editeur.org/ONIX/book/codelists/current.html#',
  rendition: 'http://www.idpf.org/vocab/rendition/#',
  schema: 'http://schema.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  msv: 'http://www.idpf.org/epub/vocab/structure/magazine/#',
  prism: 'http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#',
};

export const RELATORS = {
  art: 'artist',
  aut: 'author',
  clr: 'colorist',
  edt: 'editor',
  ill: 'illustrator',
  nrt: 'narrator',
  trl: 'translator',
  pbl: 'publisher',
};

export const ONIX5 = {
  '02': 'isbn',
  '06': 'doi',
  '15': 'isbn',
  '26': 'doi',
  '34': 'issn',
};
