/**
 * epubcfi standard
 * https://w3c.github.io/epub-specs/epub33/epubcfi/
 *
 * epubcfi example
 * epubcfi(/6/4[Section0017.xhtml]!4/42/178/1:0,4/42/198/1:1)
 *
 */

const isNumberReg = /\d/;

export const isCFIReg = /^epubcfi\((.*)\)$/;

const escapeCFI = (str: string) => str.replace(/[\^[\](),;=]/g, '^$&');

const wrap = (x: string) => (isCFIReg.test(x) ? x : `epubcfi(${x})`);

const unwrap = (x: string) => x.match(isCFIReg)?.[1] ?? x;

type TToken = [string, number | string] | [string];

const tokenizer = (str: string) => {
  const tokens: TToken[] = [];
  let state: string | null = null;
  let escape: boolean = false;
  let value = '';

  const push = (x: TToken) => (tokens.push(x), (state = null), (value = ''));

  const cat = (x: string) => ((value += x), (escape = false));

  for (const char of Array.from(str.trim()).concat('')) {
    if (char === '^' && !escape) {
      escape = true;
      continue;
    }

    if (state === '!') {
      push(['!']);
    } else if (state === ',') {
      push([',']);
    } else if (state === '/' || state === ':') {
      if (isNumberReg.test(char)) {
        cat(char);
        continue;
      } else {
        push([state, parseInt(value)]);
      }
    } else if (state === '~') {
      if (isNumberReg.test(char) || char === '.') {
        cat(char);
        continue;
      } else {
        push(['~', parseFloat(value)]);
      }
    } else if (state === '@') {
      if (char === ':') {
        push(['@', parseFloat(value)]);
        state = '@';
        continue;
      }
      if (isNumberReg.test(char) || char === '.') {
        cat(char);
        continue;
      } else {
        push(['@', parseFloat(value)]);
      }
    } else if (state === '[') {
      if (char === ';' && !escape) {
        push(['[', value]);
        state = ';';
      } else if (char === ',' && !escape) {
        push(['[', value]);
        state = '[';
      } else if (char === ']' && !escape) {
        push(['[', value]);
      } else {
        cat(char);
      }
      continue;
    } else if (state?.startsWith(';')) {
      if (char === '=' && !escape) {
        state = `;${value}`;
        value = '';
      } else if (char === ';' && !escape) {
        push([state, value]);
        state = ';';
      } else if (char === ']' && !escape) {
        push([state, value]);
      } else {
        cat(char);
      }
      continue;
    }

    if (char === '/' || char === ':' || char === '~' || char === '@' || char === '[' || char === '!' || char === ',') {
      state = char;
    }
  }
  return tokens;
};

type TPart = {
  index: number;
  offset: number | null;
  temporal?: number;
  spatial?: number[];
  side?: string;
  id?: string;
  text?: string[];
};

const parser = (tokens: TToken[]) => {
  const parts: TPart[] = [];
  let state: string = '';
  for (const [type, val] of tokens) {
    if (type === '/') parts.push({ index: val as number, offset: null });
    else {
      const last = parts[parts.length - 1]!;
      if (type === ':') last.offset = val as number;
      else if (type === '~') last.temporal = val as number;
      else if (type === '@') last.spatial = (last.spatial ?? []).concat(val as number);
      else if (type === ';s') last.side = val as string;
      else if (type === '[') {
        if (state === '/' && val) last.id = val as string;
        else {
          last.text = (last.text ?? []).concat(val as string);
          continue;
        }
      }
    }
    state = type;
  }
  return parts;
};

const findIndices = (arr: TToken[], find: (x: TToken, i: number, a: TToken[]) => boolean) => {
  return arr
    .map((x, i, a) => {
      return find(x, i, a) ? i : null;
    })
    .filter((x) => x != null);
};

const splitAt = (arr: TToken[], is: number[]) => {
  const ret = [-1, ...is, arr.length].reduce(
    ({ xs, a }, b) => {
      return {
        xs: xs?.concat([arr.slice(a + 1, b)]),
        a: b,
      };
    },
    { xs: [], a: -1 } as { xs: TToken[][]; a: number },
  );

  return ret.xs;
};

const findTokens = (tokens: TToken[], x: string) => findIndices(tokens, ([t]) => t === x);

const parserIndir = (tokens: TToken[]) => splitAt(tokens, findTokens(tokens, '!')).map(parser);

const concatArrays = (a: TPart[][], b: TPart[][]) => {
  return a
    .slice(0, -1)
    .concat([a[a.length - 1]!.concat(b[0] ?? [])])
    .concat(b.slice(1));
};

const partToString = ({ index, id, offset, temporal, spatial, text, side }: TPart) => {
  const param = side ? `;s=${side}` : '';
  return (
    `/${index}` +
    (id ? `[${escapeCFI(id)}${param}]` : '') +
    // "CFI expressions [..] SHOULD include an explicit character offset"
    (offset != null && index % 2 ? `:${offset}` : '') +
    (temporal ? `~${temporal}` : '') +
    (spatial ? `@${spatial.join(':')}` : '') +
    (text || (!id && side) ? '[' + (text?.map(escapeCFI)?.join(',') ?? '') + param + ']' : '')
  );
};

const toInnerString = (parsed: TPart[][] | TParsed): string => {
  if ((<TParsed>parsed).parent) {
    return [(<TParsed>parsed).parent, (<TParsed>parsed).start, (<TParsed>parsed).end].map(toInnerString).join(',');
  }

  return (<TPart[][]>parsed).map((parts) => parts.map(partToString).join('')).join('!');
};

const toString = (parsed: TPart[][] | TParsed) => wrap(toInnerString(parsed));

const isTextNode = ({ nodeType }: Node) => nodeType === 3 || nodeType === 4;
const isElementNode = ({ nodeType }: Node) => nodeType === 1;

const getChildNodes = (node: Node, filter?: (x: Node) => number): Node[] => {
  const nodes = Array.from(node.childNodes)
    // "content other than element and character data is ignored"
    .filter((node) => isTextNode(node) || isElementNode(node)) as Node[];

  return filter
    ? (nodes
        .map((node) => {
          const accept = filter(node);
          if (accept === NodeFilter.FILTER_REJECT) {
            return null;
          } else if (accept === NodeFilter.FILTER_SKIP) {
            return getChildNodes(node, filter);
          } else {
            return node;
          }
        })
        .flat()
        .filter((x) => x) as Node[])
    : nodes;
};

const indexChildNodes = (node: HTMLElement, filter?: (x: Node) => number) => {
  const nodes: (Node[] | Node | string | null)[] = getChildNodes(node, filter).reduce((arr, node) => {
    if (!node) return [];
    let last = arr[arr.length - 1];
    if (!last) {
      arr.push(node);
    }
    // "there is one chunk between each pair of child elements"
    else if (isTextNode(node)) {
      if (Array.isArray(last)) {
        last.push(node);
      } else if (isTextNode(last)) {
        if (arr[arr.length - 1]) arr[arr.length - 1] = [last, node];
      } else {
        arr.push(node);
      }
    } else {
      if (!Array.isArray(last) && isElementNode(last)) {
        arr.push(null, node);
      } else {
        arr.push(node);
      }
    }
    return arr;
  }, [] as (Node | null | Node[])[]);
  // "the first chunk is located before the first child element"
  if (isElementNode(nodes[0] as Node)) nodes.unshift('first');
  // "the last chunk is located after the last child element"
  if (isElementNode(nodes[nodes.length - 1] as Node)) nodes.push('last');
  // "'virtual' elements"
  nodes?.unshift('before'); // "0 is a valid index"
  nodes?.push('after'); // "n+2 is a valid index"
  return nodes;
};

const partsToNode = (node: HTMLElement, parts: TPart[] | undefined, filter: (x: Node) => number) => {
  if (!parts) return null;

  const { id } = parts[parts.length - 1]!;
  if (id) {
    const el = node.ownerDocument.getElementById(id);
    if (el) return { node: el, offset: 0 };
  }
  for (const { index } of parts) {
    const newNode = node ? indexChildNodes(node, filter)[index] : null;
    // handle non-existent nodes
    if (newNode === 'first') return { node: node.firstChild ?? node };
    if (newNode === 'last') return { node: node.lastChild ?? node };
    if (newNode === 'before') return { node, before: true };
    if (newNode === 'after') return { node, after: true };
    node = newNode as HTMLElement;
  }
  const { offset } = parts[parts.length - 1]!;

  if (!offset) return null;

  if (!Array.isArray(node)) return { node, offset };
  // get underlying text node and offset from the chunk
  let sum = 0;
  for (const n of node) {
    const { length } = n.nodeValue;
    if (sum + length >= offset) return { node: n, offset: offset - sum };
    sum += length;
  }
};

type TParsed = { parent: TPart[][]; start: TPart[][]; end: TPart[][] };

const collapse = (x: TPart[][] | TParsed, toEnd?: boolean) => {
  if ((x as TParsed).parent) {
    return concatArrays((<TParsed>x).parent, (<TParsed>x)[toEnd ? 'end' : 'start']);
  }
  return x as TPart[][];
};

const buildRange = (from: TPart[][], to: TPart[][]) => {
  from = collapse(from);
  to = collapse(to, true);
  // ranges across multiple documents are not allowed; handle local paths only
  const localFrom = from[from.length - 1]!,
    localTo = to[to.length - 1]!;

  const localParent = [],
    localStart = [],
    localEnd = [];
  let pushToParent = true;
  const len = Math.max(localFrom?.length ?? 0, localTo?.length ?? 0);
  for (let i = 0; i < len; i++) {
    const a = localFrom[i],
      b = localTo[i];
    pushToParent &&= a?.index === b?.index && !a?.offset && !b?.offset;
    if (pushToParent) {
      localParent.push(a as TPart);
    } else {
      if (a) {
        localStart.push(a);
      }
      if (b) {
        localEnd.push(b);
      }
    }
  }
  // copy non-local paths from `from`
  const parent = from.slice(0, -1).concat([localParent]);
  return toString({ parent, start: [localStart], end: [localEnd] });
};

interface IPart {
  id: string;
  index: number;
  offset: number | null;
}

const nodeToParts = (node: HTMLElement, offset: number | null, filter?: (x: Node) => number): IPart[] => {
  const { parentNode, id } = node;
  const indexed = indexChildNodes(parentNode as HTMLElement, filter);
  const index = indexed.findIndex((x) => (Array.isArray(x) ? x.some((x) => x === node) : x === node));
  // adjust offset as if merging the text nodes in the chunk
  const chunk = indexed[index];
  if (Array.isArray(chunk)) {
    let sum = 0;
    for (const x of chunk) {
      if (x === node) {
        sum += offset ?? 0;
        break;
      } else {
        sum += x.nodeValue?.length ?? 0;
      }
    }
    offset = sum;
  }
  const part = { id, index, offset };
  return (
    (
      parentNode !== node.ownerDocument.documentElement
        ? nodeToParts(parentNode as HTMLElement, null, filter).concat(part)
        : [part]
    )
      // remove ignored nodes
      .filter((x) => x.index !== -1)
  );
};

export const parse = (cfi: string) => {
  const tokens = tokenizer(unwrap(cfi));
  const commas = findTokens(tokens, ',');
  if (!commas.length) return parserIndir(tokens);
  const [parent, start, end] = splitAt(tokens, commas).map(parserIndir);
  return { parent, start, end } as TParsed;
};

export const toRange = (doc: Document, parts: TPart[][] | TParsed, filter: (x: Node) => number) => {
  const startParts = collapse(parts);
  const endParts = collapse(parts, true);

  const root = doc.documentElement;
  const start = partsToNode(root, startParts[0], filter);
  const end = partsToNode(root, endParts[0], filter);

  const range = doc.createRange();

  if (start?.before) {
    range.setStartBefore(start.node);
  } else if (start?.after) {
    range.setStartAfter(start.node);
  } else {
    range.setStart(start?.node, start?.offset ?? 0);
  }

  if (end?.before) {
    range.setEndBefore(end.node);
  } else if (end?.after) {
    range.setEndAfter(end.node);
  } else {
    range.setEnd(end?.node, end?.offset ?? 0);
  }
  return range;
};

// faster way of getting CFIs for sorted elements in a single parent
export const fromElements = (elements: HTMLElement[]) => {
  const results: string[] = [];
  if (!elements.length) return results;
  const { parentNode } = elements[0]!;
  const parts = nodeToParts(parentNode as HTMLElement, null);
  for (const [index, node] of indexChildNodes(parentNode as HTMLElement).entries()) {
    const el = elements[results.length];
    if (node === el) results.push(toString([parts.concat({ id: el.id, index, offset: null })]));
  }
  return results;
};

export const fromRange = (range: Range, filter: (x: Node) => number) => {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const start = nodeToParts(startContainer as HTMLElement, startOffset, filter);
  if (range.collapsed) return toString([start]);
  const end = nodeToParts(endContainer as HTMLElement, endOffset, filter);
  return buildRange([start], [end]);
};

const lift =
  (f: (...xs: string[]) => string) =>
  (...xs: string[]) =>
    `epubcfi(${f(...xs.map((x) => x.match(isCFIReg)?.[1] ?? x))})`;

export const joinIndir = lift((...xs) => xs.join('!'));

// turn indices into standard CFIs when you don't have an actual package document
export const fake = {
  fromIndex: (index: number) => wrap(`/6/${(index + 1) * 2}`),
};

// get CFI from Calibre bookmarks
// see https://github.com/johnfactotum/foliate/issues/849
export const fromCalibrePos = (pos: string) => {
  const [parts] = parse(pos) as TPart[][];
  const item = parts?.shift();
  parts?.shift();
  return toString([[{ index: 6, offset: null }, item!], parts!]);
};

export const fromCalibreHighlight = ({
  spine_index,
  start_cfi,
  end_cfi,
}: {
  spine_index: number;
  start_cfi: string;
  end_cfi: string;
}) => {
  const pre = fake.fromIndex(spine_index) + '!';
  const start = parse(pre + start_cfi.slice(2));
  const end = parse(pre + end_cfi.slice(2));
  return buildRange(start as TPart[][], end as TPart[][]);
};

export const EpubCFI = {
  parse,
  toRange,
  fromElements,
  fromRange,
  joinIndir,
};
